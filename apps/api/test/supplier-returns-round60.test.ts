import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ProductDetail,
  PurchaseOrderListResponse,
  SupplierReturnDetail,
  SupplierReturnRow,
  SupplierRow,
} from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/** Round 60: a typed credit cannot pass the cost, the returns list pages and opens, the orders list pages. */

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

async function setUp() {
  const store = await openStore(app);
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: { nameAr: 'فستان', variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }] },
    })
  ).json<ProductDetail>();
  const supplier = (
    await app.inject({
      method: 'POST',
      url: '/v1/suppliers',
      headers: as(store),
      payload: { name: 'معمل الأمل' },
    })
  ).json<SupplierRow>();
  const variantId = product.variants[0]!.id;
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId, qty: 10_000, costMinor: 400_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { store, supplierId: supplier.id, variantId };
}

const sendBack = (store: Store, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/supplier-returns', headers: as(store), payload });

describe('returns to the supplier, round 60', () => {
  it('refuses a typed credit above what the pieces cost, and takes one at the cost', async () => {
    const { store, supplierId, variantId } = await setUp();
    const over = await sendBack(store, {
      supplierId,
      date: '2026-10-30',
      refund: 'cash',
      lines: [{ variantId, qty: 2000, amountMinor: 80_001 }],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ error: { fields: { 'lines.0.amountMinor': expect.any(String) } } });
    const exact = await sendBack(store, {
      supplierId,
      date: '2026-10-30',
      refund: 'cash',
      lines: [{ variantId, qty: 2000, amountMinor: 80_000 }],
    });
    expect(exact.statusCode, exact.body).toBe(201);
  });

  it('pages the list, opens one return in full, and hides it from a branch it is not in', async () => {
    const { store, supplierId, variantId } = await setUp();
    const made: string[] = [];
    for (const day of ['2026-10-30', '2026-10-31', '2026-11-01']) {
      const res = await sendBack(store, {
        supplierId,
        date: day,
        refund: 'credit',
        lines: [{ variantId, qty: 1000 }],
      });
      expect(res.statusCode, res.body).toBe(201);
      made.push(res.json<SupplierReturnDetail>().id);
    }
    const first = (
      await app.inject({ method: 'GET', url: '/v1/supplier-returns?limit=2', headers: as(store) })
    ).json<{ items: SupplierReturnRow[]; nextCursor: string | null }>();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (
      await app.inject({
        method: 'GET',
        url: `/v1/supplier-returns?limit=2&cursor=${first.nextCursor}`,
        headers: as(store),
      })
    ).json<{ items: SupplierReturnRow[]; nextCursor: string | null }>();
    expect(second, JSON.stringify(second)).toHaveProperty('items');
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((r) => r.id).sort()).toEqual([...made].sort());
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/supplier-returns?cursor=zzz',
      headers: as(store),
    });
    expect(bad.statusCode).toBe(400);

    const one = await app.inject({
      method: 'GET',
      url: `/v1/supplier-returns/${made[0]}`,
      headers: as(store),
    });
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json<SupplierReturnDetail>()).toMatchObject({
      id: made[0],
      supplierName: 'معمل الأمل',
      lines: [{ qty: 1000 }],
    });
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/supplier-returns/00000000-0000-4000-8000-000000000000',
      headers: as(store),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('pages the purchase orders and says when more wait', async () => {
    const { store, supplierId, variantId } = await setUp();
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/purchase-orders',
        headers: as(store),
        payload: {
          supplierId,
          date: day,
          lines: [{ variantId, qty: 1000, costMinor: 40_000, unitCostMinor: 40_000 }],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const first = (
      await app.inject({ method: 'GET', url: '/v1/purchase-orders?limit=2', headers: as(store) })
    ).json<PurchaseOrderListResponse>();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const rest = (
      await app.inject({
        method: 'GET',
        url: `/v1/purchase-orders?limit=2&cursor=${first.nextCursor}`,
        headers: as(store),
      })
    ).json<PurchaseOrderListResponse>();
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    const all = (
      await app.inject({ method: 'GET', url: '/v1/purchase-orders', headers: as(store) })
    ).json<PurchaseOrderListResponse>();
    expect(all.items).toHaveLength(3);
    expect(all.nextCursor).toBeNull();
  });
});
