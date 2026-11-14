import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CustomerDetail,
  ImportResponse,
  MerchandiseReport,
  OptionValuesResponse,
  ProductDetail,
  ProductListResponse,
  SalePayload,
  SalesBreakdown,
  StaffMember,
  StoreResponse,
} from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { staffUser } from './staff';

/**
 * Clothing options: the store's catalog options (barcodes, size runs), the «تقصير» service item,
 * seasons on products (list, sales report, movement report, import), a seller's commission rate, the
 * model code of the import and the archiving of a duplicate customer.
 */

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

const as = (store: Pick<Store, 'accessToken'>) => ({ authorization: `Bearer ${store.accessToken}` });
const PIECE = 1000;

describe('catalog options', () => {
  it('start with the defaults, are saved by someone who manages the catalog, and refuse a cashier', async () => {
    const store = await openStore(app);
    const read = async () =>
      (await app.inject({ method: 'GET', url: '/v1/store', headers: as(store) })).json<StoreResponse>();
    expect((await read()).catalogOptions).toMatchObject({ autoBarcode: false });
    expect((await read()).catalogOptions!.sizeRuns[0]).toEqual({ name: 'طقم 1-2-2-1', counts: [1, 2, 2, 1] });

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/store/catalog-options',
      headers: as(store),
      payload: { autoBarcode: true, sizeRuns: [{ name: 'طقم الرجالي', counts: [1, 3, 3, 1] }] },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json<StoreResponse>().catalogOptions).toEqual({
      autoBarcode: true,
      sizeRuns: [{ name: 'طقم الرجالي', counts: [1, 3, 3, 1] }],
    });
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: as(store) });
    expect(
      me.json<{ settings: { catalogOptions: { autoBarcode: boolean } } }>().settings.catalogOptions,
    ).toMatchObject({
      autoBarcode: true,
    });

    const empty = await app.inject({
      method: 'PUT',
      url: '/v1/store/catalog-options',
      headers: as(store),
      payload: { autoBarcode: true, sizeRuns: [{ name: 'فارغ', counts: [0, 0] }] },
    });
    expect(empty.statusCode).toBe(400);
    const cashier = await staffUser(app, { ...store, branchId: '' }, 'cashier', '0955555555');
    const denied = await app.inject({
      method: 'PUT',
      url: '/v1/store/catalog-options',
      headers: as(cashier),
      payload: { autoBarcode: false, sizeRuns: [] },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('the «تقصير» service', () => {
  it('is made once when the store becomes a clothing store, and not made again', async () => {
    const store = await openStore(app);
    const alterations = () =>
      ownerDb()`select p.type, p.sell_on_pos, pr.price_minor::int as price from products p
        join variants v on v.product_id = p.id join prices pr on pr.id = v.id
        where p.tenant_id = ${store.tenantId} and p.name_ar = 'تقصير'`;
    expect(await alterations()).toHaveLength(0);

    const profile = (sectors: string[]) =>
      app.inject({
        method: 'PUT',
        url: '/v1/store/profile',
        headers: as(store),
        payload: { name: 'بوتيك', sectors },
      });
    expect((await profile(['supermarket'])).statusCode).toBe(200);
    expect(await alterations()).toHaveLength(0);
    expect((await profile(['clothing'])).statusCode).toBe(200);
    expect(await alterations()).toEqual([{ type: 'service', sell_on_pos: true, price: 0 }]);
    expect((await profile(['clothing', 'supermarket'])).statusCode).toBe(200);
    expect(await alterations()).toHaveLength(1);
  });
});

async function shirt(store: Store, season: string | null, name = 'قميص') {
  const made = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: name,
      season,
      variants: [
        { attributes: [{ name: 'المقاس', value: 'M' }], price: { currency: 'SYP', priceMinor: 100_000 } },
      ],
    },
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json<ProductDetail>();
}

describe('seasons', () => {
  it('are kept on the product, filter the list and are offered for choosing', async () => {
    const store = await openStore(app);
    const summer = await shirt(store, 'صيف 2026', 'قميص صيفي');
    await shirt(store, 'شتاء 2026', 'معطف');
    await shirt(store, null, 'حزام');
    expect(summer.season).toBe('صيف 2026');

    const list = async (q: string) =>
      (
        await app.inject({ method: 'GET', url: `/v1/products?${q}`, headers: as(store) })
      ).json<ProductListResponse>();
    expect((await list('')).items).toHaveLength(3);
    const only = await list(`season=${encodeURIComponent('صيف 2026')}`);
    expect(only.items.map((i) => [i.nameAr, i.season])).toEqual([['قميص صيفي', 'صيف 2026']]);

    const options = await app.inject({ method: 'GET', url: '/v1/products/options', headers: as(store) });
    expect(options.json<OptionValuesResponse>().seasons).toEqual(['شتاء 2026', 'صيف 2026']);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${summer.id}`,
      headers: as(store),
      payload: { version: summer.version, season: null },
    });
    expect(patched.json<ProductDetail>().season).toBeNull();
  });

  it('group the sales report, narrow the movement report, and a seller has a commission rate', async () => {
    const store = await openStore(app);
    const summer = await shirt(store, 'صيف 2026', 'قميص صيفي');
    const winter = await shirt(store, 'شتاء 2026', 'معطف');
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const payload = sale(store, open.id, {
      lines: [
        cartLine(1, 100_000, {
          productId: summer.id,
          variantId: summer.variants[0]!.id,
          name: 'قميص صيفي',
          qty: 2 * PIECE,
        }),
        cartLine(2, 100_000, {
          productId: winter.id,
          variantId: winter.variants[0]!.id,
          name: 'معطف',
          qty: PIECE,
        }),
      ],
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 300_000 }],
    }) as SalePayload;
    const pushed = await push(app, store.device, [open, doc('sale', payload)]);
    expect(pushed.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);

    const get = (q: string) =>
      app.inject({ method: 'GET', url: `/v1/reports/sales-breakdown?${q}`, headers: as(store) });
    const bySeason = (await get('from=2026-10-01&to=2026-10-30&by=season')).json<SalesBreakdown>();
    expect(bySeason.rows.map((r) => [r.name, r.totalMinor])).toEqual([
      ['صيف 2026', 200_000],
      ['شتاء 2026', 100_000],
    ]);
    expect(bySeason.commissionTotalMinor).toBeNull();

    const none = (await get('from=2026-10-01&to=2026-10-30&by=seller')).json<SalesBreakdown>();
    expect(none.rows[0]).toMatchObject({ commissionBp: null, commissionMinor: null });
    expect(none.commissionTotalMinor).toBe(0);

    // 2.5% of 3,000.00 is 75.00
    await ownerDb()`update users set commission_bp = 250 where id = ${store.userId}`;
    const seller = (await get('from=2026-10-01&to=2026-10-30&by=seller')).json<SalesBreakdown>();
    expect(seller.rows[0]).toMatchObject({ commissionBp: 250, commissionMinor: 7_500 });
    expect(seller.commissionTotalMinor).toBe(7_500);

    const merch = async (extra: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/v1/reports/merchandise?from=2026-10-01&to=2026-10-30${extra}`,
          headers: as(store),
        })
      ).json<MerchandiseReport>();
    const all = await merch('');
    expect(all.seasons).toEqual(['شتاء 2026', 'صيف 2026']);
    expect(all.bySeller[0]).toMatchObject({ commissionBp: 250 });
    expect(all.byOption.find((o) => o.name === 'المقاس')!.values[0]!.soldQty).toBe(3 * PIECE);
    const narrowed = await merch(`&season=${encodeURIComponent('صيف 2026')}`);
    expect(narrowed.byOption.find((o) => o.name === 'المقاس')!.values[0]!.soldQty).toBe(2 * PIECE);
  });
});

