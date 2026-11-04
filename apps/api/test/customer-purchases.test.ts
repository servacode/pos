import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CustomerPurchases, ProductDetail } from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase, settled } from './helpers';

/** A customer's sizes and latest invoices (03 › الألبسة: سجل الزبون ومقاسه), on the till and the dashboard. */

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

describe('a customer’s purchases', () => {
  it('shows the sizes they buy most and their latest invoices, newest first', async () => {
    const store = await openStore(app);
    const shirt = (
      await app.inject({
        method: 'POST',
        url: '/v1/products',
        headers: as(store),
        payload: {
          nameAr: 'قميص',
          variants: ['M', 'L'].map((size) => ({
            attributes: [
              { name: 'المقاس', value: size },
              { name: 'اللون', value: 'أبيض' },
            ],
            price: { currency: 'SYP', priceMinor: 100_000 },
          })),
        },
      })
    ).json<ProductDetail>();
    const [m, l] = shirt.variants;
    const reem = (
      await app.inject({ method: 'POST', url: '/v1/customers', headers: as(store), payload: { name: 'ريم' } })
    ).json<{ id: string }>();

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const line = (no: number, variantId: string, qty: number) =>
      cartLine(no, 100_000, { productId: shirt.id, variantId, qty, name: 'قميص' });
    const first = doc(
      'sale',
      sale(store, open.id, {
        customerId: reem.id,
        customerName: 'ريم',
        lines: [line(1, m!.id, 2000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 200_000 }],
      }),
    );
    const second = doc(
      'sale',
      sale(store, open.id, {
        customerId: reem.id,
        customerName: 'ريم',
        lines: [line(1, l!.id, 1000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100_000 }],
      }),
    );
    // Someone else's sale is not hers
    const other = doc(
      'sale',
      sale(store, open.id, {
        lines: [line(1, l!.id, 5000)],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 500_000 }],
      }),
    );
    await push(app, store.device, [open, first, second, other]);
    await settled();

    const res = await app.inject({
      method: 'GET',
      url: `/v1/customers/${reem.id}/purchases`,
      headers: as(store),
    });
    expect(res.statusCode, res.body).toBe(200);
    const got = res.json<CustomerPurchases>();
    // Colour is not a size
    expect(got.sizes).toEqual([
      {
        name: 'المقاس',
        values: [
          { value: 'M', qty: 2000 },
          { value: 'L', qty: 1000 },
        ],
      },
    ]);
    expect(got.invoices.map((i) => i.number)).toHaveLength(2);
    expect(got.invoices[0]!.lines).toEqual([
      { name: 'قميص', qty: 1000, totalMinor: 100_000, returnedQty: 0 },
    ]);
    expect([got.pieces, got.spentMinor]).toEqual([3000, 300_000]);

    // The till sees the same
    const onTill = await app.inject({
      method: 'GET',
      url: `/v1/device/customers/${reem.id}/purchases`,
      headers: { authorization: store.device.authorization },
    });
    expect(onTill.json<CustomerPurchases>()).toEqual(got);
  });

  it('answers 404 for a customer that is not there', async () => {
    const store = await openStore(app);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/customers/0192a3b4-c5d6-7e8f-9a0b-000000000001/purchases',
      headers: as(store),
    });
    expect(res.statusCode).toBe(404);
  });
});
