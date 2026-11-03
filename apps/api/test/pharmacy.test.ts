import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ExpiryResponse, ProductDetail, PullSetRows, PurchaseDetail, SupplierRow } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase, settled } from './helpers';

/**
 * Pharmacies on the server (03 › الصيدليات): the scientific name, the batch and expiry of what was
 * received, what of it is still on the shelf, and the earliest expiry the till warns on.
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
const BOX = 1000;

async function medicine(store: Store) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: 'بانادول 500',
      genericName: 'باراسيتامول',
      variants: [{ price: { currency: 'SYP', priceMinor: 15_000 } }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  return { productId: p.id, variantId: p.variants[0]!.id, name: p.nameAr, product: p };
}

async function receive(
  store: Store,
  supplierId: string,
  variantId: string,
  date: string,
  boxes: number,
  batch: string,
  expiry: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId,
      date,
      payment: 'credit',
      lines: [{ variantId, qty: boxes * BOX, costMinor: boxes * 10_000, batchNo: batch, expiryDate: expiry }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

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

const expiry = async (store: Store, days = 30) =>
  (
    await app.inject({ method: 'GET', url: `/v1/inventory/expiry?days=${days}`, headers: as(store) })
  ).json<ExpiryResponse>();

describe('batches and expiry', () => {
  it('keeps each batch received, estimates what is on the shelf, and follows the sales', async () => {
    const store = await openStore(app);
    const s = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: 'مستودع الشفاء' },
      })
    ).json<SupplierRow>();
    const med = await medicine(store);
    expect(med.product.genericName).toBe('باراسيتامول');
    // An old batch already past its date, then a newer one
    const first = await receive(store, s.id, med.variantId, '2026-10-20', 10, 'A-01', '2026-10-25');
    expect(first.lines[0]).toMatchObject({
      productId: med.productId,
      batchNo: 'A-01',
      expiryDate: '2026-10-25',
    });
    await receive(store, s.id, med.variantId, '2026-10-28', 5, 'B-07', '2026-11-15');

    let sets = await pull(store);
    expect(sets.products.upserts.find((p) => p.id === med.productId)!.genericName).toBe('باراسيتامول');
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.nearestExpiry).toBe('2026-10-25');

    let report = await expiry(store);
    expect(report.today).toBe('2026-10-30');
    expect(report.items.map((r) => [r.batchNo, r.expiryDate, r.qty, r.daysLeft])).toEqual([
      ['A-01', '2026-10-25', 10 * BOX, -5],
      ['B-07', '2026-11-15', 5 * BOX, 16],
    ]);

    // Twelve boxes sold: the oldest go first, three of the new batch are left
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [
          cartLine(1, 15_000, {
            productId: med.productId,
            variantId: med.variantId,
            name: med.name,
            qty: 12 * BOX,
          }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 180_000 }],
      }),
    );
    await push(app, store.device, [open, sold]);
    report = await expiry(store);
    expect(report.items.map((r) => [r.batchNo, r.qty])).toEqual([['B-07', 3 * BOX]]);
    sets = await pull(store);
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.nearestExpiry).toBe('2026-11-15');
    // Within 10 days, nothing
    expect((await expiry(store, 10)).items).toEqual([]);
  });

  it('a purchase line without an expiry changes nothing, and a cashier cannot read the report', async () => {
    const store = await openStore(app);
    const s = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: 'مورد' },
      })
    ).json<SupplierRow>();
    const med = await medicine(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(store),
      payload: {
        supplierId: s.id,
        date: '2026-10-29',
        payment: 'cash',
        lines: [{ variantId: med.variantId, qty: 2 * BOX, costMinor: 20_000 }],
      },
    });
    expect(res.json<PurchaseDetail>().lines[0]).toMatchObject({ batchNo: null, expiryDate: null });
    expect((await expiry(store)).items).toEqual([]);
    const sets = await pull(store);
    expect(sets.variants.upserts.find((v) => v.id === med.variantId)!.nearestExpiry).toBeNull();
    const bad = await app.inject({ method: 'GET', url: '/v1/inventory/expiry?days=0', headers: as(store) });
    expect(bad.statusCode).toBe(400);
  });
});
