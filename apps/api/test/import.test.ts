import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  branchQtyKey,
  type ImportInput,
  type ImportResponse,
  type ImportType,
  type ProductListResponse,
} from '@serva/core';
import { checkIntegrity } from '../src/services/integrity';
import { ManualClock } from '../src/clock';
import { withTenant } from '@serva/db';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * Importing products, customers and suppliers from a spreadsheet (contracts/import.ts): the dry
 * run is the real run rolled back, a bad row costs only itself, a second run changes nothing, and
 * opening stock and balances go through the books (Dr 1300 / Cr 3900, Dr 1200 / Cr 3900).
 */

// The shared test database is truncated before every test; on a busy disk that takes a while
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

type Values = Record<string, string | number | null>;

async function run(
  type: ImportType,
  rows: Values[],
  options: Partial<Pick<ImportInput, 'mode' | 'existing' | 'branchId'>> = {},
  token = s.accessToken,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/import',
    headers: bearer(token),
    payload: {
      type,
      mode: options.mode ?? 'commit',
      existing: options.existing ?? 'skip',
      date: '2026-10-30',
      ...(options.branchId ? { branchId: options.branchId } : {}),
      rows: rows.map((values, i) => ({ line: i + 2, values })),
    },
  });
}

async function imported(type: ImportType, rows: Values[], options: Parameters<typeof run>[2] = {}) {
  const res = await run(type, rows, options);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ImportResponse>();
}

const problems = () =>
  withTenant(appDb().db, s.tenantId, (tx) => checkIntegrity(tx, s.tenantId)).then((r) =>
    r.checks.flatMap((c) => c.problems),
  );

const count = async (table: string, tenantId = s.tenantId) =>
  Number(
    (await ownerDb().unsafe(`select count(*)::int as n from ${table} where tenant_id = '${tenantId}'`))[0]!.n,
  );

const tea: Values = {
  name: 'شاي الربيع',
  barcode: '6281234500012',
  category: 'مشروبات',
  price: '45000',
  cost: '30000',
  quantity: '24',
};

