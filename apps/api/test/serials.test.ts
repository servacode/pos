import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type ProductDetail,
  type PurchaseDetail,
  type SalePayload,
  type SerialRow,
  type SupplierRow,
} from '@serva/core';
import { createDb } from '@serva/db';
import { DOCUMENT_PROCESSORS } from '../src/services/processors';
import { checkRebuild } from '../src/services/rebuild';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';
import { TEST_OWNER_URL } from './urls';

/**
 * Electronics and phones (03 › الإلكترونيات والجوالات): pieces received and sold by their serial
 * number or IMEI, with their warranty; a sale is never refused for a number, only flagged.
 */

let app: FastifyInstance;
const owner = createDb(TEST_OWNER_URL, { max: 1 });
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await owner.client.end();
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });

async function phone(store: Store) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: 'سامسونج A15',
      tracksSerial: true,
      warrantyMonths: 12,
      variants: [{ price: { currency: 'SYP', priceMinor: 2_000_000 } }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  expect(p).toMatchObject({ tracksSerial: true, warrantyMonths: 12 });
  return { productId: p.id, variantId: p.variants[0]!.id, name: p.nameAr };
}

async function supplier(store: Store) {
  return (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'وكيل' } })
  ).json<SupplierRow>();
}

const purchase = (store: Store, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/purchases', headers: as(store), payload: body });

const lookup = async (store: Store, q = '') =>
  (await app.inject({ method: 'GET', url: `/v1/serials${q ? `?q=${q}` : ''}`, headers: as(store) })).json<{
    items: SerialRow[];
  }>().items;

describe('serial numbers', () => {
  it('receives one number per piece, sells them with their warranty, and a whole return brings them back', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const a15 = await phone(store);
    const base = { supplierId: s.id, date: '2026-10-29', payment: 'cash' };
    const short = await purchase(store, {
      ...base,
      lines: [{ variantId: a15.variantId, qty: 3000, costMinor: 4_500_000, serials: ['IMEI-1', 'IMEI-2'] }],
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({
      error: { fields: { 'lines.0.serials': expect.stringContaining('3') } },
    });
    const ok = await purchase(store, {
      ...base,
      lines: [
        {
          variantId: a15.variantId,
          qty: 3000,
          costMinor: 4_500_000,
          serials: ['imei 001', 'IMEI002', 'IMEI003'],
        },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json<PurchaseDetail>().lines[0]!.serials).toEqual(['IMEI001', 'IMEI002', 'IMEI003']);
    const again = await purchase(store, {
      ...base,
      lines: [{ variantId: a15.variantId, qty: 1000, costMinor: 1_500_000, serials: ['IMEI001'] }],
    });
    expect(again.json()).toMatchObject({
      error: { fields: { lines: 'الرقم IMEI001 موجود في المحل من قبل' } },
    });

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, qty: 2000, serials: ['IMEI001', 'IMEI002'] })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 4_000_000 }],
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results.map((r) => r.flags)).toEqual([[], []]);
    const after = await lookup(store);
    expect(after.map((r) => [r.serial, r.status, r.warrantyUntil])).toEqual(
      expect.arrayContaining([
        ['IMEI001', 'sold', '2027-10-30'],
        ['IMEI002', 'sold', '2027-10-30'],
        ['IMEI003', 'in_stock', null],
      ]),
    );
    expect((await lookup(store, 'imei001'))[0]).toMatchObject({
      name: 'سامسونج A15',
      purchaseNumber: expect.stringMatching(/^PUR-/),
      saleNumber: sold.number,
      soldOn: '2026-10-30',
    });

    // The whole line comes back
    const ret = doc(
      'return',
      buildReturnPayload({
        sale: sold.payload as unknown as SalePayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'لا يعمل',
        picks: [{ saleLineNo: 1, qty: 2000 }],
      }),
    );
    const back = await push(app, store.device, [ret]);
    expect(back.results[0]!.status, JSON.stringify(back.results[0])).toBe('accepted');
    expect((await lookup(store, 'IMEI001'))[0]).toMatchObject({ status: 'in_stock', saleNumber: null });
  });

  it('a number never received is recorded and flagged; one sold twice is flagged; the rebuild agrees', async () => {
    const store = await openStore(app);
    const a15 = await phone(store);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const first = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, serials: ['GHOST-1'] })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2_000_000 }],
      }),
    );
    const second = doc(
      'sale',
      sale(store, open.id, {
        lines: [cartLine(1, 2_000_000, { ...a15, serials: ['GHOST-1'] })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 2_000_000 }],
      }),
    );
    const res = await push(app, store.device, [open, first, second]);
    expect(res.results.map((r) => r.flags)).toEqual([
      [],
      expect.arrayContaining(['unknown_serial']),
      expect.arrayContaining(['serial_sold_twice']),
    ]);
    expect((await lookup(store, 'GHOST'))[0]).toMatchObject({ status: 'sold', saleNumber: first.number });
    const rebuilt = await checkRebuild(owner.db, {
      tenantId: store.tenantId,
      processors: DOCUMENT_PROCESSORS,
      now: new Date('2026-10-31T00:00:00Z'),
    });
    expect(rebuilt.same).toBe(true);
  });
});
