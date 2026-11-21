import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { FoodCostReport, ProductDetail, Recipe } from '@serva/core';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/** Recipes and «كلفة الوجبات»: cost from the ingredients' own stock value, shown only, nothing posted. */

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

async function product(store: Store, nameAr: string, priceMinor: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: { nameAr, variants: [{ price: { currency: 'SYP', priceMinor } }] },
  });
  expect(res.statusCode, res.body).toBe(201);
  const p = res.json<ProductDetail>();
  return { id: p.id, variantId: p.variants[0]!.id };
}

async function stock(store: Store, variantId: string, qty: number, valueMinor: number) {
  const [branch] = await ownerDb()<
    { id: string }[]
  >`select id from branches where tenant_id = ${store.tenantId}`;
  await ownerDb()`
    insert into stock_values (tenant_id, branch_id, variant_id, qty, value_minor)
    values (${store.tenantId}, ${branch!.id}, ${variantId}, ${qty}, ${valueMinor})`;
}

const put = (store: Store, dish: string, items: object[]) =>
  app.inject({ method: 'PUT', url: `/v1/recipes/${dish}`, headers: as(store), payload: { items } });

describe('a dish’s recipe', () => {
  it('is kept per dish, costs each ingredient at its stock’s average, and can be replaced or emptied', async () => {
    const store = await openStore(app);
    const dish = await product(store, 'بيتزا', 100_000);
    const cheese = await product(store, 'جبنة', 0);
    const flour = await product(store, 'طحين', 0);
    // 10 kg of cheese worth 500 000: 50 000 a kg; flour has never been stocked
    await stock(store, cheese.variantId, 10_000, 500_000);

    const made = await put(store, dish.id, [
      { variantId: cheese.variantId, qty: 200 },
      { variantId: flour.variantId, qty: 300 },
    ]);
    expect(made.statusCode, made.body).toBe(200);
    const recipe = made.json<Recipe>();
    expect(recipe.items.map((i) => [i.name, i.qty, i.costMinor])).toEqual([
      ['جبنة', 200, 10_000],
      ['طحين', 300, null],
    ]);
    expect(recipe).toMatchObject({ costMinor: 10_000, incomplete: true });
    expect(
      (await app.inject({ method: 'GET', url: `/v1/recipes/${dish.id}`, headers: as(store) })).json(),
    ).toEqual(recipe);

    const replaced = (await put(store, dish.id, [{ variantId: cheese.variantId, qty: 100 }])).json<Recipe>();
    expect(replaced.items).toHaveLength(1);
    expect(replaced.incomplete).toBe(false);
    expect((await put(store, dish.id, [])).json<Recipe>().items).toEqual([]);
  });

  it('refuses a duplicate or unknown ingredient, the dish itself, a bad quantity and an unknown dish', async () => {
    const store = await openStore(app);
    const dish = await product(store, 'بيتزا', 100_000);
    const cheese = await product(store, 'جبنة', 0);
    const same = [
      { variantId: cheese.variantId, qty: 1 },
      { variantId: cheese.variantId, qty: 2 },
    ];
    expect((await put(store, dish.id, same)).statusCode).toBe(400);
    expect((await put(store, dish.id, [{ variantId: cheese.variantId, qty: 0 }])).statusCode).toBe(400);
    const unknown = '0192a000-0000-7000-8000-0000000000aa';
    expect((await put(store, dish.id, [{ variantId: unknown, qty: 1 }])).statusCode).toBe(400);
    expect((await put(store, dish.id, [{ variantId: dish.variantId, qty: 1 }])).statusCode).toBe(400);
    expect((await put(store, unknown, [])).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/recipes/not-an-id', headers: as(store) })).statusCode,
    ).toBe(404);
  });

  it('is for whoever manages the catalog only', async () => {
    const store = await openStore(app);
    const dish = await product(store, 'بيتزا', 100_000);
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${dish.id}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('the food-cost report', () => {
  it('shows price, cost, margin and the period’s sales at that cost, and lists sold dishes with no recipe', async () => {
    const store = await openStore(app);
    const dish = await product(store, 'بيتزا', 100_000);
    const salad = await product(store, 'سلطة', 40_000);
    const cheese = await product(store, 'جبنة', 0);
    await stock(store, cheese.variantId, 10_000, 500_000);
    await put(store, dish.id, [{ variantId: cheese.variantId, qty: 200 }]);

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        lines: [
          cartLine(1, 100_000, { productId: dish.id, variantId: dish.variantId, name: 'بيتزا', qty: 3000 }),
          cartLine(2, 40_000, { productId: salad.id, variantId: salad.variantId, name: 'سلطة', qty: 1000 }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 340_000 }],
      }),
    );
    await push(app, store.device, [open, sold]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/food-cost?from=2026-10-01&to=2026-10-30',
      headers: as(store),
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json<FoodCostReport>();
    expect(report.rows).toEqual([
      expect.objectContaining({
        name: 'بيتزا',
        priceMinor: 100_000,
        costMinor: 10_000,
        marginMinor: 90_000,
        marginBp: 9_000,
        soldQty: 3000,
        soldCostMinor: 30_000,
        soldTotalMinor: 300_000,
        incomplete: false,
      }),
    ]);
    expect(report.withoutRecipe.map((d) => d.name)).toEqual(['سلطة']);
    expect(report).toMatchObject({ totalSoldMinor: 300_000, totalCostMinor: 30_000 });
    // Nothing was posted or deducted by showing it
    const [stockRow] = await ownerDb()`select qty from stock_values where variant_id = ${cheese.variantId}`;
    expect(Number(stockRow!.qty)).toBe(10_000);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/reports/food-cost?from=2026-10-30&to=2026-10-01',
          headers: as(store),
        })
      ).statusCode,
    ).toBe(400);
  });
});