describe('products', () => {
  it('a dry run says what would happen and changes nothing', async () => {
    const res = await imported('products', [tea, { name: 'سكر', barcode: '6281234500029', price: '9000' }], {
      mode: 'dry_run',
    });
    expect(res.totals).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    expect(res.results[0]!.notes.join(' ')).toContain('مشروبات');
    expect(await count('products')).toBe(0);
    expect(await count('categories')).toBe(0);
    expect(await count('stocktakes')).toBe(0);
    expect(await count('journal_entries')).toBe(0);
  });

  it('creates products, the missing category, prices in minor units and the barcode', async () => {
    const res = await imported('products', [tea, { ...tea, name: 'شاي أخضر', barcode: '6281234500036' }]);
    expect(res.totals).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    expect(await count('categories')).toBe(1);
    const list = await app.inject({ method: 'GET', url: '/v1/products', headers: bearer(s.accessToken) });
    const items = list.json<ProductListResponse>().items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.nameAr)).toEqual(expect.arrayContaining(['شاي الربيع', 'شاي أخضر']));
    expect(items.every((i) => i.categoryName === 'مشروبات' && i.barcode)).toBe(true);
    // 45,000 pounds are 4,500,000 in hundredths
    expect(items.find((i) => i.nameAr === 'شاي الربيع')!.price).toMatchObject({
      currency: 'SYP',
      minMinor: 4_500_000,
    });
    const audit =
      await ownerDb()`select action from audit_logs where tenant_id = ${s.tenantId} and action = 'import.chunk'`;
    expect(audit).toHaveLength(1);
  });

  it('names the problem of each bad row in Arabic and still imports the good ones', async () => {
    const res = await imported('products', [
      { name: '', price: '100' },
      { name: 'قلم', price: 'ابتدائي', barcode: '12' },
      { name: 'دفتر', price: '-5' },
      { name: 'مسطرة', price: '3000', unit: 'لتر مكعب' },
      { name: 'ممحاة', price: '1500', cost: 'x' },
      { name: 'مقص', price: '8000' },
      { name: 'لاصق' },
    ]);
    expect(res.totals).toMatchObject({ create: 1, error: 6 });
    const byLine = (line: number) => res.results.find((r) => r.line === line)!;
    expect(byLine(2).errors).toEqual([{ field: 'name', message: 'اسم المنتج مطلوب' }]);
    expect(
      byLine(3)
        .errors.map((e) => e.field)
        .sort(),
    ).toEqual(['barcode', 'price']);
    expect(byLine(4).errors).toEqual([{ field: 'price', message: 'سعر البيع لا يكون سالباً' }]);
    expect(byLine(5).errors[0]).toMatchObject({ field: 'unit' });
    expect(byLine(6).errors[0]).toMatchObject({ field: 'cost', message: 'التكلفة ليس رقماً' });
    expect(byLine(8).errors).toEqual([{ field: 'price', message: 'سعر البيع مطلوب للمنتج الجديد' }]);
    expect(byLine(7).status).toBe('create');
    expect(await count('products')).toBe(1);
  });

  it('reads Arabic digits, thousands separators and a decimal comma', async () => {
    const res = await imported('products', [
      { name: 'أ', price: '١٢٬٥٠٠', barcode: '٦٢٨١٢٣٤٥٠٠٠٤٣' },
      { name: 'ب', price: '12,500.50' },
      { name: 'ج', price: 1250.5 },
    ]);
    expect(res.totals.create).toBe(3);
    const rows = await ownerDb()`
      select p.name_ar, pr.price_minor::int as price from products p join prices pr on pr.id = (select id from variants where product_id = p.id) order by p.name_ar`;
    expect(rows.map((r) => r.price)).toEqual([1_250_000, 1_250_050, 125_050]);
    const code = await ownerDb()`select code from barcodes where tenant_id = ${s.tenantId}`;
    expect(code[0]!.code).toBe('6281234500043');
  });

  it('is idempotent by barcode: a second run skips, update changes only what differs', async () => {
    await imported('products', [tea]);
    const again = await imported('products', [tea]);
    expect(again.totals).toEqual({ create: 0, update: 0, skip: 1, error: 0 });
    expect(await count('products')).toBe(1);

    const same = await imported('products', [{ ...tea, quantity: '' }], { existing: 'update' });
    expect(same.results[0]).toMatchObject({ status: 'skip', notes: ['لا تغيير'] });

    const changed = await imported('products', [{ ...tea, price: '50000', quantity: '' }], {
      existing: 'update',
    });
    expect(changed.totals.update).toBe(1);
    const price = await ownerDb()`select price_minor::int as p from prices where tenant_id = ${s.tenantId}`;
    expect(price[0]!.p).toBe(5_000_000);
    expect(await count('products')).toBe(1);
  });

  it('a barcode held by another store is not found: stores do not see each other', async () => {
    await imported('products', [tea]);
    const other = await testStore(app, '0922222222');
    const res = await run('products', [tea], { existing: 'update' }, other.accessToken);
    expect(res.json<ImportResponse>().totals.create).toBe(1);
    expect(await count('products', other.tenantId)).toBe(1);
    expect(await count('products')).toBe(1);
    expect(await count('categories', other.tenantId)).toBe(1);
  });

  it('rows of one name with sizes and colours become the variants of one product', async () => {
    const res = await imported('products', [
      { name: 'قميص قطن', size: 'M', colour: 'أزرق', price: '85000', barcode: '6290000000011' },
      { name: 'قميص قطن', size: 'L', colour: 'أزرق', price: '85000', barcode: '6290000000028' },
      { name: 'قميص قطن', size: 'L', colour: 'أحمر', price: '90000' },
    ]);
    expect(res.totals.create).toBe(3);
    expect(await count('products')).toBe(1);
    expect(await count('variants')).toBe(3);
    const labels =
      await ownerDb()`select label from variants where tenant_id = ${s.tenantId} order by sort_order`;
    expect(labels.map((l) => l.label)).toEqual(['M · أزرق', 'L · أزرق', 'L · أحمر']);

    // A new colour later joins the same product; the old rows are found by barcode
    const later = await imported('products', [
      { name: 'قميص قطن', size: 'M', colour: 'أزرق', price: '85000', barcode: '6290000000011' },
      { name: 'قميص قطن', size: 'XL', colour: 'أزرق', price: '95000', barcode: '6290000000035' },
    ]);
    expect(later.results.map((r) => r.status)).toEqual(['skip', 'create']);
    expect(await count('products')).toBe(1);
    expect(await count('variants')).toBe(4);
  });

  it('a row repeating a barcode for another size is refused and named, a barcode of another size is noted', async () => {
    const res = await imported('products', [
      { name: 'قميص', size: 'M', colour: 'أزرق', price: '85000', barcode: '6290000000011' },
      { name: 'قميص', size: 'L', colour: 'أزرق', price: '85000', barcode: '6290000000011' },
    ]);
    expect(res.results[0]!.status).toBe('create');
    expect(res.results[1]!.status).toBe('error');
    expect(res.results[1]!.errors[0]!.message).toContain('السطر 2');
    expect(res.results[1]!.errors[0]!.message).toContain('L · أزرق');
    expect(await count('variants')).toBe(1);

    const later = await imported('products', [
      { name: 'قميص', size: 'XL', colour: 'أحمر', price: '85000', barcode: '6290000000011' },
    ]);
    expect(later.results[0]!.notes.join(' ')).toContain('XL · أحمر');
  });

  it('a single row with a size and a colour becomes a product with one variant', async () => {
    const res = await imported('products', [
      { name: 'حذاء رياضي', size: '42', colour: 'أسود', price: '250000', barcode: '6290000000099' },
    ]);
    expect(res.totals.create).toBe(1);
    const labels = await ownerDb()`select label from variants where tenant_id = ${s.tenantId}`;
    expect(labels.map((l) => l.label)).toEqual(['42 · أسود']);
  });

  it('a barcode another product holds, met while adding a size, is reported on its row', async () => {
    await imported('products', [{ name: 'شاي', price: '1000', barcode: '6290000000200' }]);
    const res = await imported('products', [
      { name: 'قميص', size: 'S', price: '1000', barcode: '6290000000211' },
      { name: 'قميص', size: 'M', price: '1000', barcode: '6290000000200' },
    ]);
    expect(res.results.some((r) => r.status === 'error' && r.errors[0]!.field === 'barcode')).toBe(true);
    expect(await count('products')).toBe(1);
  });

  it('a problem in one size names that row and the others of the product wait', async () => {
    const res = await imported('products', [
      { name: 'بنطال', size: '32', price: '70000' },
      { name: 'بنطال', size: '34' },
    ]);
    expect(res.totals.error).toBe(2);
    expect(res.results[1]!.errors[0]).toMatchObject({ field: 'price' });
    expect(res.results[0]!.errors[0]!.message).toContain('السطر 3');
    expect(await count('products')).toBe(0);
  });

  it('opening stock goes through the books: stock, a document, Dr 1300 / Cr 3900, integrity holds', async () => {
    const res = await imported('products', [
      tea,
      { name: 'سكر', barcode: '6281234500029', price: '9000', quantity: '10' },
    ]);
    expect(res.totals.create).toBe(2);
    const level = await ownerDb()`
      select sl.qty::int as qty from stock_levels sl join barcodes b on b.variant_id = sl.variant_id
      where b.code = '6281234500012'`;
    expect(level[0]!.qty).toBe(24_000);
    // «سكر» has no cost: it enters at no value and says so
    expect(res.results[1]!.notes.join(' ')).toContain('لا تكلفة');

    const [doc] =
      await ownerDb()`select number, note, diff_value_minor::int as v from stocktakes where tenant_id = ${s.tenantId}`;
    expect(doc).toMatchObject({ note: 'رصيد افتتاحي (استيراد)', v: 24 * 3_000_000 });
    expect(doc!.number).toMatch(/^OPN-2026-/);
    const lines = await ownerDb()`
      select a.code, l.debit_minor::int as d, l.credit_minor::int as c
      from journal_lines l join accounts a on a.id = l.account_id where l.tenant_id = ${s.tenantId} order by a.code`;
    expect(lines).toEqual([
      { code: '1300', d: 72_000_000, c: 0 },
      { code: '3900', d: 0, c: 72_000_000 },
    ]);
    expect(await problems()).toEqual([]);
  });

  it('a second run of the same file does not stock twice', async () => {
    await imported('products', [tea]);
    const again = await imported('products', [tea], { existing: 'update' });
    expect(again.results[0]!.notes.join(' ')).toContain('حركة مخزون سابقة');
    const level =
      await ownerDb()`select sum(qty)::int as qty from stock_levels where tenant_id = ${s.tenantId}`;
    expect(level[0]!.qty).toBe(24_000);
    expect(await count('stocktakes')).toBe(1);
  });

  it('quantity per branch, and a fraction is refused for a unit that has none', async () => {
    const second = await ownerDb()<{ id: string }[]>`
      insert into branches (tenant_id, code, name) values (${s.tenantId}, '002', 'فرع المزة') returning id`;
    const res = await imported('products', [
      {
        name: 'أرز',
        barcode: '6281234500050',
        price: '12000',
        cost: '9000',
        [branchQtyKey(s.branchId)]: '5',
        [branchQtyKey(second[0]!.id)]: '7',
      },
      { name: 'ملح', barcode: '6281234500067', price: '2000', quantity: '2.5' },
    ]);
    expect(res.results[0]!.status).toBe('create');
    expect(res.results[1]!.errors[0]).toMatchObject({ field: 'quantity' });
    const levels =
      await ownerDb()`select branch_id, qty::int as qty from stock_levels where tenant_id = ${s.tenantId}`;
    expect(levels.map((l) => l.qty).sort()).toEqual([5_000, 7_000]);
    expect(await count('stocktakes')).toBe(2);
  });

  it('opening stock needs the stock permission: a manager has it, a catalog-only role does not', async () => {
    const manager = await staffUser(app, s, 'manager', '0933333333');
    const ok = await run('products', [tea], {}, manager.accessToken);
    expect(ok.json<ImportResponse>().totals.create).toBe(1);
  });

  it('a cashier is refused the whole import', async () => {
    const cashier = await staffUser(app, s, 'cashier', '0944444444');
    for (const type of ['products', 'customers', 'suppliers'] as const) {
      const res = await run(type, [{ name: 'اختبار', price: '1' }], {}, cashier.accessToken);
      expect(res.statusCode, type).toBe(403);
    }
    expect(await count('products')).toBe(0);
  });

  it('refuses a missing token, a chunk that is too big, an empty one and an unknown type', async () => {
    const noToken = await app.inject({ method: 'POST', url: '/v1/import', payload: {} });
    expect(noToken.statusCode).toBe(401);
    const big = await run(
      'products',
      Array.from({ length: 501 }, (_, i) => ({ name: `م${String(i)}`, price: '1' })),
    );
    expect(big.statusCode).toBe(400);
    expect((await run('products', [])).statusCode).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/import',
      headers: bearer(s.accessToken),
      payload: { type: 'invoices', mode: 'commit', date: '2026-10-30', rows: [{ line: 1, values: {} }] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('customers and suppliers', () => {
  it('creates, then finds them again by phone', async () => {
    const rows: Values[] = [
      { name: 'أحمد الحلبي', phone: '0912345678', creditLimit: '500000', priceTier: 'جملة' },
      { name: 'ليلى', phone: '٠٩٣٣٣٣٣٣٣٣' },
      { name: 'بلا رقم' },
    ];
    const first = await imported('customers', rows);
    expect(first.totals.create).toBe(3);
    const again = await imported('customers', rows);
    expect(again.totals).toEqual({ create: 0, update: 0, skip: 3, error: 0 });
    expect(await count('customers')).toBe(3);

    const updated = await imported('customers', [{ name: 'أحمد الحلبي (جديد)', phone: '0912345678' }], {
      existing: 'update',
    });
    expect(updated.totals.update).toBe(1);
    const row =
      await ownerDb()`select name, credit_limit_minor::int as l, price_tier from customers where phone like '%912345678'`;
    expect(row[0]).toMatchObject({ name: 'أحمد الحلبي (جديد)', l: 50_000_000, price_tier: 'wholesale' });
  });

  it('refuses a bad phone and a short name in Arabic', async () => {
    const res = await imported('customers', [
      { name: 'س', phone: '12' },
      { name: 'سامر', phone: '123' },
    ]);
    expect(res.totals.error).toBe(2);
    expect(res.results[0]!.errors.map((e) => e.field).sort()).toEqual(['name', 'phone']);
    expect(res.results[1]!.errors[0]!.message).toContain('رقم الهاتف');
  });

  it('an opening balance is an entry against 3900 and shows as the customer’s balance, once', async () => {
    const row = { name: 'محمود', phone: '0955555555', balance: '150000' };
    const dry = await imported('customers', [row], { mode: 'dry_run' });
    expect(dry.totals.create).toBe(1);
    expect(await count('journal_entries')).toBe(0);

    await imported('customers', [row]);
    await imported('customers', [row], { existing: 'update' });
    const list = await app.inject({ method: 'GET', url: '/v1/customers', headers: bearer(s.accessToken) });
    expect(list.json().items[0]).toMatchObject({ name: 'محمود', balanceMinor: 15_000_000 });
    const lines = await ownerDb()`
      select a.code, l.debit_minor::int as d, l.credit_minor::int as c, l.party_type
      from journal_lines l join accounts a on a.id = l.account_id where l.tenant_id = ${s.tenantId} order by a.code`;
    expect(lines).toEqual([
      { code: '1200', d: 15_000_000, c: 0, party_type: 'customer' },
      { code: '3900', d: 0, c: 15_000_000, party_type: null },
    ]);
    const entry =
      await ownerDb()`select kind, source_type from journal_entries where tenant_id = ${s.tenantId}`;
    expect(entry).toEqual([{ kind: 'manual', source_type: 'manual' }]);
  });

  it('only the owner books an opening balance; a manager’s rows with one are refused, the rest pass', async () => {
    const manager = await staffUser(app, s, 'manager', '0933333333');
    const res = await run(
      'customers',
      [
        { name: 'محمود', phone: '0955555555', balance: '150000' },
        { name: 'سعيد', phone: '0966666666' },
      ],
      {},
      manager.accessToken,
    );
    const body = res.json<ImportResponse>();
    expect(body.results[0]).toMatchObject({ status: 'error', errors: [{ field: 'balance' }] });
    expect(body.results[1]!.status).toBe('create');
    expect(await count('journal_entries')).toBe(0);
  });

  it('suppliers: a balance is what the store owes, a negative one what the supplier owes the store', async () => {
    const res = await imported('suppliers', [
      { name: 'شركة النور', phone: '0933123456', balance: '2000000' },
      { name: 'مؤسسة الفرات', balance: '-5000' },
    ]);
    expect(res.totals.create).toBe(2);
    const list = await app.inject({ method: 'GET', url: '/v1/suppliers', headers: bearer(s.accessToken) });
    const items = list.json().items as { name: string; balanceMinor: number }[];
    expect(items.find((i) => i.name === 'شركة النور')!.balanceMinor).toBe(200_000_000);
    expect(items.find((i) => i.name === 'مؤسسة الفرات')!.balanceMinor).toBe(-500_000);
    const again = await imported('suppliers', [
      { name: 'شركة النور', phone: '0933123456' },
      { name: 'مؤسسة الفرات' },
    ]);
    expect(again.totals).toEqual({ create: 0, update: 0, skip: 2, error: 0 });
    expect(await problems()).toEqual([]);
  });

  it('suppliers: a new row with the name of another supplier is created with a duplicate note', async () => {
    await imported('suppliers', [{ name: 'شركة السلام', phone: '0933111111' }]);
    const res = await imported('suppliers', [{ name: 'شركة السلام', phone: '0933222222' }]);
    expect(res.totals.create).toBe(1);
    expect(res.results[0]!.notes.join(' ')).toContain('بالاسم نفسه');
  });

  it('customers of one store are not found by another', async () => {
    await imported('customers', [{ name: 'محمود', phone: '0955555555' }]);
    const other = await testStore(app, '0922222222');
    const res = await run(
      'customers',
      [{ name: 'محمود', phone: '0955555555' }],
      { existing: 'update' },
      other.accessToken,
    );
    expect(res.json<ImportResponse>().totals.create).toBe(1);
    expect(await count('customers')).toBe(1);
    expect(await count('customers', other.tenantId)).toBe(1);
  });
});
