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
          wasMinor: 4_500_000,
        },
        {
          productId: shirt.id,
          variantId: shirt.variants[1]!.id,
          name: 'قميص L',
          currency: 'SYP',
          oldMinor: 4_600_000,
          newMinor: 3_200_000,
          wasMinor: 4_600_000,
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
    // The price before the markdown stays, struck through on the labels
    expect(read.variants.map((v) => v.wasPriceMinor)).toEqual([4_500_000, 4_600_000]);
    expect(coatNow.variants[0]!.wasPriceMinor).toBeNull();

    // A second markdown keeps the first price struck through
    await bulk(store, { categoryId: summer.id, percentBp: -1000, roundToMinor: 50_000, apply: true });
    read = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(read.variants.map((v) => [v.price.priceMinor, v.wasPriceMinor])).toEqual([
      [2_850_000, 4_500_000],
      [2_900_000, 4_600_000],
    ]);

    // «أنهِ التنزيل»: back at the old prices, nothing struck through
    const ended = await bulk(store, { categoryId: summer.id, mode: 'restore', apply: true });
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json<BulkPriceResult>().items.map((i) => [i.oldMinor, i.newMinor, i.wasMinor])).toEqual([
      [2_850_000, 4_500_000, null],
      [2_900_000, 4_600_000, null],
    ]);
    read = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(read.variants.map((v) => [v.price.priceMinor, v.wasPriceMinor])).toEqual([
      [4_500_000, null],
      [4_600_000, null],
    ]);
  });

  it('writes each piece into the price history, with its old and new price', async () => {
    const store = await openStore(app);
    const summer = await category(store, 'صيفي');
    const shirt = await product(store, 'قميص', summer.id, [4_500_000, 4_600_000]);
    const applied = await bulk(store, {
      categoryId: summer.id,
      percentBp: -3000,
      roundToMinor: 50_000,
      apply: true,
    });
    expect(applied.statusCode, applied.body).toBe(200);
    const history = await app.inject({ method: 'GET', url: '/v1/price-history', headers: as(store) });
    const rows = history.json<{
      items: {
        source: string;
        productName: string | null;
        oldMinor: number | null;
        newMinor: number | null;
      }[];
    }>().items;
    const bulkRows = rows.filter((r) => r.source === 'bulk');
    expect(bulkRows).toHaveLength(2);
    expect(bulkRows.map((r) => [r.productName, r.oldMinor, r.newMinor]).sort()).toEqual([
      ['قميص', 4_500_000, 3_150_000],
      ['قميص', 4_600_000, 3_200_000],
    ]);
    expect(shirt.variants).toHaveLength(2);
  });

  it('marks down without a struck price when asked', async () => {
    const store = await openStore(app);
    const summer = await category(store, 'صيفي');
    const shirt = await product(store, 'قميص', summer.id, [4_500_000]);
    await bulk(store, { categoryId: summer.id, percentBp: -2000, markWas: false, apply: true });
    const read = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect([read.variants[0]!.price.priceMinor, read.variants[0]!.wasPriceMinor]).toEqual([3_600_000, null]);
  });

  it('undoes a bulk change once, leaves a piece edited since, and shows in the product history', async () => {
    const store = await openStore(app);
    const summer = await category(store, 'صيفي');
    const shirt = await product(store, 'قميص', summer.id, [4_500_000, 4_600_000], 3_000_000);
    const applied = (
      await bulk(store, { categoryId: summer.id, percentBp: -3000, roundToMinor: 50_000, apply: true })
    ).json<BulkPriceResult>();
    expect(applied.changeId).toBeTruthy();
    // The product's own history now carries the bulk rows (it did not before)
    const own = await app.inject({
      method: 'GET',
      url: `/v1/price-history?productId=${shirt.id}`,
      headers: as(store),
    });
    expect(own.json<{ items: { source: string }[] }>().items.filter((r) => r.source === 'bulk')).toHaveLength(
      2,
    );
    // One piece edited by hand afterwards stays as the owner left it
    const fresh = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${shirt.id}`,
      headers: as(store),
      payload: {
        version: fresh.version,
        variants: [{ id: shirt.variants[0]!.id, price: { currency: 'SYP', priceMinor: 3_300_000 } }],
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const undo = await app.inject({
      method: 'POST',
      url: `/v1/prices/bulk/${applied.changeId!}/undo`,
      headers: as(store),
      payload: {},
    });
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json()).toEqual({ restored: 1, skipped: 1 });
    const read = (
      await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(read.variants.map((v) => v.price.priceMinor).sort()).toEqual([3_300_000, 4_600_000]);
    expect(read.variants.every((v) => v.wasPriceMinor === null || v.price.priceMinor === 3_300_000)).toBe(
      true,
    );
    const again = await app.inject({
      method: 'POST',
      url: `/v1/prices/bulk/${applied.changeId!}/undo`,
      headers: as(store),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('pages the price history and shows a floor or wholesale edit', async () => {
    const store = await openStore(app);
    const summer = await category(store, 'صيفي');
    const shirt = await product(store, 'قميص', summer.id, [4_500_000]);
    for (const w of [1_000_000, 1_100_000]) {
      const cur = (
        await app.inject({ method: 'GET', url: `/v1/products/${shirt.id}`, headers: as(store) })
      ).json<ProductDetail>();
      const r = await app.inject({
        method: 'PATCH',
        url: `/v1/products/${shirt.id}`,
        headers: as(store),
        payload: { version: cur.version, variants: [{ id: shirt.variants[0]!.id, wholesalePriceMinor: w }] },
      });
      expect(r.statusCode, r.body).toBe(200);
    }
    const first = (
      await app.inject({ method: 'GET', url: '/v1/price-history?limit=1', headers: as(store) })
    ).json<{ items: { field?: string; newMinor: number }[]; nextCursor: string | null }>();
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ field: 'wholesale', newMinor: 1_100_000 });
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await app.inject({
        method: 'GET',
        url: `/v1/price-history?limit=1&before=${encodeURIComponent(first.nextCursor!)}`,
        headers: as(store),
      })
    ).json<{ items: { newMinor: number }[]; nextCursor: string | null }>();
    expect(second.items[0]!.newMinor).toBe(1_000_000);
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
