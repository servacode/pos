import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildReturnPayload, type ProductDetail, type SalePayload, type SalesBreakdown } from '@serva/core';
import { previousPeriod } from '../src/services/sales-breakdown';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/** «تقرير المبيعات»: by product, category, option and seller, net of returns, against the period before. */

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
const get = (store: Store, q: string) =>
  app.inject({ method: 'GET', url: `/v1/reports/sales-breakdown?${q}`, headers: as(store) });

describe('previousPeriod', () => {
  it('is the same number of days just before', () => {
    expect(previousPeriod('2026-10-10', '2026-10-16')).toEqual({ from: '2026-10-03', to: '2026-10-09' });
    expect(previousPeriod('2026-03-01', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
  });
});

describe('the sales report', () => {
  it('groups by product, option and seller, net of the return, and refuses a wrong query in Arabic', async () => {
    const store = await openStore(app);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr: 'قميص قطني',
        variants: [
          {
            attributes: [
              { name: 'المقاس', value: 'M' },
              { name: 'اللون', value: 'أبيض' },
            ],
            price: { currency: 'SYP', priceMinor: 100_000 },
          },
        ],
      },
    });
    const shirt = made.json<ProductDetail>();
    const variantId = shirt.variants[0]!.id;
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [
        cartLine(1, 100_000, { productId: shirt.id, variantId, name: 'قميص M · أبيض', qty: 3 * PIECE }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 300_000 }],
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

    const byProduct = (await get(store, 'from=2026-10-01&to=2026-10-30&by=product')).json<SalesBreakdown>();
    expect(byProduct).toMatchObject({
      previousFrom: '2026-09-01',
      previousTo: '2026-09-30',
      totalMinor: 200_000,
    });
    expect(byProduct.rows).toEqual([
      expect.objectContaining({
        name: 'قميص قطني',
        qty: 2 * PIECE,
        totalMinor: 200_000,
        returnedMinor: 100_000,
        invoiceCount: 1,
        previousTotalMinor: 0,
      }),
    ]);
    expect(byProduct.optionNames).toEqual(['اللون', 'المقاس']);

    const byOption = (
      await get(store, `from=2026-10-01&to=2026-10-30&by=option&option=${encodeURIComponent('المقاس')}`)
    ).json<SalesBreakdown>();
    expect(byOption.rows.map((r) => [r.name, r.totalMinor])).toEqual([['M', 200_000]]);

    const bySeller = (await get(store, 'from=2026-10-01&to=2026-10-30&by=seller')).json<SalesBreakdown>();
    expect(bySeller.rows).toHaveLength(1);
    expect(bySeller.rows[0]!.totalMinor).toBe(200_000);

    const byCategory = (await get(store, 'from=2026-10-01&to=2026-10-30&by=category')).json<SalesBreakdown>();
    expect(byCategory.rows.map((r) => [r.name, r.totalMinor])).toEqual([['بلا تصنيف', 200_000]]);

    const wrong = await get(store, 'from=2026-10-30&to=2026-10-01&by=product');
    expect(wrong.statusCode).toBe(400);
    expect(JSON.stringify(wrong.json())).toContain('نهاية المدة قبل بدايتها');
    expect((await get(store, 'from=2026-10-01&to=2026-10-30&by=option')).statusCode).toBe(400);
  });
});