describe('a seller’s commission in the staff page', () => {
  it('is set and cleared by the one who manages staff, and shows in the list', async () => {
    const store = await openStore(app);
    const cashier = await staffUser(app, { ...store, branchId: '' }, 'cashier', '0955555555');
    const list = async () =>
      (await app.inject({ method: 'GET', url: '/v1/staff', headers: as(store) })).json<{
        staff: StaffMember[];
      }>().staff;
    const target = (await list()).find((m) => !m.isOwner)!;
    const set = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/${target.id}`,
      headers: as(store),
      payload: { commissionBp: 300 },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<StaffMember>().commissionBp).toBe(300);
    expect((await list()).find((m) => m.id === target.id)!.commissionBp).toBe(300);
    const bad = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/${target.id}`,
      headers: as(store),
      payload: { commissionBp: 10_001 },
    });
    expect(bad.statusCode).toBe(400);
    const clear = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/${target.id}`,
      headers: as(store),
      payload: { commissionBp: null },
    });
    expect(clear.json<StaffMember>().commissionBp).toBeNull();
    expect(cashier).toBeDefined();
  });
});

describe('import by model code', () => {
  it('makes one product of the rows that share a model code, with the season', async () => {
    const store = await openStore(app);
    const rows = [
      { name: 'قميص أزرق', model: 'SH-1', size: 'S', price: '50000', season: 'صيف 2026' },
      { name: 'قميص بحري', model: 'SH-1', size: 'M', price: '50000' },
      { name: 'بنطال', sku: 'PN-1', size: '30', price: '80000' },
      { name: 'بنطال جينز', sku: 'PN-1', size: '32', price: '80000' },
      { name: 'حذاء', sku: 'SO-1', size: '42', price: '90000' },
      { name: 'حذاء', sku: 'SO-2', size: '43', price: '90000' },
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/import',
      headers: as(store),
      payload: {
        type: 'products',
        mode: 'commit',
        existing: 'skip',
        date: '2026-10-30',
        rows: rows.map((values, i) => ({ line: i + 2, values })),
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<ImportResponse>().totals).toMatchObject({ create: 6, error: 0 });
    const list = (
      await app.inject({ method: 'GET', url: '/v1/products', headers: as(store) })
    ).json<ProductListResponse>().items;
    // The shirts and the trousers are one product each (by model code and by a shared SKU); the
    // shoes have different SKUs and the same name, so the name groups them
    expect(list.map((i) => [i.nameAr, i.variantCount]).sort()).toEqual(
      [
        ['بنطال', 2],
        ['حذاء', 2],
        ['قميص أزرق', 2],
      ].sort(),
    );
    expect(list.find((i) => i.nameAr === 'قميص أزرق')!.season).toBe('صيف 2026');
  });
});

describe('archiving a duplicate customer', () => {
  it('archives a clean one and refuses one that owes, with the reason', async () => {
    const store = await openStore(app);
    const make = async (name: string) =>
      (
        await app.inject({ method: 'POST', url: '/v1/customers', headers: as(store), payload: { name } })
      ).json<CustomerDetail>();
    const clean = await make('سلمى');
    const owing = await make('سلمى المكررة');
    const debt = await app.inject({
      method: 'POST',
      url: `/v1/customers/${owing.id}/opening-debt`,
      headers: as(store),
      payload: { amountMinor: 50_000 },
    });
    expect(debt.statusCode, debt.body).toBeLessThan(300);

    const refused = await app.inject({
      method: 'POST',
      url: `/v1/customers/${owing.id}/archive-duplicate`,
      headers: as(store),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toContain('دين');

    const done = await app.inject({
      method: 'POST',
      url: `/v1/customers/${clean.id}/archive-duplicate`,
      headers: as(store),
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<CustomerDetail>().archived).toBe(true);
    const again = await app.inject({
      method: 'POST',
      url: `/v1/customers/${clean.id}/archive-duplicate`,
      headers: as(store),
    });
    expect(again.statusCode).toBe(409);
  });
});
