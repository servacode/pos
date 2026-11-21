import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ImportResponse, ProductDetail, ProductListResponse } from '@serva/core';
import { ManualClock } from '../src/clock';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/** Round 44, products: the floor price, the kind of a stocked product, the list's totals and search, the import's repeated names */

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let app: FastifyInstance;
let clock: ManualClock;
let s: TestStore;

beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({}, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-10-30T09:00:00.000Z');
  s = await testStore(app);
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: bearer(s.accessToken), ...(payload ? { payload } : {}) });

const make = async (extra: Record<string, unknown> = {}, variant: Record<string, unknown> = {}) => {
  const res = await call('POST', '/v1/products', {
    nameAr: 'شاي الربيع',
    variants: [
      {
        price: { currency: 'SYP', priceMinor: 5_000_000 },
        barcodes: [{ kind: 'standard', code: 'AB1234' }],
        ...variant,
      },
    ],
    ...extra,
  });
  return res;
};

describe('floor price', () => {
  it('refuses a floor above the price on create', async () => {
    const res = await make({}, { minPriceMinor: 6_000_000 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields['variants.0.minPriceMinor']).toContain('أعلى من سعر البيع');
  });

  it('refuses lowering the price under the stored floor, and a floor over the price, on update', async () => {
    const res = await make({}, { minPriceMinor: 4_000_000 });
    expect(res.statusCode, res.body).toBe(201);
    const p = res.json<ProductDetail>();
    const v = p.variants[0]!;
    const lower = await call('PATCH', `/v1/products/${p.id}`, {
      version: p.version,
      variants: [{ id: v.id, price: { currency: 'SYP', priceMinor: 3_000_000 } }],
    });
    expect(lower.statusCode).toBe(400);
    const higher = await call('PATCH', `/v1/products/${p.id}`, {
      version: p.version,
      variants: [{ id: v.id, minPriceMinor: 5_500_000 }],
    });
    expect(higher.statusCode).toBe(400);
    const ok = await call('PATCH', `/v1/products/${p.id}`, {
      version: p.version,
      variants: [{ id: v.id, price: { currency: 'SYP', priceMinor: 3_000_000 }, minPriceMinor: 2_500_000 }],
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('a stocked product keeps its kind', () => {
  it('refuses turning serial tracking on while stock is held, allows it at zero', async () => {
    const p = (await make()).json<ProductDetail>();
    const turnOn = (version: number) =>
      call('PATCH', `/v1/products/${p.id}`, { version, tracksSerial: true });
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${s.tenantId}, ${s.branchId}, ${p.variants[0]!.id}, 5000)
      on conflict (tenant_id, branch_id, variant_id) do update set qty = 5000`;
    const refused = await turnOn(p.version);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.fields.tracksSerial).toContain('مخزون');
    await ownerDb()`update stock_levels set qty = 0 where tenant_id = ${s.tenantId}`;
    expect((await turnOn(p.version)).statusCode).toBe(200);
  });
});

describe('the list', () => {
  it('finds a mixed-case barcode, the brand and the generic name, and sends totals only unfiltered', async () => {
    await make({ brand: 'ألبان الشام', genericName: 'باراسيتامول' });
    await make({ nameAr: 'سكر' }, { barcodes: [{ kind: 'standard', code: 'ZZ99' }] });
    const get = async (q: string) => (await call('GET', `/v1/products${q}`)).json<ProductListResponse>();
    expect((await get('?q=AB1234')).items.map((i) => i.nameAr)).toEqual(['شاي الربيع']);
    expect((await get('?q=ab1234')).items).toHaveLength(1);
    expect((await get('?q=ألبان')).items.map((i) => i.nameAr)).toEqual(['شاي الربيع']);
    expect((await get('?q=باراسيتامول')).items).toHaveLength(1);
    const all = await get('');
    expect(all.totals).toBeDefined();
    expect(all.attention).toBeDefined();
    const searched = await get('?q=سكر');
    expect(searched.totals).toBeUndefined();
    expect(searched.attention).toBeUndefined();
  });
});

describe('import: a repeated plain name', () => {
  it('fails the second row with the same name and no barcode instead of overwriting the first', async () => {
    const res = await call('POST', '/v1/import', {
      type: 'products',
      mode: 'commit',
      existing: 'update',
      date: '2026-10-30',
      rows: [
        { line: 2, values: { name: 'شاي', price: '1000' } },
        { line: 3, values: { name: 'شاي', price: '2000' } },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<ImportResponse>();
    expect(body.results.find((r) => r.line === 2)!.status).toBe('create');
    expect(body.results.find((r) => r.line === 3)!.status).toBe('error');
  });
});

describe('stock filter, sort, opening stock and cost', () => {
  it('lists only what ran out, the least stock first, and pages through that order', async () => {
    const a = (
      await make({ nameAr: 'أ' }, { barcodes: [{ kind: 'standard', code: '111' }] })
    ).json<ProductDetail>();
    const b = (
      await make({ nameAr: 'ب' }, { barcodes: [{ kind: 'standard', code: '222' }] })
    ).json<ProductDetail>();
    await make({ nameAr: 'ج' }, { barcodes: [{ kind: 'standard', code: '333' }] });
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty) values
        (${s.tenantId}, ${s.branchId}, ${a.variants[0]!.id}, 9000),
        (${s.tenantId}, ${s.branchId}, ${b.variants[0]!.id}, -2000)
      on conflict (tenant_id, branch_id, variant_id) do update set qty = excluded.qty`;
    const get = async (q: string) => (await call('GET', `/v1/products${q}`)).json<ProductListResponse>();
    expect((await get('?stock=out')).items.map((i) => i.nameAr).sort()).toEqual(['ب', 'ج']);
    const first = await get('?sort=stock&limit=2');
    expect(first.items.map((i) => i.nameAr)).toEqual(['ب', 'ج']);
    const second = await get(`?sort=stock&limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((i) => i.nameAr)).toEqual(['أ']);
  });

  it('posts an opening quantity once, shows the average cost to cost.view, and refuses a second opening', async () => {
    const p = (await make()).json<ProductDetail>();
    const v = p.variants[0]!;
    const open = () =>
      call('POST', `/v1/products/${p.id}/opening-stock`, {
        date: '2026-10-30',
        branchId: s.branchId,
        lines: [{ variantId: v.id, qty: 10_000, unitCostMinor: 3_000_000 }],
      });
    const first = await open();
    expect(first.statusCode, first.body).toBe(200);
    const costs = (await call('GET', `/v1/products/${p.id}/costs`)).json<{
      items: { variantId: string; qty: number; unitCostMinor: number | null }[];
    }>();
    expect(costs.items[0]).toMatchObject({ variantId: v.id, qty: 10_000, unitCostMinor: 3_000_000 });
    expect((await open()).statusCode).toBe(409);
    const detail = (await call('GET', `/v1/products/${p.id}`)).json<ProductDetail>();
    expect(detail.variants[0]!.stock[0]!.qty).toBe(10_000);
  });

  it('two simultaneous openings of one product post once', async () => {
    const p = (await make()).json<ProductDetail>();
    const v = p.variants[0]!;
    const open = () =>
      call('POST', `/v1/products/${p.id}/opening-stock`, {
        date: '2026-10-30',
        branchId: s.branchId,
        lines: [{ variantId: v.id, qty: 5_000, unitCostMinor: 1_000_000 }],
      });
    const codes = (await Promise.all([open(), open()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const detail = (await call('GET', `/v1/products/${p.id}`)).json<ProductDetail>();
    expect(detail.variants[0]!.stock[0]!.qty).toBe(5_000);
  });
});

describe('round 48: a plain import row, the closed period, the accountant', () => {
  it('refuses a row with no barcode and no size whose name a product already has', async () => {
    expect((await make({ nameAr: 'شاي' })).statusCode).toBe(201);
    const res = await call('POST', '/v1/import', {
      type: 'products',
      mode: 'commit',
      existing: 'update',
      date: '2026-10-30',
      rows: [{ line: 2, values: { name: 'شاي', price: '9000' } }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = res.json<ImportResponse>().results[0]!;
    expect(row.status).toBe('error');
    expect(JSON.stringify(row)).toContain('يوجد منتج بهذا الاسم');
    const list = (await call('GET', '/v1/products')).json<ProductListResponse>();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.price?.minMinor).toBe(5_000_000);
  });

  it('refuses an opening quantity dated inside a closed period', async () => {
    const p = (await make()).json<ProductDetail>();
    const closed = await call('POST', '/v1/period-close/close', { through: '2026-10-25' });
    expect(closed.statusCode, closed.body).toBe(200);
    const res = await call('POST', `/v1/products/${p.id}/opening-stock`, {
      date: '2026-10-20',
      branchId: s.branchId,
      lines: [{ variantId: p.variants[0]!.id, qty: 1_000, unitCostMinor: 100_000 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('period_closed');
  });

  it('lets the accountant read the list and the card, and never write', async () => {
    const p = (await make()).json<ProductDetail>();
    const acc = await staffUser(app, s, 'accountant', '0922222222');
    const h = bearer(acc.accessToken);
    expect((await app.inject({ method: 'GET', url: '/v1/products', headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/products/${p.id}`, headers: h })).statusCode).toBe(
      200,
    );
    const write = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${p.id}`,
      headers: h,
      payload: { version: p.version, nameAr: 'غير' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('adds the unit, wholesale price and average cost to the list for the export', async () => {
    const p = (await make({}, { wholesalePriceMinor: 4_000_000 })).json<ProductDetail>();
    const open = await call('POST', `/v1/products/${p.id}/opening-stock`, {
      date: '2026-10-30',
      branchId: s.branchId,
      lines: [{ variantId: p.variants[0]!.id, qty: 2_000, unitCostMinor: 3_000_000 }],
    });
    expect(open.statusCode, open.body).toBe(200);
    const plain = (await call('GET', '/v1/products')).json<ProductListResponse>();
    expect(plain.items[0]!.costMinor).toBeUndefined();
    const more = (await call('GET', '/v1/products?detail=1')).json<ProductListResponse>().items[0]!;
    expect(more).toMatchObject({
      wholesale: { minMinor: 4_000_000, maxMinor: 4_000_000 },
      costMinor: 3_000_000,
    });
    expect(more.unitName).toBeTruthy();
  });
});
