import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type InvoiceLookup,
  type PullSetRows,
  type SalePayload,
  type StoreResponse,
} from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { staffUser } from './staff';

/** «الصندوق»: the return window and the card approval rule, set by the owner and read by the till. */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function pullSettings(store: Store) {
  await settled();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  const sets = res.json<PullResponse>().sets as unknown as {
    [K in keyof PullSetRows]: { upserts: PullSetRows[K][] };
  };
  return sets.settings.upserts[0]!;
}

describe('till settings', () => {
  it('has no setting until the owner chooses, then the till pulls it with the business types', async () => {
    const store = await openStore(app);
    const read = async () =>
      (await app.inject({ method: 'GET', url: '/v1/store', headers: as(store) })).json<StoreResponse>();
    expect((await read()).till).toBeNull();
    expect((await pullSettings(store)).till).toBeNull();

    await ownerDb()`update tenants set sectors = array['clothing'] where id = ${store.tenantId}`;
    expect((await pullSettings(store)).sectors).toEqual(['clothing']);

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/store/till',
      headers: as(store),
      payload: { returnWindowDays: 14, cardApprovalRequired: true },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<StoreResponse>().till).toEqual({ returnWindowDays: 14, cardApprovalRequired: true });
    expect((await pullSettings(store)).till).toEqual({ returnWindowDays: 14, cardApprovalRequired: true });
  });

  it('refuses a wrong window and a cashier', async () => {
    const store = await openStore(app);
    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/store/till',
      headers: as(store),
      payload: { returnWindowDays: 0, cardApprovalRequired: false },
    });
    expect(bad.statusCode).toBe(400);
    const cashier = await staffUser(app, { ...store, branchId: '' }, 'cashier', '0955555555');
    const denied = await app.inject({
      method: 'PUT',
      url: '/v1/store/till',
      headers: as(cashier),
      payload: { returnWindowDays: null, cardApprovalRequired: false },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('invoice lookup for a return', () => {
  it('finds a sale by number, barcode text or last digits, with what was already returned', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const soldPayload = sale({ userId: store.userId }, open.id, {
      lines: [cartLine(1, 15_000, { qty: 2000 })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 30_000 }],
    });
    const sold = doc('sale', soldPayload);
    const back = doc(
      'return',
      buildReturnPayload({
        sale: soldPayload as SalePayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'المقاس غير مناسب',
        picks: [{ saleLineNo: 1, qty: 1000 }],
      }),
    );
    await push(app, store.device, [open, sold, back]);

    const look = (q: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/device/invoices/lookup?q=${encodeURIComponent(q)}`,
        headers: { authorization: store.device.authorization },
      });
    const exact = await look(sold.number!.toLowerCase());
    expect(exact.statusCode, exact.body).toBe(200);
    const found = exact.json<InvoiceLookup>();
    expect(found).toMatchObject({ id: sold.id, number: sold.number });
    expect(found.returned).toEqual([expect.objectContaining({ saleLineNo: 1, qty: 1000 })]);
    const digits = sold.number!.replace(/\D/g, '').slice(-4);
    expect((await look(digits)).json<InvoiceLookup>().id).toBe(sold.id);
    expect((await look('INV-999-999-0000001')).statusCode).toBe(404);
    expect((await look('12')).statusCode).toBe(404);
  });
});
