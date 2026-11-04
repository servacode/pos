import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type MerchandiseReport,
  type ProductDetail,
  type SalePayload,
  type SupplierRow,
} from '@serva/core';
import { optionOrder } from '../src/services/merchandise';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Clothing reports (03 › الألبسة): sales by size and colour net of what came back, the models with
 * their pieces, and the pieces that sleep on the shelf.
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

async function product(store: Store, nameAr: string, options: [string, string][]) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr,
      variants: options.map(([size, colour]) => ({
        attributes: [
          { name: 'المقاس', value: size },
          { name: 'اللون', value: colour },
        ],
        price: { currency: 'SYP', priceMinor: 100_000 },
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

async function receive(store: Store, supplierId: string, date: string, lines: [string, number][]) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId,
      date,
      payment: 'credit',
      lines: lines.map(([variantId, pieces]) => ({
        variantId,
        qty: pieces * PIECE,
        costMinor: pieces * 10_000,
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

const report = async (store: Store, q: string) =>
  app.inject({ method: 'GET', url: `/v1/reports/merchandise?${q}`, headers: as(store) });

describe('the clothing report', () => {
  it('sells by size and colour, follows each model’s pieces, and finds what sleeps', async () => {
    const store = await openStore(app);
    const supplier = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: 'معمل' },
      })
    ).json<SupplierRow>();
    // Sizes made out of order: the report hangs them S, M, L
    const shirt = await product(store, 'قميص قطني', [
      ['L', 'أبيض'],
      ['M', 'أبيض'],
      ['M', 'أسود'],
    ]);
    const [lWhite, mWhite, mBlack] = shirt.variants.map((v) => v.id) as [string, string, string];
    const jacket = await product(store, 'سترة', [['XL', 'كحلي']]);
    const trousers = await product(store, 'بنطال', [['32', 'أزرق']]);
    await receive(store, supplier.id, '2026-07-01', [
      [lWhite, 5],
      [mWhite, 5],
      [mBlack, 5],
      [jacket.variants[0]!.id, 3],
    ]);
    // Arrived last week: new, not sleeping
    await receive(store, supplier.id, '2026-10-25', [[trousers.variants[0]!.id, 4]]);

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const soldPayload = sale(store, open.id, {
      lines: [
        cartLine(1, 100_000, {
          productId: shirt.id,
          variantId: mWhite,
          name: 'قميص M · أبيض',
          qty: 2 * PIECE,
        }),
        cartLine(2, 100_000, { productId: shirt.id, variantId: lWhite, name: 'قميص L · أبيض' }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 300_000 }],
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
        reason: 'المقاس كبير',
        picks: [{ saleLineNo: 2, qty: PIECE }],
      }),
    );
    const pushed = await push(app, store.device, [open, sold, back]);
    expect(pushed.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);

    const res = await report(store, 'from=2026-10-01&to=2026-10-30');
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json<MerchandiseReport>();
    expect(r).toMatchObject({ today: '2026-10-30', idleDays: 60, baseCurrency: 'SYP' });
    expect(r.byOption).toEqual([
      {
        name: 'المقاس',
        values: [
          { value: 'M', soldQty: 2 * PIECE, returnedQty: 0, totalMinor: 200_000 },
          { value: 'L', soldQty: PIECE, returnedQty: PIECE, totalMinor: 100_000 },
        ],
      },
      {
        name: 'اللون',
        values: [{ value: 'أبيض', soldQty: 3 * PIECE, returnedQty: PIECE, totalMinor: 300_000 }],
      },
    ]);
    expect(r.models).toEqual([
      {
        productId: shirt.id,
        name: 'قميص قطني',
        soldQty: 3 * PIECE,
        totalMinor: 300_000,
        pieces: [
          { variantId: lWhite, label: 'L · أبيض', soldQty: PIECE, stockQty: 5 * PIECE },
          { variantId: mWhite, label: 'M · أبيض', soldQty: 2 * PIECE, stockQty: 3 * PIECE },
          { variantId: mBlack, label: 'M · أسود', soldQty: 0, stockQty: 5 * PIECE },
        ],
      },
    ]);
    // The black shirt and the jacket came in July and never sold; the owner sees their cost
    expect(
      r.slowMovers.map((s) => [s.variantId, s.stockQty, s.valueMinor, s.lastSoldOn, s.lastReceivedOn]),
    ).toEqual(
      expect.arrayContaining([
        [mBlack, 5 * PIECE, 50_000, null, '2026-07-01'],
        [jacket.variants[0]!.id, 3 * PIECE, 30_000, null, '2026-07-01'],
      ]),
    );
    expect(r.slowMovers).toHaveLength(2);
    expect(r.slowValueMinor).toBe(80_000);

    // The cashier sold it all: 3,000 sold, 1,000 came back
    expect(r.bySeller).toEqual([
      {
        userId: store.userId,
        fullName: expect.any(String),
        invoiceCount: 1,
        totalMinor: 300_000,
        returnedMinor: 100_000,
      },
    ]);
    // No category yet: one line for goods without a department
    expect(r.byDepartment).toEqual([
      {
        categoryId: null,
        name: 'بلا قسم',
        soldQty: 3 * PIECE,
        totalMinor: 300_000,
        returnedQty: PIECE,
        returnedMinor: 100_000,
      },
    ]);
    // A department with none of these goods shows none of them
    const kids = (
      await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: as(store),
        payload: { name: 'ولادي', parentId: null },
      })
    ).json<{ id: string }>();
    const onlyKids = (
      await report(store, `from=2026-10-01&to=2026-10-30&categoryId=${kids.id}`)
    ).json<MerchandiseReport>();
    expect(onlyKids.byOption).toEqual([]);
    expect(onlyKids.models).toEqual([]);
    expect(onlyKids.slowMovers).toEqual([]);
    expect(onlyKids.bySeller).toHaveLength(1);

    // The shirts move into «ولادي › قمصان»: the whole period counts under «ولادي»
    const shirts = (
      await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: as(store),
        payload: { name: 'قمصان', parentId: kids.id },
      })
    ).json<{ id: string }>();
    await ownerDb()`update products set category_id = ${shirts.id} where id = ${shirt.id}`;
    const byDept = (await report(store, 'from=2026-10-01&to=2026-10-30')).json<MerchandiseReport>();
    expect(byDept.byDepartment).toEqual([
      expect.objectContaining({
        categoryId: kids.id,
        name: 'ولادي',
        totalMinor: 300_000,
        returnedMinor: 100_000,
      }),
    ]);

    // «قرّب يخلص»: M white sold 2 and has 3 left; the jacket is under the minimum its owner set
    await ownerDb()`update variants set min_stock_qty = 5000 where id = ${jacket.variants[0]!.id}`;
    const low = (await report(store, 'from=2026-10-01&to=2026-10-30&lowQty=3')).json<MerchandiseReport>();
    expect(low.lowStock.map((x) => [x.variantId, x.stockQty, x.soldQty, x.minStockQty])).toEqual([
      [mWhite, 3 * PIECE, 2 * PIECE, null],
      [jacket.variants[0]!.id, 3 * PIECE, 0, 5 * PIECE],
    ]);
    // At the default of 2 pieces, M white is not short yet
    expect(r.lowStock.map((x) => x.variantId)).not.toContain(mWhite);

    // Within 150 days nothing has slept that long
    const longer = (
      await report(store, 'from=2026-10-01&to=2026-10-30&idleDays=150')
    ).json<MerchandiseReport>();
    expect(longer.slowMovers).toEqual([]);
    // Before the sale, nothing sold
    const before = (await report(store, 'from=2026-09-01&to=2026-09-30')).json<MerchandiseReport>();
    expect(before.byOption).toEqual([]);
    expect(before.models).toEqual([]);
  });

  it('refuses a period that ends before it starts, and a stranger', async () => {
    const store = await openStore(app);
    expect((await report(store, 'from=2026-10-30&to=2026-10-01')).statusCode).toBe(400);
    expect((await report(store, 'from=2026-10-01&to=2026-10-30&idleDays=2')).statusCode).toBe(400);
    const anonymous = await app.inject({
      method: 'GET',
      url: '/v1/reports/merchandise?from=2026-10-01&to=2026-10-30',
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('offers back the options and values the store already used, first use first', async () => {
    const store = await openStore(app);
    await product(store, 'قميص', [
      ['M', 'أبيض'],
      ['L', 'زيتي فاتح'],
    ]);
    await product(store, 'قميص آخر', [['S', 'أبيض']]);
    const res = await app.inject({ method: 'GET', url: '/v1/products/options', headers: as(store) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      options: [
        { name: 'المقاس', values: ['M', 'L', 'S'] },
        { name: 'اللون', values: ['أبيض', 'زيتي فاتح'] },
      ],
    });
  });

  it('hangs sizes the way a shop does', () => {
    const at = (values: string[]) => optionOrder(values.map((value, position) => ({ value, position })));
    expect(at(['XL', 's', 'M', 'XXL', 'XS'])).toEqual(['XS', 's', 'M', 'XL', 'XXL']);
    expect(at(['42', '38', '40'])).toEqual(['38', '40', '42']);
    expect(at(['أحمر', 'أبيض'])).toEqual(['أحمر', 'أبيض']);
    expect(at(['L', '40', 'أحمر'])).toEqual(['L', '40', 'أحمر']);
  });
});
