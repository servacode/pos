import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  BarcodeLookupResponse,
  Category,
  CreateProductInput,
  ProductDetail,
  ProductListResponse,
  TaxRate,
  Unit,
} from '@serva/core';
import { ManualClock } from '../src/clock';
import { ean13CheckDigit } from '../src/services/catalog/products';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

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

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, token = s.accessToken) =>
  app.inject({
    method,
    url,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const tea = (overrides: Partial<CreateProductInput> = {}): CreateProductInput => ({
  nameAr: 'شاي الربيع ٤٥٠ غ',
  nameEn: 'Rabea Tea 450g',
  variants: [
    {
      price: { currency: 'SYP', priceMinor: 4_500_000 },
      barcodes: [{ kind: 'standard', code: '6281234500012' }],
    },
  ],
  ...overrides,
});

async function create(input: CreateProductInput = tea(), token = s.accessToken): Promise<ProductDetail> {
  const res = await call('POST', '/v1/products', input, token);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function list(query = ''): Promise<ProductListResponse> {
  const res = await call('GET', `/v1/products${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const auditActions = async () =>
  (
    await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${s.tenantId} and action <> 'store.registered'
      order by created_at, id`
  ).map((r) => r.action);

describe('products: create and read', () => {
  it('creates the product with its variant, price and barcode in one request, «قطعة» by default', async () => {
    const detail = await create();
    const [piece] = await ownerDb()<{ id: string }[]>`
      select id from units where tenant_id = ${s.tenantId} and system_key = 'piece'`;
    expect(detail).toMatchObject({
      nameAr: 'شاي الربيع ٤٥٠ غ',
      nameEn: 'Rabea Tea 450g',
      categoryId: null,
      type: 'stock',
      status: 'active',
      unitId: piece!.id,
      taxRateId: null,
      sellOnPos: true,
      archivedAt: null,
      version: 1,
    });
    expect(detail.variants).toHaveLength(1);
    expect(detail.variants[0]).toMatchObject({
      label: null,
      attributes: [],
      price: { currency: 'SYP', priceMinor: 4_500_000 },
      minPriceMinor: null,
      priceChangedAt: '2026-10-30T09:00:00.000Z',
      barcodes: [
        { code: '6281234500012', kind: 'standard', packQty: 1000, packName: null, packPriceMinor: null },
      ],
      stock: [{ branchId: s.branchId, branchName: 'الفرع الرئيسي', qty: 0, reservedQty: 0 }],
    });
    const again = await call('GET', `/v1/products/${detail.id}`);
    expect(again.json()).toEqual(detail);
    expect(await auditActions()).toEqual(['product.created']);
    const [row] = await ownerDb()<{ search_name: string }[]>`select search_name from products`;
    expect(row!.search_name).toBe('شاي الربيع 450 غ rabea tea 450g');
  });

  it('never answers a cost field, whoever asks (cost is phase 2, behind cost.view)', async () => {
    const detail = await create();
    const texts = [
      JSON.stringify(detail),
      (await call('GET', '/v1/products')).body,
      (await call('GET', `/v1/products/${detail.id}`)).body,
    ];
    for (const text of texts) expect(text).not.toMatch(/cost|purchase|margin/i);
  });

  it('makes size × colour variants with labels, a pack barcode and numbered internal barcodes', async () => {
    const detail = await create({
      nameAr: 'قميص قطني',
      variants: [
        {
          attributes: [
            { name: 'المقاس', value: 'M' },
            { name: 'اللون', value: 'أبيض' },
          ],
          price: { currency: 'USD', priceMinor: 1250 },
          minPriceMinor: 1100,
          barcodes: [
            { kind: 'internal' },
            { kind: 'standard', code: '٦٢٨١٠٠٠٠٠٠٠٠١', packQty: 12000, packName: 'كرتونة' },
          ],
        },
        {
          attributes: [
            { name: 'المقاس', value: 'L' },
            { name: 'اللون', value: 'أبيض' },
          ],
          price: { currency: 'USD', priceMinor: 1300 },
          barcodes: [{ kind: 'internal' }],
        },
      ],
    });
    expect(detail.variants.map((v) => v.label)).toEqual(['M · أبيض', 'L · أبيض']);
    const codes = detail.variants.flatMap((v) => v.barcodes.map((b) => b.code));
    expect(codes).toEqual(['2900000000018', '6281000000001', '2900000000025']);
    for (const code of [codes[0]!, codes[2]!]) {
      expect(Number(code.at(-1))).toBe(ean13CheckDigit(code.slice(0, 12)));
    }
    expect(detail.variants[0]!.barcodes[1]).toMatchObject({ packQty: 12000, packName: 'كرتونة' });
    // The next product continues the store's internal numbering.
    const next = await create({
      nameAr: 'جوارب',
      variants: [{ price: { currency: 'SYP', priceMinor: 100 }, barcodes: [{ kind: 'internal' }] }],
    });
    expect(next.variants[0]!.barcodes[0]!.code).toBe('2900000000032');
  });

  it('refuses a barcode another product holds, naming that product, and duplicates inside one request', async () => {
    await create();
    const res = await call(
      'POST',
      '/v1/products',
      tea({
        nameAr: 'شاي آخر',
        variants: [
          {
            price: { currency: 'SYP', priceMinor: 1 },
            barcodes: [{ kind: 'standard', code: '6281234500012' }],
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'validation_failed',
      fields: {
        variants: 'الباركود 6281234500012 مستخدم في المنتج «شاي الربيع ٤٥٠ غ»',
        'variants.0.barcodes.0.code': 'الباركود 6281234500012 مستخدم في المنتج «شاي الربيع ٤٥٠ غ»',
      },
    });
    const twice = await call('POST', '/v1/products', {
      nameAr: 'مكرر',
      variants: [
        {
          price: { currency: 'SYP', priceMinor: 1 },
          barcodes: [
            { kind: 'standard', code: '1112223' },
            { kind: 'standard', code: '1112223' },
          ],
        },
      ],
    });
    expect(twice.json().error.fields['variants.0.barcodes.1.code']).toBe('الباركود مكرر في هذا المنتج');
    const [count] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from products`;
    expect(count!.n).toBe(1);
  });

  it('refuses unknown or archived references with the field named', async () => {
    const res = await call(
      'POST',
      '/v1/products',
      tea({ categoryId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01' }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toEqual({ categoryId: 'التصنيف غير موجود أو مؤرشف' });
    const empty = await call('POST', '/v1/products', { nameAr: ' ', variants: [] });
    expect(empty.json().error.fields).toMatchObject({
      nameAr: 'اسم المنتج مطلوب',
      variants: 'أضف سعراً واحداً على الأقل',
    });
  });

  it('answers 404 for an unknown or malformed id', async () => {
    for (const id of ['0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01', 'nope']) {
      expect((await call('GET', `/v1/products/${id}`)).statusCode).toBe(404);
    }
  });
});

describe('products: update, archive, restore', () => {
  it('the list’s in-place price edit moves the price, its date and the product’s version', async () => {
    const detail = await create();
    clock.set('2026-10-30T09:10:00.000Z');
    const res = await call('PATCH', `/v1/products/${detail.id}`, {
      version: detail.version,
      variants: [{ id: detail.variants[0]!.id, price: { currency: 'SYP', priceMinor: 4_750_000 } }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<ProductDetail>();
    expect(updated.version).toBe(2);
    expect(updated.variants[0]).toMatchObject({
      price: { currency: 'SYP', priceMinor: 4_750_000 },
      priceChangedAt: '2026-10-30T09:10:00.000Z',
      barcodes: detail.variants[0]!.barcodes,
    });
    const [log] = await ownerDb()<{ data: { variants: Record<string, unknown>[] } }[]>`
      select data from audit_logs where action = 'product.updated'`;
    expect(log!.data.variants[0]).toMatchObject({ priceMinor: [4_500_000, 4_750_000] });
  });

  it('answers 409 stale_version to an edit made on an old version, and changes nothing', async () => {
    const detail = await create();
    await call('PATCH', `/v1/products/${detail.id}`, { version: 1, nameAr: 'شاي' });
    const res = await call('PATCH', `/v1/products/${detail.id}`, { version: 1, nameAr: 'شاي قديم' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('stale_version');
    expect((await call('GET', `/v1/products/${detail.id}`)).json().nameAr).toBe('شاي');
  });

  it('a variant’s barcodes list is complete: left out is removed, a code can move between variants', async () => {
    const detail = await create({
      nameAr: 'قميص',
      variants: [
        {
          attributes: [{ name: 'المقاس', value: 'M' }],
          price: { currency: 'SYP', priceMinor: 1 },
          barcodes: [{ kind: 'standard', code: 'AAA111' }],
        },
        {
          attributes: [{ name: 'المقاس', value: 'L' }],
          price: { currency: 'SYP', priceMinor: 1 },
          barcodes: [{ kind: 'standard', code: 'BBB222' }],
        },
      ],
    });
    const [m, l] = detail.variants;
    const res = await call('PATCH', `/v1/products/${detail.id}`, {
      version: detail.version,
      variants: [
        { id: m!.id, barcodes: [] },
        {
          id: l!.id,
          barcodes: [
            { id: l!.barcodes[0]!.id, kind: 'standard', code: 'BBB222' },
            { kind: 'standard', code: 'AAA111' },
          ],
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<ProductDetail>();
    expect(updated.variants[0]!.barcodes).toEqual([]);
    expect(updated.variants[1]!.barcodes.map((b) => b.code)).toEqual(['BBB222', 'AAA111']);
    expect(updated.variants[1]!.barcodes[0]!.id).toBe(l!.barcodes[0]!.id);
  });

  it('adds a variant, archives one, and keeps at least one live variant with distinct options', async () => {
    const detail = await create();
    const only = detail.variants[0]!;
    const alone = await call('PATCH', `/v1/products/${detail.id}`, {
      version: 1,
      variants: [{ price: { currency: 'SYP', priceMinor: 9 } }],
    });
    expect(alone.json().error.fields).toEqual({ variants: 'اختر المقاس أو اللون' });
    const archiveAll = await call('PATCH', `/v1/products/${detail.id}`, {
      version: 1,
      variants: [{ id: only.id, archived: true }],
    });
    expect(archiveAll.json().error.fields).toEqual({ variants: 'يبقى للمنتج سعر واحد على الأقل' });
    const res = await call('PATCH', `/v1/products/${detail.id}`, {
      version: 1,
      variants: [
        { id: only.id, attributes: [{ name: 'الحجم', value: 'صغير' }] },
        { attributes: [{ name: 'الحجم', value: 'كبير' }], price: { currency: 'SYP', priceMinor: 8_000_000 } },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<ProductDetail>();
    expect(updated.variants.map((v) => v.label)).toEqual(['صغير', 'كبير']);
    const other = await create(
      tea({ nameAr: 'آخر', variants: [{ price: { currency: 'SYP', priceMinor: 1 } }] }),
    );
    const foreign = await call('PATCH', `/v1/products/${detail.id}`, {
      version: updated.version,
      variants: [{ id: other.variants[0]!.id, sku: 'X' }],
    });
    expect(foreign.json().error.fields).toMatchObject({ 'variants.0.id': 'هذا المتغير ليس من هذا المنتج' });
  });

  it('archives and restores, moving the version and leaving an audit entry each time', async () => {
    const detail = await create();
    const archived = await call('POST', `/v1/products/${detail.id}/archive`);
    expect(archived.json()).toMatchObject({ archivedAt: '2026-10-30T09:00:00.000Z', version: 2 });
    expect((await list()).items).toEqual([]);
    expect((await list('?status=archived')).items.map((p) => p.id)).toEqual([detail.id]);
    const restored = await call('POST', `/v1/products/${detail.id}/restore`);
    expect(restored.json()).toMatchObject({ archivedAt: null, version: 3 });
    expect(await auditActions()).toEqual(['product.created', 'product.archived', 'product.restored']);
  });
});

describe('GET /v1/products and GET /v1/barcodes/{code}', () => {
  it('finds by normalized Arabic name or by exact barcode, filters by category, and pages', async () => {
    const category = (await call('POST', '/v1/categories', { name: 'مشروبات' })).json<Category>();
    await create(tea({ categoryId: category.id }));
    await create({
      nameAr: 'شوكولاتة بالحليب',
      variants: [
        {
          price: { currency: 'SYP', priceMinor: 900_000 },
          barcodes: [{ kind: 'standard', code: '5000159461122' }],
        },
      ],
    });
    await create({ nameAr: 'أرز مصري', variants: [{ price: { currency: 'SYP', priceMinor: 1 } }] });

    expect((await list('?q=' + encodeURIComponent('شُوكولاته'))).items.map((p) => p.nameAr)).toEqual([
      'شوكولاتة بالحليب',
    ]);
    expect((await list('?q=' + encodeURIComponent('ارز'))).items.map((p) => p.nameAr)).toEqual(['أرز مصري']);
    expect((await list('?q=' + encodeURIComponent('٥٠٠٠١٥٩٤٦١١٢٢'))).items.map((p) => p.nameAr)).toEqual([
      'شوكولاتة بالحليب',
    ]);
    expect((await list('?q=' + encodeURIComponent('50%'))).items).toEqual([]);
    expect((await list(`?categoryId=${category.id}`)).items.map((p) => p.categoryName)).toEqual(['مشروبات']);

    const first = await list('?limit=2');
    expect(first.items.map((p) => p.nameAr)).toEqual(['أرز مصري', 'شاي الربيع ٤٥٠ غ']);
    const second = await list(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((p) => p.nameAr)).toEqual(['شوكولاتة بالحليب']);
    expect(second.nextCursor).toBeNull();
    expect((await call('GET', '/v1/products?cursor=broken')).json().error.fields).toHaveProperty('cursor');
  });

  it('summarises price, variant count, first barcode and stock per row', async () => {
    const detail = await create();
    const [row] = (await list()).items;
    expect(row).toEqual({
      id: detail.id,
      nameAr: 'شاي الربيع ٤٥٠ غ',
      nameEn: 'Rabea Tea 450g',
      categoryId: null,
      categoryName: null,
      type: 'stock',
      status: 'active',
      archivedAt: null,
      variantCount: 1,
      singleVariantId: detail.variants[0]!.id,
      price: { currency: 'SYP', minMinor: 4_500_000, maxMinor: 4_500_000 },
      barcode: '6281234500012',
      stockQty: 0,
      version: 1,
    });
    const mixed = await create({
      nameAr: 'ب',
      variants: [
        { attributes: [{ name: 'ل', value: '1' }], price: { currency: 'SYP', priceMinor: 1 } },
        { attributes: [{ name: 'ل', value: '2' }], price: { currency: 'USD', priceMinor: 1 } },
      ],
    });
    const mixedRow = (await list()).items.find((p) => p.id === mixed.id)!;
    expect(mixedRow).toMatchObject({ variantCount: 2, singleVariantId: null, price: null, barcode: null });
  });

  it('looks a barcode up, Arabic digits accepted; an unknown code is 404', async () => {
    const detail = await create();
    const res = await call('GET', '/v1/barcodes/' + encodeURIComponent('٦٢٨١٢٣٤٥٠٠٠١٢'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<BarcodeLookupResponse>()).toEqual({
      productId: detail.id,
      variantId: detail.variants[0]!.id,
      barcode: detail.variants[0]!.barcodes[0],
    });
    expect((await call('GET', '/v1/barcodes/0000000')).statusCode).toBe(404);
  });
});

describe('categories, units and tax rates', () => {
  it('categories form a tree without loops, with live product counts and versions', async () => {
    const food = (await call('POST', '/v1/categories', { name: 'أغذية', sortOrder: 2 })).json<Category>();
    const rice = (await call('POST', '/v1/categories', { name: 'أرز', parentId: food.id })).json<Category>();
    await create(tea({ categoryId: rice.id }));
    const res = await call('GET', '/v1/categories');
    expect(res.json().items).toEqual([
      { ...rice, productCount: 1 },
      { ...food, productCount: 0 },
    ]);
    const loop = await call('PATCH', `/v1/categories/${food.id}`, {
      version: food.version,
      parentId: rice.id,
    });
    expect(loop.json().error.fields).toEqual({ parentId: 'لا يكون التصنيف أباً لنفسه أو لأحد أصله' });
    const stale = await call('PATCH', `/v1/categories/${food.id}`, { version: 99, name: 'x' });
    expect(stale.json().error.code).toBe('stale_version');
    const archived = await call('PATCH', `/v1/categories/${rice.id}`, {
      version: rice.version,
      archived: true,
    });
    expect(archived.json()).toMatchObject({
      archivedAt: '2026-10-30T09:00:00.000Z',
      version: 2,
      productCount: 1,
    });
  });

  it('units: two system units that rename but never archive, and the owner’s own', async () => {
    const units = (await call('GET', '/v1/units')).json<{ items: Unit[] }>().items;
    expect(units.map((u) => [u.name, u.symbol, u.allowsFraction, u.isSystem])).toEqual([
      ['قطعة', 'قطعة', false, true],
      ['كيلو', 'كغ', true, true],
    ]);
    const kg = units[1]!;
    const archive = await call('PATCH', `/v1/units/${kg.id}`, { version: kg.version, archived: true });
    expect(archive.json().error.fields).toEqual({ archived: 'وحدات المتجر الأساسية تُعدَّل ولا تُؤرشف' });
    const renamed = await call('PATCH', `/v1/units/${kg.id}`, { version: kg.version, name: 'كيلوغرام' });
    expect(renamed.json()).toMatchObject({ name: 'كيلوغرام', version: 2 });
    const metre = await call('POST', '/v1/units', { name: 'متر', symbol: 'م', allowsFraction: true });
    expect(metre.statusCode).toBe(201);
    expect(metre.json()).toMatchObject({ name: 'متر', isSystem: false, archivedAt: null, version: 1 });
  });

  it('tax rates are the owner’s: a manager reads them but cannot create or edit', async () => {
    const created = await call('POST', '/v1/tax-rates', {
      name: 'رسم الإنفاق الاستهلاكي',
      rateBp: 500,
      kind: 'consumption',
    });
    expect(created.statusCode, created.body).toBe(201);
    const rate = created.json<TaxRate>();
    expect(rate).toMatchObject({ rateBp: 500, kind: 'consumption', showOnReceipt: true, version: 1 });
    const manager = await staffUser(app, s, 'manager', '0933333333');
    expect((await call('GET', '/v1/tax-rates', undefined, manager.accessToken)).json().items).toHaveLength(1);
    expect(
      (await call('POST', '/v1/tax-rates', { name: 'x', rateBp: 1, kind: 'stamp' }, manager.accessToken))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/v1/tax-rates/${rate.id}`, { version: 1, name: 'x' }, manager.accessToken))
        .statusCode,
    ).toBe(403);
    // The rate itself is fixed once made: only its name, receipt flag and archive change.
    const edited = await call('PATCH', `/v1/tax-rates/${rate.id}`, {
      version: 1,
      rateBp: 900,
      showOnReceipt: false,
    });
    expect(edited.json()).toMatchObject({ rateBp: 500, showOnReceipt: false, version: 2 });
  });
});

describe('audit log of catalog writes', () => {
  it('records every create and edit of categories, units and tax rates, with the changed fields', async () => {
    const category = (await call('POST', '/v1/categories', { name: 'خضار' })).json<Category>();
    await call('PATCH', `/v1/categories/${category.id}`, { version: 1, name: 'خضار وفواكه' });
    const unit = (await call('POST', '/v1/units', { name: 'متر', symbol: 'م' })).json<Unit>();
    await call('PATCH', `/v1/units/${unit.id}`, { version: 1, symbol: 'م.' });
    const rate = (
      await call('POST', '/v1/tax-rates', { name: 'طابع', rateBp: 100, kind: 'stamp' })
    ).json<TaxRate>();
    await call('PATCH', `/v1/tax-rates/${rate.id}`, { version: 1, archived: true });
    expect(await auditActions()).toEqual([
      'category.created',
      'category.updated',
      'unit.created',
      'unit.updated',
      'tax_rate.created',
      'tax_rate.updated',
    ]);
    const [rename] = await ownerDb()<{ changes: unknown; user_id: string }[]>`
      select changes, user_id from audit_logs where action = 'category.updated'`;
    expect(rename).toEqual({ changes: { name: ['خضار', 'خضار وفواكه'] }, user_id: s.userId });
  });
});

describe('who may use the catalog (16 › رفع الصلاحية)', () => {
  it('a manager reads and edits products; a cashier can neither read nor write the catalog', async () => {
    const manager = await staffUser(app, s, 'manager', '0933333333');
    const cashier = await staffUser(app, s, 'cashier', '0944444444');
    const made = await create(tea(), manager.accessToken);
    expect((await call('GET', `/v1/products/${made.id}`, undefined, manager.accessToken)).statusCode).toBe(
      200,
    );

    const attempts: [string, 'GET' | 'POST' | 'PATCH', unknown?][] = [
      ['/v1/products', 'GET'],
      [
        '/v1/products',
        'POST',
        tea({ nameAr: 'x', variants: [{ price: { currency: 'SYP', priceMinor: 1 } }] }),
      ],
      [`/v1/products/${made.id}`, 'GET'],
      [`/v1/products/${made.id}`, 'PATCH', { version: made.version, nameAr: 'مسروق' }],
      [`/v1/products/${made.id}/archive`, 'POST'],
      ['/v1/barcodes/6281234500012', 'GET'],
      ['/v1/categories', 'GET'],
      ['/v1/categories', 'POST', { name: 'x' }],
      ['/v1/units', 'GET'],
      ['/v1/units', 'POST', { name: 'x', symbol: 'x' }],
      ['/v1/tax-rates', 'GET'],
    ];
    for (const [url, method, payload] of attempts) {
      const res = await call(method, url, payload, cashier.accessToken);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await call('GET', `/v1/products/${made.id}`)).json()).toMatchObject({
      nameAr: made.nameAr,
      version: 1,
    });
  });
});
