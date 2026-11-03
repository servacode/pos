import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  InventoryResponse,
  ProfitReport,
  PurchaseDetail,
  StocktakeDetail,
  SupplierListResponse,
  SupplierRow,
} from '@serva/core';
import { withTenant } from '@serva/db';
import { checkIntegrity } from '../src/services/integrity';
import {
  balances,
  cartLine,
  compact,
  documents,
  makeProduct,
  openStore,
  postedEntries,
  push,
  sale,
  shiftOpen,
  type Store,
} from './accounting-fixtures';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Purchases and stock cost (contracts/purchases.ts; 10 › الكلفة والربح): goods in at what they
 * cost, the cost of what was sold at the running average by value, counts, payments to suppliers,
 * and the profit — all of it in the books, and the stock's value always equal to account 1300.
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
const PIECE = 1000;

async function supplier(store: Store, name = 'مؤسسة الفرات للتوزيع') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: as(store),
    payload: { name },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<SupplierRow>();
}

async function buy(store: Store, body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/v1/purchases', headers: as(store), payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PurchaseDetail>();
}

/** A shift and a cash sale of `pieces` of the product */
async function sell(
  store: Store,
  product: { productId: string; variantId: string; name: string },
  pieces: number,
  price: number,
) {
  const doc = documents(store.device);
  const open = doc('shift_open', shiftOpen(store.userId));
  const sold = doc(
    'sale',
    sale(store, open.id, {
      lines: [cartLine(1, price, { ...product, qty: pieces * PIECE })],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: price * pieces }],
    }),
  );
  await push(app, store.device, [open, sold]);
  return sold;
}

const integrity = (store: Store) =>
  withTenant(appDb().db, store.tenantId, (tx) => checkIntegrity(tx, store.tenantId)).then((r) =>
    r.checks.flatMap((c) => c.problems),
  );

describe('a purchase', () => {
  it('on account: stock in at its cost, Dr 1300 / Cr 2100 for the supplier, who is then owed', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const p = await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      reference: 'F-100',
      lines: [{ variantId: milk.variantId, qty: 10 * PIECE, costMinor: 200_000 }],
    });
    expect(p).toMatchObject({ number: 'PUR-2026-000001', totalMinor: 200_000, supplierName: s.name });
    const entry = (await postedEntries(store.tenantId)).find((e) => e.sourceType === 'purchase');
    expect(compact(entry)).toEqual([
      ['1300', 200_000, 0],
      ['2100', 0, 200_000],
    ]);
    const list = (
      await app.inject({ method: 'GET', url: '/v1/suppliers', headers: as(store) })
    ).json<SupplierListResponse>();
    expect(list).toMatchObject({ totalOwedMinor: 200_000, items: [{ id: s.id, balanceMinor: 200_000 }] });
    const stock = (
      await app.inject({ method: 'GET', url: '/v1/inventory', headers: as(store) })
    ).json<InventoryResponse>();
    expect(stock.items).toEqual([
      expect.objectContaining({
        variantId: milk.variantId,
        qty: 10 * PIECE,
        valueMinor: 200_000,
        unitCostMinor: 20_000,
      }),
    ]);
    expect(await integrity(store)).toEqual([]);
  });

  it('paid from the safe or the bank, and a payment to the supplier clears what is owed', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'cash',
      lines: [{ variantId: milk.variantId, qty: PIECE, costMinor: 20_000 }],
    });
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: milk.variantId, qty: PIECE, costMinor: 20_000 }],
    });
    const paid = await app.inject({
      method: 'POST',
      url: '/v1/supplier-payments',
      headers: as(store),
      payload: { supplierId: s.id, date: '2026-10-31', amountMinor: 20_000, method: 'bank' },
    });
    expect(paid.statusCode, paid.body).toBe(201);
    expect(paid.json()).toMatchObject({ number: 'PAY-2026-000001' });
    const b = await balances(store.tenantId);
    expect(b.get('112001')?.base).toBe(-20_000);
    expect(b.get('1130')?.base).toBe(-20_000);
    expect(b.get('2100')?.base).toBe(0);
    expect(b.get('1300')?.base).toBe(40_000);
  });

  it('refuses a service, an unknown supplier and the same item twice, in Arabic', async () => {
    const store = await openStore(app);
    const milk = await makeProduct(app, store, 'حليب', 25_000);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(store),
      payload: {
        supplierId: '0192a3b4-c5d6-7e8f-9a0b-000000000001',
        date: '2026-10-30',
        payment: 'credit',
        lines: [
          { variantId: milk.variantId, qty: PIECE, costMinor: 1 },
          { variantId: milk.variantId, qty: PIECE, costMinor: 1 },
        ],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.lines).toBe('كل صنف مرة واحدة في الفاتورة');
    const s = await supplier(store);
    const ghost = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(store),
      payload: {
        supplierId: s.id,
        date: '2026-10-30',
        payment: 'credit',
        lines: [{ variantId: '0192a3b4-c5d6-7e8f-9a0b-000000000002', qty: PIECE, costMinor: 1 }],
      },
    });
    expect(ghost.json().error.fields['lines.0.variantId']).toBe('صنف غير موجود أو خدمة لا مخزون لها');
  });
});

