import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PriceListApplied, PriceListPreview, ProductDetail } from '@serva/core';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/** «تحديث الأسعار من ملف» (03 › الصيدلية: نشرة أسعار الوزارة): match a price list, show, apply, log. */

let app: FastifyInstance;
let s: TestStore;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  s = await testStore(app);
});

const post = (url: string, payload: object, token = s.accessToken) =>
  app.inject({ method: 'POST', url, headers: bearer(token), payload });

async function product(
  nameAr: string,
  priceMinor: number,
  extra: Record<string, unknown> = {},
  variant: Record<string, unknown> = {},
) {
  const res = await post('/v1/products', {
    nameAr,
    ...extra,
    variants: [{ price: { currency: 'SYP', priceMinor }, ...variant }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

const preview = async (rows: Record<string, unknown>[]) => {
  const res = await post('/v1/prices/list/preview', { rows });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PriceListPreview>().items;
};

const priceOf = async (variantId: string) =>
  (await ownerDb()<{ p: string }[]>`select price_minor::text as p from prices where id = ${variantId}`)[0]!.p;

describe('price list: preview', () => {
  it('matches by barcode first, then by Arabic, trade or scientific name, and says why a row did not match', async () => {
    const byCode = await product(
      'بنادول',
      1_000_000,
      {},
      { barcodes: [{ kind: 'standard', code: '6291003012345' }] },
    );
    const byAr = await product('أموكسيسيلين ٥٠٠', 2_000_000);
    const byEn = await product('أوغمنتين', 3_000_000, { nameEn: 'Augmentin 1g' });
    const byGeneric = await product('مضاد حيوي', 4_000_000, { genericName: 'Cefixime' });
    const same = await product(
      'فيتامين ج',
      500_000,
      {},
      { barcodes: [{ kind: 'standard', code: '5000000000017' }] },
    );
    await product('كريم', 100_000);
    await product('كريم', 120_000);
    const items = await preview([
      { row: 2, barcode: '6291003012345', name: 'اسم آخر', priceMinor: 1_100_000 },
      // A number from Excel loses nothing; the name is found without hamza, tashkeel or digit style
      { row: 3, name: 'اموكسيسيلين 500', priceMinor: 2_500_000 },
      { row: 4, name: 'AUGMENTIN 1G', priceMinor: 3_300_000 },
      { row: 5, generic: 'cefixime', priceMinor: 4_400_000 },
      { row: 6, barcode: '5000000000017', priceMinor: 500_000 },
      { row: 7, name: 'كريم', priceMinor: 130_000 },
      { row: 8, barcode: '9999999999999', name: 'غير موجود', priceMinor: 9_000 },
      { row: 9, priceMinor: 9_000 },
      { row: 10, barcode: '6291003012345', priceMinor: 1_200_000 },
    ]);
    const by = Object.fromEntries(items.map((i) => [i.row, i]));
    expect(by[2]).toMatchObject({
      status: 'change',
      matchedBy: 'barcode',
      variantId: byCode.variants[0]!.id,
      productId: byCode.id,
      oldMinor: 1_000_000,
      newMinor: 1_100_000,
    });
    expect(by[3]).toMatchObject({ status: 'change', matchedBy: 'name', variantId: byAr.variants[0]!.id });
    expect(by[4]).toMatchObject({ status: 'change', variantId: byEn.variants[0]!.id, newMinor: 3_300_000 });
    expect(by[5]).toMatchObject({ status: 'change', variantId: byGeneric.variants[0]!.id });
    expect(by[6]).toMatchObject({ status: 'same', variantId: same.variants[0]!.id });
    expect(by[7]).toMatchObject({ status: 'ambiguous', variantId: null });
    expect(by[8]).toMatchObject({ status: 'unmatched', source: '9999999999999', oldMinor: null });
    expect(by[9]).toMatchObject({ status: 'unmatched', source: '' });
    // The same piece twice in the file: the first row counts
    expect(by[10]).toMatchObject({ status: 'duplicate', variantId: byCode.variants[0]!.id });
  });

  it('finds a barcode Excel wrote without its leading zeros, and ignores pack barcodes and archived pieces', async () => {
    const zero = await product(
      'دواء صفري',
      1_000,
      {},
      { barcodes: [{ kind: 'standard', code: '0123456789012' }] },
    );
    const exact = await product(
      'دواء آخر',
      1_000,
      {},
      { barcodes: [{ kind: 'standard', code: '123456789012' }] },
    );
    await product(
      'علبة',
      1_000,
      {},
      { barcodes: [{ kind: 'standard', code: '7000000000001', packQty: 12_000, packName: 'كرتونة' }] },
    );
    const gone = await product(
      'مؤرشف',
      1_000,
      {},
      { barcodes: [{ kind: 'standard', code: '8000000000008' }] },
    );
    expect((await post(`/v1/products/${gone.id}/archive`, {})).statusCode).toBe(200);
    const items = await preview([
      { row: 1, barcode: '123456789012', priceMinor: 2_000 },
      { row: 2, barcode: '0123456789012', priceMinor: 3_000 },
      { row: 3, barcode: '7000000000001', priceMinor: 4_000 },
      { row: 4, barcode: '8000000000008', priceMinor: 4_000 },
      { row: 5, barcode: '٦٢٩ ١٠٠', priceMinor: 4_000 },
    ]);
    // Typed in full, a code is its own piece; the shorter one is not taken for the zero-led one
    expect(items[0]).toMatchObject({ variantId: exact.variants[0]!.id });
    expect(items[1]).toMatchObject({ variantId: zero.variants[0]!.id });
    expect(items.slice(2).map((i) => i.status)).toEqual(['unmatched', 'unmatched', 'unmatched']);
  });

  it('matches a code Excel dropped the zeros from when only the zero-led code exists', async () => {
    const zero = await product(
      'دواء',
      1_000,
      {},
      { barcodes: [{ kind: 'standard', code: '0123456789012' }] },
    );
    const [item] = await preview([{ row: 1, barcode: '123456789012', priceMinor: 2_000 }]);
    expect(item).toMatchObject({ status: 'change', variantId: zero.variants[0]!.id, matchedBy: 'barcode' });
  });

  it('reports how many sizes a matched model has, and a whole-model change reaches every live variant', async () => {
    const shirt = await post('/v1/products', {
      nameAr: 'قميص',
      variants: ['S', 'M', 'L'].map((size, i) => ({
        attributes: [{ name: 'المقاس', value: size }],
        price: { currency: 'SYP', priceMinor: 1_000 },
        barcodes: [{ kind: 'standard', code: `55500000000${String(i)}` }],
      })),
    });
    const p = shirt.json<ProductDetail>();
    const [item] = await preview([{ row: 1, barcode: '555000000000', priceMinor: 2_000 }]);
    expect(item).toMatchObject({ status: 'change', modelSize: 3, variantId: p.variants[0]!.id });
    const one = await post('/v1/prices/list/apply', {
      changes: [{ variantId: p.variants[0]!.id, newMinor: 2_000 }],
    });
    expect(one.json<PriceListApplied>().changed).toBe(1);
    const all = await post('/v1/prices/list/apply', {
      changes: [{ variantId: p.variants[0]!.id, newMinor: 3_000, wholeModel: true }],
    });
    expect(all.json<PriceListApplied>().changed).toBe(3);
    for (const v of p.variants) expect(await priceOf(v.id)).toBe('3000');
  });

  it('flags a piece priced in another currency and changes nothing', async () => {
    const usd = await product('دواء بالدولار', 500, {}, { price: { currency: 'USD', priceMinor: 500 } });
    const [item] = await preview([{ row: 1, name: 'دواء بالدولار', priceMinor: 600 }]);
    expect(item).toMatchObject({ status: 'other_currency', variantId: usd.variants[0]!.id });
    const res = await post('/v1/prices/list/apply', {
      changes: [{ variantId: usd.variants[0]!.id, newMinor: 600 }],
    });
    expect(res.json<PriceListApplied>()).toMatchObject({ changed: 0, skipped: 1, items: [] });
    expect(await priceOf(usd.variants[0]!.id)).toBe('500');
  });

  it('refuses a cashier and bad input', async () => {
    const cashier = await staffUser(app, s, 'cashier', '0944444444');
    const row = { row: 1, name: 'x', priceMinor: 1 };
    expect((await post('/v1/prices/list/preview', { rows: [row] }, cashier.accessToken)).statusCode).toBe(
      403,
    );
    expect(
      (
        await post(
          '/v1/prices/list/apply',
          { changes: [{ variantId: crypto.randomUUID(), newMinor: 5 }] },
          cashier.accessToken,
        )
      ).statusCode,
    ).toBe(403);
    expect((await post('/v1/prices/list/preview', { rows: [] })).statusCode).toBe(400);
    expect(
      (await post('/v1/prices/list/preview', { rows: [{ row: 1, name: 'x', priceMinor: 0 }] })).statusCode,
    ).toBe(400);
    expect(
      (await post('/v1/prices/list/apply', { changes: [{ variantId: 'x', newMinor: 5 }] })).statusCode,
    ).toBe(400);
    const anon = await app.inject({
      method: 'POST',
      url: '/v1/prices/list/preview',
      payload: { rows: [row] },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('handles 3,000 rows in one request', async () => {
    const one = await product('دواء وحيد', 1_000);
    const rows = Array.from({ length: 3000 }, (_, i) => ({
      row: i + 2,
      barcode: `9${String(i).padStart(12, '0')}`,
      name: i === 0 ? 'دواء وحيد' : `صنف مجهول ${String(i)}`,
      priceMinor: 2_000,
    }));
    const items = await preview(rows);
    expect(items).toHaveLength(3000);
    expect(items[0]).toMatchObject({ status: 'change', variantId: one.variants[0]!.id });
    expect(items.filter((i) => i.status === 'unmatched')).toHaveLength(2999);
  });
});

describe('price list: apply', () => {
  it('sets the prices like a manual edit, keeps the floor under them, ends a reached markdown, and logs each', async () => {
    const a = await product('دواء أ', 1_000_000, {}, { minPriceMinor: 900_000 });
    const b = await product('دواء ب', 2_000_000);
    const c = await product('دواء ج', 3_000_000);
    const [ia, ib] = [a.variants[0]!.id, b.variants[0]!.id];
    await ownerDb()`update prices set was_price_minor = 1500000 where id = ${ib}`;
    const before = await ownerDb()<{ u: Date }[]>`select updated_at as u from products where id = ${a.id}`;
    const res = await post('/v1/prices/list/apply', {
      fileName: 'نشرة.xlsx',
      changes: [
        { variantId: ia, newMinor: 800_000 },
        { variantId: ib, newMinor: 1_500_000 },
        // Same price: left alone; and a piece that does not exist
        { variantId: c.variants[0]!.id, newMinor: 3_000_000 },
        { variantId: crypto.randomUUID(), newMinor: 5 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const done = res.json<PriceListApplied>();
    expect(done).toMatchObject({ changed: 2, skipped: 2 });
    expect(done.items).toEqual(
      expect.arrayContaining([
        {
          productId: a.id,
          variantId: ia,
          name: 'دواء أ',
          currency: 'SYP',
          oldMinor: 1_000_000,
          newMinor: 800_000,
        },
        {
          productId: b.id,
          variantId: ib,
          name: 'دواء ب',
          currency: 'SYP',
          oldMinor: 2_000_000,
          newMinor: 1_500_000,
        },
      ]),
    );
    const rows = await ownerDb()<{ id: string; price: string; min: string | null; was: string | null }[]>`
      select id, price_minor::text as price, min_price_minor::text as min, was_price_minor::text as was
      from prices where id in (${ia}, ${ib})`;
    const at = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(at[ia]).toMatchObject({ price: '800000', min: '800000', was: null });
    expect(at[ib]).toMatchObject({ price: '1500000', was: null });
    expect(await priceOf(c.variants[0]!.id)).toBe('3000000');
    // The product's version moved, so the tills pull it
    const after = await ownerDb()<{ u: Date }[]>`select updated_at as u from products where id = ${a.id}`;
    expect(after[0]!.u.getTime()).toBeGreaterThan(before[0]!.u.getTime());
    const logs = await ownerDb()<
      { action: string; entity_id: string | null; changes: unknown; data: Record<string, unknown> }[]
    >`
      select action, entity_id, changes, data from audit_logs
      where tenant_id = ${s.tenantId} and action in ('price.changed', 'prices.list_applied') order by action, entity_id`;
    expect(logs.filter((l) => l.action === 'price.changed')).toHaveLength(2);
    expect(logs.find((l) => l.entity_id === ia)).toMatchObject({
      changes: { priceMinor: [1_000_000, 800_000] },
      data: { source: 'price_list', productId: a.id, fileName: 'نشرة.xlsx' },
    });
    expect(logs.find((l) => l.action === 'prices.list_applied')?.data).toEqual({
      fileName: 'نشرة.xlsx',
      pieces: 2,
      skipped: 2,
    });
  });

  it('applies 3,000 changes in one transaction, skips the unknown ones, and writes no log when nothing changes', async () => {
    const ids: string[] = [];
    const created = await Promise.all(
      Array.from({ length: 60 }, (_, i) => product(`صنف ${String(i)}`, 1_000 + i)),
    );
    for (const p of created) ids.push(p.variants[0]!.id);
    // 3,000 changes: the 60 real pieces plus unknown ones are skipped, not failed
    const changes = [
      ...ids.map((variantId) => ({ variantId, newMinor: 5_000 })),
      ...Array.from({ length: 2940 }, () => ({ variantId: crypto.randomUUID(), newMinor: 5_000 })),
    ];
    const res = await post('/v1/prices/list/apply', { changes });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PriceListApplied>()).toMatchObject({ changed: 60, skipped: 2940 });
    const again = await post('/v1/prices/list/apply', {
      changes: ids.map((variantId) => ({ variantId, newMinor: 5_000 })),
    });
    expect(again.json<PriceListApplied>()).toMatchObject({ changed: 0, skipped: 60 });
    const [count] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from audit_logs where tenant_id = ${s.tenantId} and action = 'prices.list_applied'`;
    expect(count!.n).toBe('1');
  });

  it('the last price asked for a piece wins', async () => {
    const a = await product('دواء', 1_000);
    const v = a.variants[0]!.id;
    const res = await post('/v1/prices/list/apply', {
      changes: [
        { variantId: v, newMinor: 2_000 },
        { variantId: v, newMinor: 3_000 },
      ],
    });
    expect(res.json<PriceListApplied>()).toMatchObject({ changed: 1, skipped: 0 });
    expect(await priceOf(v)).toBe('3000');
  });
});
