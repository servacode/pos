import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PriceChange, PriceListApplied, PriceListPreview, ProductDetail } from '@serva/core';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, testStore, type TestStore } from './staff';

/** Round 54: «تراجع» for an applied price list, and its rows grouped under one change in the history. */

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

const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });

async function product(nameAr: string, priceMinor: number) {
  const res = await post('/v1/products', {
    nameAr,
    variants: [{ price: { currency: 'SYP', priceMinor } }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ProductDetail>();
}

const priceOf = async (variantId: string) =>
  (await ownerDb()<{ p: string }[]>`select price_minor::text as p from prices where id = ${variantId}`)[0]!.p;

describe('price list undo', () => {
  it('puts every piece back (price, floor, struck price), leaves one edited since, and undoes once', async () => {
    const a = await product('دواء أ', 1_000_000);
    await ownerDb()`update prices set min_price_minor = 800000, was_price_minor = 1200000 where id = ${a.variants[0]!.id}`;
    const b = await product('دواء ب', 2_000_000);
    const rows = [
      { row: 1, name: 'دواء أ', priceMinor: 900_000 },
      { row: 2, name: 'دواء ب', priceMinor: 2_500_000 },
    ];
    const prev = (await post('/v1/prices/list/preview', { rows })).json<PriceListPreview>().items;
    const changes = prev.map((i) => ({
      variantId: i.variantId!,
      newMinor: i.newMinor,
      expectedOldMinor: i.oldMinor!,
    }));
    const apply = await post('/v1/prices/list/apply', { fileName: 'نشرة.xlsx', changes });
    expect(apply.statusCode, apply.body).toBe(200);
    const applied = apply.json<PriceListApplied>();
    expect(applied.changed).toBe(2);
    expect(applied.changeId).toBeTruthy();

    // The history: both pieces carry the change's id, so the screen can group them under one header
    const history = (
      await app.inject({ method: 'GET', url: '/v1/price-history', headers: bearer(s.accessToken) })
    ).json<{ items: PriceChange[] }>().items;
    const listed = history.filter((r) => r.source === 'price_list');
    expect(listed).toHaveLength(2);
    expect(listed.every((r) => r.batchId === applied.changeId && r.undone === false)).toBe(true);
    // No separate summary row for a file that is listed piece by piece
    expect(history.some((r) => r.source === 'price_list_summary')).toBe(false);

    // One piece is edited by hand after the file
    await ownerDb()`update prices set price_minor = 2_700_000 where id = ${b.variants[0]!.id}`;

    const undo = await post(`/v1/prices/bulk/${applied.changeId!}/undo`, {});
    expect(undo.statusCode, undo.body).toBe(200);
    expect(undo.json()).toEqual({ restored: 1, skipped: 1 });
    expect(await priceOf(a.variants[0]!.id)).toBe('1000000');
    expect(await priceOf(b.variants[0]!.id)).toBe('2700000');
    const [row] = await ownerDb()<{ min: string; was: string }[]>`
      select min_price_minor::text as min, was_price_minor::text as was from prices where id = ${a.variants[0]!.id}`;
    expect(row).toEqual({ min: '800000', was: '1200000' });

    expect((await post(`/v1/prices/bulk/${applied.changeId!}/undo`, {})).statusCode).toBe(409);
    const after = (
      await app.inject({ method: 'GET', url: '/v1/price-history', headers: bearer(s.accessToken) })
    ).json<{ items: PriceChange[] }>().items;
    expect(after.filter((r) => r.source === 'price_list').every((r) => r.undone === true)).toBe(true);
  });

  it('a file that changes nothing has no change id', async () => {
    const a = await product('دواء ج', 1_000_000);
    const apply = await post('/v1/prices/list/apply', {
      fileName: 'x.xlsx',
      changes: [{ variantId: a.variants[0]!.id, newMinor: 1_000_000 }],
    });
    expect(apply.json<PriceListApplied>().changeId).toBeUndefined();
  });
});
