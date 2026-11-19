import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  Category,
  CountSheet,
  ProductDetail,
  StocktakeDetail,
  SupplierRow,
  WasteReport,
} from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * Round 38, supermarket pack: «تالف / هدر» at the till (#41) posts through the store's ordinary stock count,
 * the waste report reads it by reason, product and cost, and the phone's count sheet (#29) carries the barcodes
 * so a count can be made with no connection and posted once, by its own id.
 */

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

async function world() {
  const store = await openStore(app);
  const cat = (
    await app.inject({
      method: 'POST',
      url: '/v1/categories',
      headers: as(store),
      payload: { name: 'ألبان' },
    })
  ).json<Category>();
  const make = async (nameAr: string, code: string, categoryId: string | null) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: {
        nameAr,
        categoryId,
        variants: [
          {
            price: { currency: 'SYP', priceMinor: 100_000 },
            barcodes: [{ kind: 'standard', code }],
          },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ProductDetail>().variants[0]!.id;
  };
  const milk = await make('حليب', '6281000000011', cat.id);
  const rice = await make('رز', '6281000000028', null);
  const supplier = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'معمل' } })
  ).json<SupplierRow>();
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [
        { variantId: milk, qty: 10_000, costMinor: 400_000 },
        { variantId: rice, qty: 10_000, costMinor: 200_000 },
      ],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { store, milk, rice, categoryId: cat.id };
}

const levelOf = async (variantId: string) => {
  const [row] = await ownerDb()<{ qty: string }[]>`
    select coalesce(sum(qty), 0)::text as qty from stock_levels where variant_id = ${variantId}`;
  return Number(row!.qty);
};

const wasteId = (n: number) => `0192a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('تالف / هدر at the till', () => {
  it('writes off through the stock count: stock and books move, the report reads it, the books stay balanced', async () => {
    const { store, milk } = await world();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/waste',
      headers: { authorization: store.device.authorization },
      payload: {
        id: wasteId(1),
        actorId: store.userId,
        reason: 'انتهت صلاحيتو',
        lines: [{ variantId: milk, qty: 2000 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const done = res.json<StocktakeDetail>();
    expect(done.id).toBe(wasteId(1));
    expect(done.lines[0]).toMatchObject({
      expectedQty: 10_000,
      countedQty: 8000,
      diffQty: -2000,
      reason: 'انتهت صلاحيتو',
    });
    // 2 of 10 at 40 each: 80,000 written off to 6300
    expect(done.diffValueMinor).toBe(-80_000);
    expect(await levelOf(milk)).toBe(8000);

    const report = await app.inject({
      method: 'GET',
      url: '/v1/reports/waste?from=2020-01-01&to=2099-01-01',
      headers: as(store),
    });
    expect(report.statusCode, report.body).toBe(200);
    const body = report.json<WasteReport>();
    expect(body.totalCostMinor).toBe(80_000);
    expect(body.byReason).toEqual([{ reason: 'انتهت صلاحيتو', qty: 2000, costMinor: 80_000, count: 1 }]);
    expect(body.byProduct[0]).toMatchObject({ variantId: milk, qty: 2000, costMinor: 80_000 });
    expect(body.rows).toHaveLength(1);

    // The trial balance stays balanced
    const [tb] = await ownerDb()<{ debit: string; credit: string }[]>`
      select coalesce(sum(debit_minor), 0)::text as debit, coalesce(sum(credit_minor), 0)::text as credit
      from journal_lines where tenant_id = ${store.tenantId}`;
    expect(tb!.debit).toBe(tb!.credit);
    const [loss] = await ownerDb()<{ n: string }[]>`
      select coalesce(sum(l.debit_minor), 0)::text as n from journal_lines l
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and a.code = '6300'`;
    expect(Number(loss!.n)).toBe(80_000);
  });

  it('a retry with the same id posts nothing twice', async () => {
    const { store, milk } = await world();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/device/waste',
        headers: { authorization: store.device.authorization },
        payload: {
          id: wasteId(2),
          actorId: store.userId,
          reason: 'انكسر',
          lines: [{ variantId: milk, qty: 1000 }],
        },
      });
    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json<StocktakeDetail>().number).toBe(first.json<StocktakeDetail>().number);
    expect(await levelOf(milk)).toBe(9000);
    const [n] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from stocktakes`;
    expect(n!.n).toBe(1);
  });

  it('refuses more than is on the shelf, and an actor without the adjustment permission', async () => {
    const { store, milk } = await world();
    const tooMuch = await app.inject({
      method: 'POST',
      url: '/v1/device/waste',
      headers: { authorization: store.device.authorization },
      payload: {
        id: wasteId(3),
        actorId: store.userId,
        reason: 'خربان',
        lines: [{ variantId: milk, qty: 11_000 }],
      },
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(await levelOf(milk)).toBe(10_000);

    // A user whose role lacks inventory.adjust
    const [role] = await ownerDb()<{ id: string }[]>`
      select id from roles where tenant_id = ${store.tenantId} and not ('inventory.adjust' = any(permissions)) limit 1`;
    const [user] = await ownerDb()<{ id: string }[]>`
      insert into users (tenant_id, full_name) values (${store.tenantId}, 'كاشير بلا صلاحية') returning id`;
    await ownerDb()`insert into user_roles (tenant_id, user_id, role_id) values (${store.tenantId}, ${user!.id}, ${role!.id})`;
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/device/waste',
      headers: { authorization: store.device.authorization },
      payload: { id: wasteId(4), actorId: user!.id, reason: 'عينة', lines: [{ variantId: milk, qty: 1000 }] },
    });
    expect(denied.statusCode).toBe(403);
    expect(await levelOf(milk)).toBe(10_000);
  });

  it('an admin waste with a reason on its line, and an old one with only «هدر» in its note, both reach the report', async () => {
    const { store, milk, rice } = await world();
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/v1/stocktakes', headers: as(store), payload });
    expect(
      (
        await post({
          date: '2026-10-30',
          note: 'هدر',
          lines: [{ variantId: milk, countedQty: 9000, wasteReason: 'عينة' }],
        })
      ).statusCode,
    ).toBe(201);
    // before reasons existed: no reason on the line, «هدر» in the note
    expect(
      (await post({ date: '2026-10-30', note: 'هدر', lines: [{ variantId: rice, countedQty: 9000 }] }))
        .statusCode,
    ).toBe(201);
    // a plain count that finds less is not a waste
    expect(
      (await post({ date: '2026-10-30', note: 'جرد', lines: [{ variantId: rice, countedQty: 8000 }] }))
        .statusCode,
    ).toBe(201);
    const report = (
      await app.inject({
        method: 'GET',
        url: '/v1/reports/waste?from=2026-10-01&to=2026-10-31',
        headers: as(store),
      })
    ).json<WasteReport>();
    expect(report.byReason.map((r) => r.reason).sort()).toEqual(['بلا سبب', 'عينة'].sort());
    expect(report.rows).toHaveLength(2);
    expect(report.totalCostMinor).toBe(40_000 + 20_000);
  });
});

