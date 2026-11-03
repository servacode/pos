import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BulkPriceResult, Category, ProductDetail } from '@serva/core';
import { movedPrice } from '../src/services/catalog/bulk-prices';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/** End-of-season prices (03 › الألبسة): a category and its sub-categories by a percent, rounded. */

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

async function category(store: Store, name: string, parentId: string | null = null) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/categories',
    headers: as(store),
    payload: { name, parentId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Category>();
}

async function product(
  store: Store,
  nameAr: string,
  categoryId: string,
  prices: number[],
  min: number | null = null,
) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr,
      categoryId,
      variants: prices.map((priceMinor, i) => ({
        attributes: [{ name: 'المقاس', value: ['M', 'L', 'XL'][i]! }],
        price: { currency: 'SYP', priceMinor },
        minPriceMinor: min,
      })),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

const bulk = (store: Store, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/prices/bulk', headers: as(store), payload });

describe('bulk price change', () => {
  it('shows then applies 30% off a category and its sub-categories, rounded to 500, and leaves the rest', async () => {
    const store = await openStore(app);
    const summer = await category(store, 'صيفي');
    const shirts = await category(store, 'قمصان', summer.id);
    const winter = await category(store, 'شتوي');
    const shirt = await product(store, 'قميص', shirts.id, [4_500_000, 4_600_000], 4_000_000);
    const coat = await product(store, 'معطف', winter.id, [9_000_000]);

    const preview = await bulk(store, { categoryId: summer.id, percentBp: -3000, roundToMinor: 50_000 });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<BulkPriceResult>()).toEqual({
      applied: false,
      items: [
        // 31,500 and 32,200 → 32,000 (to the nearest 500)
        {
          productId: shirt.id,
          variantId: shirt.variants[0]!.id,
          name: 'قميص M',
          currency: 'SYP',
          oldMinor: 4_500_000,
          newMinor: 3_150_000,
        },
        {
          productId: shirt.id,
          variantId: shirt.variants[1]!.id,
          name: 'قميص L',
          currency: 'SYP',
          oldMinor: 4_600_000,
          newMinor: 3_200_000,
        },
      ],
    });
    // Nothing moved yet
    let read = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(read.variants[0]!.price.priceMinor).toBe(4_500_000);

    const applied = await bulk(store, {
      categoryId: summer.id,
      percentBp: -3000,
      roundToMinor: 50_000,
      apply: true,
    });
    expect(applied.json<BulkPriceResult>().applied).toBe(true);
    read = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(read.variants.map((v) => [v.price.priceMinor, v.minPriceMinor])).toEqual([
      [3_150_000, 2_800_000],
      [3_200_000, 2_800_000],
    ]);
    expect(read.version).toBeGreaterThan(shirt.version);
    const coatNow = (
      await app.inject({ method: 'GET', url: `/v1/products/${coat.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(coatNow.variants[0]!.price.priceMinor).toBe(9_000_000);
  });

  it('refuses no percent, too much off, and an unknown category', async () => {
    const store = await openStore(app);
    const c = await category(store, 'صيفي');
    expect((await bulk(store, { categoryId: c.id, percentBp: 0 })).statusCode).toBe(400);
    expect((await bulk(store, { categoryId: c.id, percentBp: -9500 })).statusCode).toBe(400);
    expect(
      (await bulk(store, { categoryId: '0192a3b4-c5d6-7e8f-9a0b-000000000099', percentBp: -1000 }))
        .statusCode,
    ).toBe(404);
  });

  it('moves and rounds a price, never below one step', () => {
    expect(movedPrice(4_500_000, -3000, 50_000)).toBe(3_150_000);
    expect(movedPrice(4_600_000, -3000, 50_000)).toBe(3_200_000);
    expect(movedPrice(1_000, 2000, 1)).toBe(1_200);
    expect(movedPrice(10_000, -9000, 50_000)).toBe(50_000);
  });
});
