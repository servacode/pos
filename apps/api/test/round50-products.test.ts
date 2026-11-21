import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ArchiveImpactResponse,
  BulkPriceResult,
  Category,
  PriceChange,
  ProductDetail,
  ProductListResponse,
} from '@serva/core';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';
type Store = TestStore;

/** Round 50, products: the undo in the history, tied history rows across pages, the zero-cost tick, branch roles, archive impact */

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

const as = (store: Pick<Store, 'accessToken'>) => bearer(store.accessToken);
const call = (
  store: Pick<Store, 'accessToken'>,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
) => app.inject({ method, url, headers: as(store), ...(payload ? { payload } : {}) });

async function category(store: Store, name: string) {
  const res = await call(store, 'POST', '/v1/categories', { name, parentId: null });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Category>();
}

async function product(store: Store, nameAr: string, categoryId: string | null, prices: number[]) {
  const res = await call(store, 'POST', '/v1/products', {
    nameAr,
    ...(categoryId ? { categoryId } : {}),
    variants: prices.map((priceMinor, i) => ({
      attributes: [{ name: 'المقاس', value: ['M', 'L', 'XL'][i]! }],
      price: { currency: 'SYP', priceMinor },
    })),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

type Page = { items: PriceChange[]; nextCursor: string | null };
const history = async (store: Store, query = '') =>
  (await call(store, 'GET', `/v1/price-history${query}`)).json<Page>();

describe('round 50: the history after an undo', () => {
  it('shows the undo as its own rows and marks the change as taken back', async () => {
    const store = await testStore(app);
    const c = await category(store, 'صيفي');
    const shirt = await product(store, 'قميص', c.id, [4_500_000, 4_600_000]);
    const applied = (
      await call(store, 'POST', '/v1/prices/bulk', {
        categoryId: c.id,
        percentBp: -3000,
        roundToMinor: 50_000,
        apply: true,
      })
    ).json<BulkPriceResult>();
    const before = await history(store, `?productId=${shirt.id}`);
    expect(before.items.every((r) => r.batchId === applied.changeId && r.undone === false)).toBe(true);
    const undo = await call(store, 'POST', `/v1/prices/bulk/${applied.changeId!}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    const after = await history(store, `?productId=${shirt.id}`);
    const undone = after.items.filter((r) => r.note === 'تراجع عن تغيير جماعي');
    expect(undone).toHaveLength(2);
    expect(undone.map((r) => r.newMinor).sort()).toEqual([4_500_000, 4_600_000]);
    const original = after.items.filter((r) => r.batchId);
    expect(original).toHaveLength(2);
    expect(original.every((r) => r.undone === true)).toBe(true);
  });

  it('keeps the rows that share one timestamp across a page boundary', async () => {
    const store = await testStore(app);
    const a = await product(store, 'قميص', null, [4_500_000]);
    const b = await product(store, 'بنطال', null, [5_500_000]);
    const c = await product(store, 'جاكيت', null, [6_500_000]);
    // A price list writes all its rows in one transaction: the very same instant on each
    const applied = await call(store, 'POST', '/v1/prices/list/apply', {
      changes: [a, b, c].map((x) => ({ variantId: x.variants[0]!.id, newMinor: 1_000_000 })),
    });
    expect(applied.statusCode, applied.body).toBe(200);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i += 1) {
      const page: Page = await history(
        store,
        `?limit=1${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    // the three price rows and the list's own summary row
    expect(new Set(seen).size).toBe(4);
  });
});

describe('round 50: opening cost, branch roles, archive impact, list columns', () => {
  it('refuses an opening line with no cost unless it is said on purpose', async () => {
    const store = await testStore(app);
    const p = await product(store, 'قميص', null, [4_500_000]);
    const line = { variantId: p.variants[0]!.id, qty: 3_000, unitCostMinor: 0 };
    const body = { date: '2026-10-30', branchId: store.branchId, lines: [line] };
    const refused = await call(store, 'POST', `/v1/products/${p.id}/opening-stock`, body);
    expect(refused.statusCode).toBe(400);
    const ok = await call(store, 'POST', `/v1/products/${p.id}/opening-stock`, { ...body, zeroCostOk: true });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('lets a role given for one branch read the catalog but not write it', async () => {
    const store = await testStore(app);
    const branchManager = await staffUser(app, store, 'manager', '0933333333', {
      branchId: store.branchId,
    });
    expect((await call(branchManager, 'GET', '/v1/products')).statusCode).toBe(200);
    const write = await call(branchManager, 'POST', '/v1/categories', { name: 'جديد', parentId: null });
    expect(write.statusCode).toBe(403);
  });

  it('says what archiving leaves behind', async () => {
    const store = await testStore(app);
    const p = await product(store, 'سكر', null, [1_000_000]);
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${store.tenantId}, ${store.branchId}, ${p.variants[0]!.id}, 7000)`;
    const impact = (
      await call(store, 'GET', `/v1/products/${p.id}/archive-impact`)
    ).json<ArchiveImpactResponse>();
    expect(impact).toEqual({ stockQty: 7000, usedInRecipes: [] });
    const missing = await call(
      store,
      'GET',
      '/v1/products/0192a3b4-c5d6-7e8f-9a0b-000000000099/archive-impact',
    );
    expect(missing.statusCode).toBe(404);
  });

  it('gives the list the cost and the status counts', async () => {
    const store = await testStore(app);
    const p = await product(store, 'سكر', null, [1_000_000]);
    const open = await call(store, 'POST', `/v1/products/${p.id}/opening-stock`, {
      date: '2026-10-30',
      branchId: store.branchId,
      lines: [{ variantId: p.variants[0]!.id, qty: 2_000, unitCostMinor: 600_000 }],
    });
    expect(open.statusCode, open.body).toBe(200);
    const list = (await call(store, 'GET', '/v1/products?cost=1')).json<ProductListResponse>();
    expect(list.items[0]!.costMinor).toBe(600_000);
    expect(list.statusCounts).toEqual({ active: 1, temporary: 0, archived: 0 });
    const plain = (await call(store, 'GET', '/v1/products')).json<ProductListResponse>();
    expect(plain.items[0]!.costMinor).toBeUndefined();
  });

  it('still saves other changes of a row whose floor already sat above its price', async () => {
    const store = await testStore(app);
    const p = await product(store, 'قميص', null, [4_000_000]);
    await ownerDb()`update prices set min_price_minor = 5000000 where id = ${p.variants[0]!.id}`;
    const res = await call(store, 'PATCH', `/v1/products/${p.id}`, {
      version: p.version,
      variants: [{ id: p.variants[0]!.id, wholesalePriceMinor: 3_000_000 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const raise = await call(store, 'PATCH', `/v1/products/${p.id}`, {
      version: res.json<ProductDetail>().version,
      variants: [{ id: p.variants[0]!.id, price: { currency: 'SYP', priceMinor: 3_500_000 } }],
    });
    expect(raise.statusCode).toBe(400);
  });
});
