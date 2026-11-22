import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  PriceListApplied,
  ProductDetail,
  ProductImage,
  ProductListResponse,
  TaxRateList,
} from '@serva/core';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, testStore, type TestStore } from './staff';

/** Round 52, products: the history cursor, a price list over a moved price, the picture bytes, the default tax, the margin price */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

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

const call = (
  store: Pick<TestStore, 'accessToken'>,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
) => app.inject({ method, url, headers: bearer(store.accessToken), ...(payload ? { payload } : {}) });

async function product(store: TestStore, nameAr: string, prices: number[]) {
  const res = await call(store, 'POST', '/v1/products', {
    nameAr,
    variants: prices.map((priceMinor, i) => ({
      attributes: [{ name: 'المقاس', value: ['M', 'L', 'XL'][i]! }],
      price: { currency: 'SYP', priceMinor },
    })),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

const ZERO_ID = '00000000-0000-4000-8000-000000000000';

describe('round 52: price history cursor', () => {
  it('answers 400, not 500, to a junk cursor, and accepts a real one', async () => {
    const store = await testStore(app);
    for (const junk of [
      'junk|x',
      'junk',
      '2026-11-20 19:07:42.330621+00|not-a-uuid',
      `2026-13-45 99:99:99+00|${ZERO_ID}`,
      `2026-02-30 10:00:00+00|${ZERO_ID}`,
    ]) {
      const res = await call(store, 'GET', `/v1/price-history?before=${encodeURIComponent(junk)}`);
      expect(res.statusCode, junk).toBe(400);
    }
    const real = `2026-11-20 19:07:42.330621+00|${ZERO_ID}`;
    const ok = await call(store, 'GET', `/v1/price-history?before=${encodeURIComponent(real)}`);
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('round 52: price list over a price that moved since the preview', () => {
  it('leaves a piece whose price changed after the preview and says how many', async () => {
    const store = await testStore(app);
    const a = await product(store, 'قميص', [4_000_000]);
    const b = await product(store, 'بنطال', [5_000_000]);
    // someone edits the shirt between the preview and the apply
    await ownerDb()`update prices set price_minor = 4200000 where id = ${a.variants[0]!.id}`;
    const res = await call(store, 'POST', '/v1/prices/list/apply', {
      changes: [
        { variantId: a.variants[0]!.id, newMinor: 3_000_000, expectedOldMinor: 4_000_000 },
        { variantId: b.variants[0]!.id, newMinor: 4_500_000, expectedOldMinor: 5_000_000 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PriceListApplied>()).toMatchObject({ changed: 1, skipped: 1, stale: 1 });
    const [row] = await ownerDb()`select price_minor::int as p from prices where id = ${a.variants[0]!.id}`;
    expect(row!.p).toBe(4_200_000);
  });
});

describe('round 52: a deleted picture frees its bytes', () => {
  const JPEG = [0xff, 0xd8, 0xff, 0xe0];
  const picture = (fill: number, size = 600) =>
    Buffer.from([...JPEG, ...Array.from({ length: size }, (_, i) => (fill + i) % 256)]);
  const body = (fill: number) => ({
    contentType: 'image/jpeg',
    data: picture(fill).toString('base64'),
    thumb: picture(fill, 100).toString('base64'),
    width: 1200,
    height: 1600,
  });

  it('keeps the bytes while another product uses them, deletes them with the last one', async () => {
    const store = await testStore(app);
    const a = await product(store, 'قميص', [4_000_000]);
    const b = await product(store, 'بنطال', [5_000_000]);
    const first = await call(store, 'POST', `/v1/products/${a.id}/images`, body(1));
    const second = await call(store, 'POST', `/v1/products/${b.id}/images`, body(1));
    expect(first.statusCode, first.body).toBe(201);
    const count = async () => (await ownerDb()`select count(*)::int as n from uploads`)[0]!.n as number;
    expect(await count()).toBe(1);
    await call(store, 'DELETE', `/v1/products/${a.id}/images/${first.json<ProductImage>().id}`);
    expect(await count()).toBe(1);
    const last = await call(store, 'DELETE', `/v1/products/${b.id}/images/${second.json<ProductImage>().id}`);
    expect(last.statusCode, last.body).toBe(204);
    expect(await count()).toBe(0);
  });
});

describe('round 52: default tax by id, margin price', () => {
  it('tells two rates with the same percentage apart', async () => {
    const store = await testStore(app);
    const one = (
      await call(store, 'POST', '/v1/tax-rates', { name: 'مبيعات أ', rateBp: 500, kind: 'sales' })
    ).json<{ id: string }>();
    const two = (
      await call(store, 'POST', '/v1/tax-rates', { name: 'مبيعات ب', rateBp: 500, kind: 'sales' })
    ).json<{ id: string }>();
    const set = await call(store, 'PUT', '/v1/tax-rates/default', { taxRateId: two.id });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<TaxRateList>()).toMatchObject({ defaultRateBp: 500, defaultRateId: two.id });
    const again = await call(store, 'PUT', '/v1/tax-rates/default', { taxRateId: one.id });
    expect(again.json<TaxRateList>().defaultRateId).toBe(one.id);
    const none = await call(store, 'PUT', '/v1/tax-rates/default', { taxRateId: null });
    expect(none.json<TaxRateList>()).toMatchObject({ defaultRateBp: 0, defaultRateId: null });
  });

  it('averages the price over the same stocked units as the cost', async () => {
    const store = await testStore(app);
    const p = await product(store, 'قميص', [1_000_000, 3_000_000]);
    // all the stock is in the dear size: the margin is against 3,000,000, not the cheap 1,000,000
    const open = await call(store, 'POST', `/v1/products/${p.id}/opening-stock`, {
      date: '2026-10-30',
      branchId: store.branchId,
      lines: [{ variantId: p.variants[1]!.id, qty: 2_000, unitCostMinor: 2_000_000 }],
    });
    expect(open.statusCode, open.body).toBe(200);
    const list = (await call(store, 'GET', '/v1/products?cost=1')).json<ProductListResponse>();
    expect(list.items[0]).toMatchObject({ costMinor: 2_000_000, costPriceMinor: 3_000_000 });
  });
});