describe('the phone count', () => {
  it('the sheet carries the barcodes and can be narrowed to a category', async () => {
    const { store, milk, rice, categoryId } = await world();
    const all = await app.inject({ method: 'GET', url: '/v1/inventory/count-sheet', headers: as(store) });
    expect(all.statusCode, all.body).toBe(200);
    const sheet = all.json<CountSheet>();
    expect(sheet.items.map((i) => i.variantId).sort()).toEqual([milk, rice].sort());
    expect(sheet.items.find((i) => i.variantId === milk)).toMatchObject({
      qty: 10_000,
      categoryId,
      barcodes: [{ code: '6281000000011', packQty: 1000 }],
    });
    const part = (
      await app.inject({
        method: 'GET',
        url: `/v1/inventory/count-sheet?categoryId=${categoryId}`,
        headers: as(store),
      })
    ).json<CountSheet>();
    expect(part.items.map((i) => i.variantId)).toEqual([milk]);
    expect(part.categoryId).toBe(categoryId);
  });

  it('a count posted twice by its own id is one count; a partial count touches only its lines', async () => {
    const { store, milk, rice } = await world();
    const payload = {
      id: wasteId(9),
      date: '2026-10-30',
      note: 'جرد الهاتف',
      lines: [{ variantId: milk, countedQty: 9000 }],
    };
    const a = await app.inject({ method: 'POST', url: '/v1/stocktakes', headers: as(store), payload });
    const b = await app.inject({ method: 'POST', url: '/v1/stocktakes', headers: as(store), payload });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json<StocktakeDetail>().number).toBe(a.json<StocktakeDetail>().number);
    expect(await levelOf(milk)).toBe(9000);
    expect(await levelOf(rice)).toBe(10_000);
    const [n] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from stocktakes`;
    expect(n!.n).toBe(1);
  });

  it('the sheet needs a signed-in user', async () => {
    const none = await app.inject({ method: 'GET', url: '/v1/inventory/count-sheet' });
    expect(none.statusCode).toBe(401);
  });
});
