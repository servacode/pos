import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ProductDetail, PullSetRows, StoreResponse } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';

/**
 * Restaurants and cafés on the server (03 › المطاعم، المقاهي): a product's modifiers and the
 * store's hall settings reach the tills; a sale carries its order type, table and number.
 */

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

async function pull(store: Store) {
  await settled();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  return res.json<PullResponse>().sets as unknown as {
    [K in keyof PullSetRows]: { upserts: PullSetRows[K][] };
  };
}

const SIZE = {
  name: 'الحجم',
  multiple: false,
  required: true,
  options: [
    { name: 'وسط', priceMinor: 0 },
    { name: 'كبير', priceMinor: 5_000 },
  ],
};

describe('modifiers and the hall', () => {
  it('keeps a product’s modifiers and the hall settings, and the till pulls both', async () => {
    const store = await openStore(app);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'قهوة',
        type: 'service',
        modifiers: [SIZE],
        variants: [{ price: { currency: 'SYP', priceMinor: 15_000 } }],
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const product = made.json<ProductDetail>();
    expect(product.modifiers).toEqual([SIZE]);
    const service = { tables: ['1', '2', 'VIP'], orderNumbers: true, kitchenTickets: false };
    const set = await app.inject({
      method: 'PUT',
      url: '/v1/store/service',
      headers: as(store),
      payload: { service },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<StoreResponse>().service).toEqual(service);

    const sets = await pull(store);
    expect(sets.products.upserts.find((p) => p.id === product.id)!.modifiers).toEqual([SIZE]);
    expect(sets.settings.upserts[0]!.service).toEqual(service);

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${product.id}`,
      headers: as(store),
      payload: { version: product.version, modifiers: [] },
    });
    expect(cleared.json<ProductDetail>().modifiers).toEqual([]);
    const off = await app.inject({
      method: 'PUT',
      url: '/v1/store/service',
      headers: as(store),
      payload: { service: null },
    });
    expect(off.json<StoreResponse>().service).toBeNull();
    const [log] = await ownerDb()<{ changes: Record<string, unknown> }[]>`
      select changes from audit_logs where action = 'store.service_update' order by created_at desc limit 1`;
    expect(log!.changes).toEqual({ service: [service, null] });
  });

  it('refuses a group without options and a table named twice', async () => {
    const store = await openStore(app);
    const product = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'شاي',
        modifiers: [{ ...SIZE, options: [] }],
        variants: [{ price: { currency: 'SYP', priceMinor: 5_000 } }],
      },
    });
    expect(product.statusCode).toBe(400);
    const tables = await app.inject({
      method: 'PUT',
      url: '/v1/store/service',
      headers: as(store),
      payload: { service: { tables: ['1', '1'], orderNumbers: true, kitchenTickets: true } },
    });
    expect(tables.statusCode).toBe(400);
  });

  it('accepts a sale with its order type, table and number, and keeps them in the document', async () => {
    const store = await openStore(app);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 20_000, { name: 'قهوة · كبير' })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 20_000 }],
        service: { orderType: 'dine_in', table: 'VIP', orderNo: 12 },
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual([
      ['accepted', []],
      ['accepted', []],
    ]);
    const [row] = await ownerDb()<{ service: unknown }[]>`
      select payload->'service' as service from invoices where id = ${sold.id}`;
    expect(row!.service).toEqual({ orderType: 'dine_in', table: 'VIP', orderNo: 12 });
  });
});