describe('the cost of what was sold', () => {
  it('the worked example of tab 10: 10 at 20,000 then 20 at 46,000; six sold cost 13,200', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const box = await makeProduct(app, store, 'علبة', 3_000_00);
    for (const [qty, cost] of [
      [10, 20_000_00],
      [20, 46_000_00],
    ] as const) {
      await buy(store, {
        supplierId: s.id,
        date: '2026-10-30',
        payment: 'credit',
        lines: [{ variantId: box.variantId, qty: qty * PIECE, costMinor: cost }],
      });
    }
    await sell(store, box, 6, 3_000_00);
    const cost = (await postedEntries(store.tenantId)).filter((e) => e.sourceType === 'cost_of_sales');
    expect(cost.map(compact)).toEqual([
      [
        ['5100', 13_200_00, 0],
        ['1300', 0, 13_200_00],
      ],
    ]);
    const profit = (
      await app.inject({
        method: 'GET',
        url: '/v1/reports/profit?from=2026-10-01&to=2026-10-31',
        headers: as(store),
      })
    ).json<ProfitReport>();
    expect(profit).toMatchObject({
      netSalesMinor: 18_000_00,
      costOfSalesMinor: 13_200_00,
      grossProfitMinor: 4_800_00,
    });
    expect(await integrity(store)).toEqual([]);
  });

  it('is costed once, however often the device sends the sale', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const box = await makeProduct(app, store, 'علبة', 1_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: box.variantId, qty: 5 * PIECE, costMinor: 3_000 }],
    });
    const sold = await sell(store, box, 2, 1_000);
    await push(app, store.device, [sold]);
    const [n] = await ownerDb()<{ n: string }[]>`
      select count(*) as n from movement_costs where tenant_id = ${store.tenantId}`;
    expect(n!.n).toBe('1');
    expect((await balances(store.tenantId)).get('5100')?.base).toBe(1_200);
  });

  it('sold before it was bought: costs nothing then, and the purchase settles it to the cost of sales', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const box = await makeProduct(app, store, 'علبة', 1_000);
    await sell(store, box, 2, 1_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [{ variantId: box.variantId, qty: 5 * PIECE, costMinor: 5_000 }],
    });
    const b = await balances(store.tenantId);
    // The two pieces really cost 2,000; three stay at 3,000
    expect(b.get('5100')?.base).toBe(2_000);
    expect(b.get('1300')?.base).toBe(3_000);
    expect(await integrity(store)).toEqual([]);
  });
});

describe('a count of the shelves', () => {
  it('posts a shortage to 6300 and a surplus back, at the running average', async () => {
    const store = await openStore(app);
    const s = await supplier(store);
    const tea = await makeProduct(app, store, 'شاي', 5_000);
    const oil = await makeProduct(app, store, 'زيت', 9_000);
    await buy(store, {
      supplierId: s.id,
      date: '2026-10-30',
      payment: 'credit',
      lines: [
        { variantId: tea.variantId, qty: 10 * PIECE, costMinor: 30_000 },
        { variantId: oil.variantId, qty: 4 * PIECE, costMinor: 24_000 },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stocktakes',
      headers: as(store),
      payload: {
        date: '2026-10-31',
        note: 'جرد آخر الشهر',
        lines: [
          { variantId: tea.variantId, countedQty: 8 * PIECE },
          { variantId: oil.variantId, countedQty: 5 * PIECE },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const count = res.json<StocktakeDetail>();
    expect(count).toMatchObject({ number: 'STK-2026-000001', diffValueMinor: 0 });
    expect(count.lines.map((l) => [l.expectedQty, l.countedQty, l.diffQty, l.diffValueMinor])).toEqual([
      [10 * PIECE, 8 * PIECE, -2 * PIECE, -6_000],
      [4 * PIECE, 5 * PIECE, PIECE, 6_000],
    ]);
    const levels = await ownerDb()<{ variant_id: string; qty: string }[]>`
      select variant_id, qty from stock_levels where tenant_id = ${store.tenantId} order by qty`;
    expect(levels.map((l) => Number(l.qty)).sort()).toEqual([5 * PIECE, 8 * PIECE].sort());
    expect(await integrity(store)).toEqual([]);
  });
});

describe('who may', () => {
  it('purchases and suppliers need purchases.manage; the stock value cost.view; counts inventory.adjust', async () => {
    const store = await openStore(app);
    const { staffUser } = await import('./staff');
    const cashier = await staffUser(
      app,
      { ...store, branchId: store.device.branchId },
      'cashier',
      '0944000009',
    );
    for (const [method, url] of [
      ['GET', '/v1/suppliers'],
      ['GET', '/v1/purchases'],
      ['GET', '/v1/inventory'],
      ['GET', '/v1/reports/profit?from=2026-10-01&to=2026-10-31'],
    ] as const) {
      expect((await app.inject({ method, url, headers: as(cashier) })).statusCode, url).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/stocktakes',
          headers: as(cashier),
          payload: { date: '2026-10-31', lines: [{ variantId: store.userId, countedQty: 0 }] },
        })
      ).statusCode,
    ).toBe(403);
  });
});
