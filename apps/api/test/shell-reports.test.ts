import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildReturnPayload,
  type DayReport,
  type ProductDetail,
  type SalePayload,
  type SalesBreakdown,
} from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/** Round 9: the day's best sellers net of returns, and the sales report's daily bars, seasons and cross-table. */

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

async function product(store: Store, nameAr: string, season: string | null, options: [string, string][]) {
  const made = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr,
      season,
      variants: options.map(([size, colour]) => ({
        attributes: [
          { name: 'المقاس', value: size },
          { name: 'اللون', value: colour },
        ],
        price: { currency: 'SYP', priceMinor: 100_000 },
      })),
    },
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json<ProductDetail>();
}

describe('the day report’s best sellers', () => {
  it('are net of the day’s returns and leave out a rental’s deposit refund', async () => {
    const store = await openStore(app);
    const shirt = await product(store, 'قميص قطني', null, [['M', 'أبيض']]);
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [
        cartLine(1, 100_000, {
          productId: shirt.id,
          variantId: shirt.variants[0]!.id,
          name: 'قميص',
          qty: 3 * PIECE,
        }),
        cartLine(2, 50_000, { name: 'ردّ العربون · RNT-000001' }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 350_000 }],
    });
    const sold = doc('sale', payload);
    const back = doc(
      'return',
      buildReturnPayload({
        sale: payload as SalePayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'المقاس',
        picks: [{ saleLineNo: 1, qty: PIECE }],
      }),
    );
    const pushed = await push(app, store.device, [open, sold, back]);
    expect(pushed.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);

    const report = (
      await app.inject({ method: 'GET', url: '/v1/reports/day?date=2026-10-30', headers: as(store) })
    ).json<DayReport>();
    expect(report.topProducts.map((p) => [p.name, p.qty, p.totalMinor])).toEqual([
      ['قميص قطني', 2 * PIECE, 200_000],
    ]);
  });
});

describe('the sales report', () => {
  it('adds the net sales of each day, a season’s received pieces and the size by colour cells', async () => {
    const store = await openStore(app);
    const shirt = await product(store, 'قميص صيفي', 'صيف 2026', [
      ['M', 'أبيض'],
      ['L', 'أسود'],
    ]);
    const supplier = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: 'المورد' },
      })
    ).json<{ id: string }>();
    const received = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(store),
      payload: {
        supplierId: supplier.id,
        date: '2026-10-20',
        payment: 'credit',
        lines: shirt.variants.map((v) => ({ variantId: v.id, qty: 5 * PIECE, costMinor: 50_000 })),
      },
    });
    expect(received.statusCode, received.body).toBe(201);

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [
        cartLine(1, 100_000, {
          productId: shirt.id,
          variantId: shirt.variants[0]!.id,
          name: 'قميص M',
          qty: 3 * PIECE,
        }),
        cartLine(2, 100_000, {
          productId: shirt.id,
          variantId: shirt.variants[1]!.id,
          name: 'قميص L',
          qty: PIECE,
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 400_000 }],
    });
    const sold = doc('sale', payload);
    const back = doc(
      'return',
      buildReturnPayload({
        sale: payload as SalePayload,
        saleId: sold.id,
        saleNumber: sold.number!,
        shiftId: open.id,
        cashierId: store.userId,
        reason: 'المقاس',
        picks: [{ saleLineNo: 1, qty: PIECE }],
      }),
    );
    const pushed = await push(app, store.device, [open, sold, back]);
    expect(pushed.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);

    const get = (q: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/reports/sales-breakdown?from=2026-10-01&to=2026-10-30&${q}`,
        headers: as(store),
      });

    const bySeason = (await get('by=season')).json<SalesBreakdown>();
    // 4 pieces sold, 1 back: 3 of the 10 received
    expect(bySeason.rows).toEqual([
      expect.objectContaining({ name: 'صيف 2026', qty: 3 * PIECE, receivedQty: 10 * PIECE }),
    ]);
    expect(bySeason.daily).toEqual([{ date: '2026-10-30', totalMinor: 300_000 }]);

    const byProduct = (await get('by=product')).json<SalesBreakdown>();
    expect(byProduct.rows[0]!.receivedQty).toBeNull();
    expect(byProduct.cross).toBeNull();

    const bySize = (await get(`by=option&option=${encodeURIComponent('المقاس')}`)).json<SalesBreakdown>();
    expect(bySize.cross).toMatchObject({ rowOption: 'المقاس', colOption: 'اللون' });
    expect(bySize.cross!.cells).toEqual(
      expect.arrayContaining([
        { row: 'M', col: 'أبيض', qty: 2 * PIECE, totalMinor: 200_000 },
        { row: 'L', col: 'أسود', qty: PIECE, totalMinor: 100_000 },
      ]),
    );
    expect(bySize.cross!.cells).toHaveLength(2);
  });
});
