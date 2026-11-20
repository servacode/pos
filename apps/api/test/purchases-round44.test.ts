import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ProductDetail,
  PurchaseCorrection,
  PurchaseDetail,
  PurchaseListResponse,
  PurchaseOrderDetail,
  SupplierListResponse,
  SupplierPaymentRow,
  SupplierReturnDetail,
  SupplierRow,
} from '@serva/core';
import { createUuidV7 } from '@serva/sync';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { STAFF_PASSWORD } from './staff';

/**
 * Round 44, purchases: a retry with the same document id posts once, a corrected invoice leaves the totals and
 * the returns, two payments at once cannot overpay, and a role given for one branch stays in that branch.
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

const newId = createUuidV7();
const as = (s: Pick<Store, 'accessToken'> | string) => ({
  authorization: `Bearer ${typeof s === 'string' ? s : s.accessToken}`,
});
const post = (token: Store | string, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: as(token), payload: payload as object });
const get = (token: Store | string, url: string) => app.inject({ method: 'GET', url, headers: as(token) });

async function setUp() {
  const store = await openStore(app);
  const variant = (
    await post(store, '/v1/products', {
      nameAr: 'قميص',
      variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }],
    })
  ).json<ProductDetail>().variants[0]!.id;
  const supplier = (await post(store, '/v1/suppliers', { name: 'معمل الأمل' })).json<SupplierRow>();
  return { store, variantId: variant, supplierId: supplier.id };
}

const stockOf = async (store: Store, variantId: string) => {
  const rows = await ownerDb()<{ qty: string }[]>`
    select coalesce(sum(qty), 0)::text as qty from stock_levels where tenant_id = ${store.tenantId} and variant_id = ${variantId}`;
  return Number(rows[0]!.qty);
};

const buy = (
  store: Store | string,
  supplierId: string,
  variantId: string,
  extra: Record<string, unknown> = {},
  qty = 5000,
  costMinor = 500_000,
) =>
  post(store, '/v1/purchases', {
    supplierId,
    date: '2026-10-30',
    payment: 'credit',
    lines: [{ variantId, qty, costMinor }],
    ...extra,
  });

describe('a retry with the same id posts once', () => {
  it('a purchase invoice', async () => {
    const { store, variantId, supplierId } = await setUp();
    const id = newId();
    const first = await buy(store, supplierId, variantId, { id });
    expect(first.statusCode, first.body).toBe(201);
    const again = await buy(store, supplierId, variantId, { id });
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<PurchaseDetail>().id).toBe(first.json<PurchaseDetail>().id);
    expect(again.json<PurchaseDetail>().number).toBe(first.json<PurchaseDetail>().number);
    expect(await stockOf(store, variantId)).toBe(5000);
    const list = (await get(store, '/v1/suppliers')).json<SupplierListResponse>();
    expect(list.items[0]!.balanceMinor).toBe(500_000);
  });

  it('two at the same moment too', async () => {
    const { store, variantId, supplierId } = await setUp();
    const id = newId();
    const both = await Promise.all([
      buy(store, supplierId, variantId, { id }, 1000, 100_000),
      buy(store, supplierId, variantId, { id }, 1000, 100_000),
    ]);
    expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(await stockOf(store, variantId)).toBe(1000);
  });

  it('a supplier payment', async () => {
    const { store, variantId, supplierId } = await setUp();
    await buy(store, supplierId, variantId);
    const body = { id: newId(), supplierId, date: '2026-10-30', amountMinor: 100_000, method: 'cash' };
    const first = await post(store, '/v1/supplier-payments', body);
    expect(first.statusCode, first.body).toBe(201);
    const again = await post(store, '/v1/supplier-payments', body);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<SupplierPaymentRow>()).toMatchObject({
      id: first.json<SupplierPaymentRow>().id,
      number: first.json<SupplierPaymentRow>().number,
      amountMinor: 100_000,
    });
    const list = (await get(store, '/v1/suppliers')).json<SupplierListResponse>();
    expect(list.items[0]!.balanceMinor).toBe(400_000);
  });

  it('a supplier return', async () => {
    const { store, variantId, supplierId } = await setUp();
    await buy(store, supplierId, variantId);
    const body = {
      id: newId(),
      supplierId,
      date: '2026-10-30',
      refund: 'credit',
      lines: [{ variantId, qty: 2000 }],
    };
    const first = await post(store, '/v1/supplier-returns', body);
    expect(first.statusCode, first.body).toBe(201);
    const again = await post(store, '/v1/supplier-returns', body);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<SupplierReturnDetail>()).toMatchObject({
      id: first.json<SupplierReturnDetail>().id,
      number: first.json<SupplierReturnDetail>().number,
      amountMinor: 200_000,
    });
    expect(await stockOf(store, variantId)).toBe(3000);
  });

  it('a purchase order', async () => {
    const { store, variantId, supplierId } = await setUp();
    const body = { id: newId(), supplierId, lines: [{ variantId, qty: 4000, costMinor: 400_000 }] };
    const first = await post(store, '/v1/purchase-orders', body);
    expect(first.statusCode, first.body).toBe(201);
    const again = await post(store, '/v1/purchase-orders', body);
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json<PurchaseOrderDetail>().number).toBe(first.json<PurchaseOrderDetail>().number);
    const rows = await ownerDb()`select 1 from purchase_orders where tenant_id = ${store.tenantId}`;
    expect(rows).toHaveLength(1);
  });
});

describe('two payments at once', () => {
  it('cannot both pass the «more than owed» check', async () => {
    const { store, variantId, supplierId } = await setUp();
    await buy(store, supplierId, variantId, {}, 1000, 100_000);
    const pay = () =>
      post(store, '/v1/supplier-payments', {
        supplierId,
        date: '2026-10-30',
        amountMinor: 100_000,
        method: 'cash',
      });
    const both = await Promise.all([pay(), pay()]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const list = (await get(store, '/v1/suppliers')).json<SupplierListResponse>();
    expect(list.items[0]!.balanceMinor).toBe(0);
  });
});

describe('a corrected invoice', () => {
  it('leaves the supplier totals, the list summary and the returns', async () => {
    const { store, variantId, supplierId } = await setUp();
    const bought = (await buy(store, supplierId, variantId)).json<PurchaseDetail>();
    const before = (await get(store, '/v1/suppliers')).json<SupplierListResponse>().items[0]!;
    expect(before.purchasesTotalMinor).toBe(500_000);
    const fixed = await post(store, `/v1/purchases/${bought.id}/correct`, {});
    expect(fixed.statusCode, fixed.body).toBe(201);
    expect(fixed.json<PurchaseCorrection>().reversal.id).toBeTruthy();
    const after = (await get(store, '/v1/suppliers')).json<SupplierListResponse>().items[0]!;
    expect(after.purchasesTotalMinor).toBe(0);
    expect(after.lastPurchaseOn).toBeNull();
    const list = (await get(store, '/v1/purchases?limit=10')).json<PurchaseListResponse>();
    expect(list.summary).toEqual({ count: 0, totalMinor: 0 });
    expect(list.items[0]!.correctedBy).not.toBeNull();
    // nothing more is returned against it
    const back = await post(store, '/v1/supplier-returns', {
      supplierId,
      date: '2026-10-30',
      refund: 'credit',
      purchaseId: bought.id,
      lines: [{ variantId, qty: 1000 }],
    });
    expect(back.statusCode, back.body).toBe(400);
  });
});

describe('the purchases list in pages', () => {
  it('pages newest first, searches and totals', async () => {
    const { store, variantId, supplierId } = await setUp();
    for (const [i, date] of ['2026-10-01', '2026-10-02', '2026-10-03'].entries()) {
      const res = await buy(
        store,
        supplierId,
        variantId,
        { date, payment: i === 1 ? 'cash' : 'credit', reference: `INV-${i}` },
        1000,
        100_000 * (i + 1),
      );
      expect(res.statusCode, res.body).toBe(201);
    }
    const one = (await get(store, '/v1/purchases?limit=2')).json<PurchaseListResponse>();
    expect(one.items.map((p) => p.date)).toEqual(['2026-10-03', '2026-10-02']);
    expect(one.nextCursor).toBeTruthy();
    expect(one.summary).toEqual({ count: 3, totalMinor: 600_000 });
    const two = (
      await get(store, `/v1/purchases?limit=2&cursor=${encodeURIComponent(one.nextCursor!)}`)
    ).json<PurchaseListResponse>();
    expect(two.items.map((p) => p.date)).toEqual(['2026-10-01']);
    expect(two.nextCursor).toBeNull();
    const found = (await get(store, '/v1/purchases?q=inv-1')).json<PurchaseListResponse>();
    expect(found.items).toHaveLength(1);
    expect(found.items[0]!.reference).toBe('INV-1');
    expect((await get(store, '/v1/purchases?payment=cash')).json<PurchaseListResponse>().items).toHaveLength(1);
    expect((await get(store, '/v1/purchases?cursor=bad')).statusCode).toBe(400);
    // without a limit the list is whole, as before
    const all = (await get(store, '/v1/purchases')).json<PurchaseListResponse>();
    expect(all.items).toHaveLength(3);
    expect(all.nextCursor).toBeNull();
  });
});

describe('a role given for one branch', () => {
  it('cannot post, read or correct in another branch', async () => {
    const { store, variantId, supplierId } = await setUp();
    const [branch2] = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${store.tenantId}, '002', 'فرع ثانٍ') returning id`;
    const bought = (await buy(store, supplierId, variantId)).json<PurchaseDetail>();
    const order = (
      await post(store, '/v1/purchase-orders', {
        supplierId,
        lines: [{ variantId, qty: 1000, costMinor: 1 }],
      })
    ).json<PurchaseOrderDetail>();
    const staff = await post(store, '/v1/staff', {
      fullName: 'منى المديرة',
      roleKey: 'manager',
      phone: '0966666666',
      password: STAFF_PASSWORD,
      pin: '482913',
      branchIds: [branch2!.id],
    });
    expect(staff.statusCode, staff.body).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '0966666666', password: STAFF_PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    const token = login.json<{ accessToken: string }>().accessToken;

    // the first branch's invoice is neither listed, nor read, nor corrected
    expect((await get(token, '/v1/purchases')).json<PurchaseListResponse>().items).toHaveLength(0);
    expect((await get(token, `/v1/purchases/${bought.id}`)).statusCode).toBe(404);
    expect((await post(token, `/v1/purchases/${bought.id}/correct`, {})).statusCode).toBe(404);
    expect((await get(token, '/v1/purchase-orders')).json<{ items: unknown[] }>().items).toHaveLength(0);
    expect((await get(token, `/v1/purchase-orders/${order.id}`)).statusCode).toBe(404);
    // and nothing is posted into it
    const into = await buy(token, supplierId, variantId, {}, 1000, 100_000);
    expect(into.statusCode, into.body).toBe(403);
    // …but into its own branch it can
    const own = await post(token, '/v1/purchases', {
      supplierId,
      branchId: branch2!.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId, qty: 1000, costMinor: 100_000 }],
    });
    expect(own.statusCode, own.body).toBe(201);
    expect((await get(token, '/v1/purchases')).json<PurchaseListResponse>().items).toHaveLength(1);
  });
});
