import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Promotion, PullSetRows, StoreResponse } from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { seedCatalog } from './catalog-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase, settled } from './helpers';

/**
 * The supermarket mode on the server: promotions the owner sets and every till pulls, and how the
 * store's scales print their labels (packages/core › promotions.ts, scale.ts).
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

async function store(phone = '0912345678') {
  const { body } = await registerStore(app, { phone });
  const headers = { authorization: `Bearer ${body.accessToken}` };
  return { tenantId: body.tenant.id as string, token: body.accessToken as string, headers };
}

async function pull(tenantId: string) {
  await settled();
  const device = await createDevice(tenantId);
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: device.authorization },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PullResponse>().sets as unknown as {
    [K in keyof PullSetRows]: { upserts: PullSetRows[K][] };
  };
}

describe('promotions', () => {
  it('adds a category promotion, keeps only the fields its kind uses, and every till pulls it', async () => {
    const s = await store();
    const { products } = await seedCatalog(app, s.tenantId, s.token);
    const categoryId = products[0]!.categoryId!;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: s.headers,
      payload: {
        name: 'خصم المشروبات',
        kind: 'percent',
        percentBp: 1500,
        buyQty: 3,
        scope: 'categories',
        categoryIds: [categoryId, categoryId],
        productIds: [products[0]!.id],
        daysOfWeek: [5, 4, 5],
        fromTime: '18:00',
        toTime: '22:00',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const promo = res.json<Promotion>();
    expect(promo).toMatchObject({
      kind: 'percent',
      percentBp: 1500,
      buyQty: null,
      getQty: null,
      categoryIds: [categoryId],
      productIds: [],
      daysOfWeek: [4, 5],
      archived: false,
      version: 1,
    });
    const sets = await pull(s.tenantId);
    expect(sets.promotions.upserts).toEqual([
      expect.objectContaining({ id: promo.id, name: 'خصم المشروبات', fromTime: '18:00', toTime: '22:00' }),
    ]);
  });

  it('refuses what cannot run: no percent, no target, a window with one end, another store’s category', async () => {
    const s = await store();
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/v1/promotions', headers: s.headers, payload });
    const bad = [
      { name: 'بلا نسبة', kind: 'percent', scope: 'all' },
      { name: 'بلا عدد', kind: 'buy_get', buyQty: 2, scope: 'all' },
      { name: 'بلا تصنيف', kind: 'percent', percentBp: 100, scope: 'categories' },
      { name: 'بلا منتج', kind: 'percent', percentBp: 100, scope: 'products' },
      { name: 'نصف وقت', kind: 'percent', percentBp: 100, scope: 'all', fromTime: '10:00' },
      {
        name: 'مقلوب',
        kind: 'percent',
        percentBp: 100,
        scope: 'all',
        startsAt: '2026-11-10T00:00:00Z',
        endsAt: '2026-11-01T00:00:00Z',
      },
    ];
    for (const payload of bad) expect((await post(payload)).statusCode, payload.name).toBe(400);

    const other = await store('0911111111');
    const { products } = await seedCatalog(app, other.tenantId, other.token);
    const foreign = await post({
      name: 'تصنيف غريب',
      kind: 'percent',
      percentBp: 100,
      scope: 'categories',
      categoryIds: [products[0]!.categoryId],
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json()).toMatchObject({ error: { fields: { categoryIds: 'تصنيف غير موجود' } } });
    const product = await post({
      name: 'منتج غريب',
      kind: 'buy_get',
      buyQty: 2,
      getQty: 1,
      scope: 'products',
      productIds: [products[0]!.id],
    });
    expect(product.json()).toMatchObject({ error: { fields: { productIds: 'منتج غير موجود' } } });
  });

  it('stops a promotion with archived, refuses a stale version, and writes the audit trail', async () => {
    const s = await store();
    const made = (
      await app.inject({
        method: 'POST',
        url: '/v1/promotions',
        headers: s.headers,
        payload: { name: 'اشترِ 2 والثالث مجاناً', kind: 'buy_get', buyQty: 2, getQty: 1, scope: 'all' },
      })
    ).json<Promotion>();
    const put = (version: number, archived: boolean) =>
      app.inject({
        method: 'PUT',
        url: `/v1/promotions/${made.id}`,
        headers: s.headers,
        payload: { version, name: made.name, kind: 'buy_get', buyQty: 2, getQty: 1, scope: 'all', archived },
      });
    const stopped = await put(1, true);
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json<Promotion>()).toMatchObject({ archived: true, version: 2 });
    expect((await put(1, false)).statusCode).toBe(409);
    const again = await put(2, true);
    expect(again.json<Promotion>().version).toBe(3);

    const list = await app.inject({ method: 'GET', url: '/v1/promotions', headers: s.headers });
    expect(list.json<{ items: Promotion[] }>().items).toEqual([
      expect.objectContaining({ id: made.id, archived: true }),
    ]);
    const logs = await ownerDb()<{ action: string; changes: Record<string, unknown> }[]>`
      select action, changes from audit_logs where entity = 'promotion' order by created_at, id`;
    expect(logs.map((l) => l.action)).toEqual(['promotion.create', 'promotion.update', 'promotion.update']);
    expect(logs[1]!.changes).toEqual({ archived: [false, true] });
    expect(logs[2]!.changes).toEqual({});

    const missing = await app.inject({
      method: 'PUT',
      url: '/v1/promotions/not-an-id',
      headers: s.headers,
      payload: { version: 1, name: 'x x', kind: 'percent', percentBp: 1, scope: 'all' },
    });
    expect(missing.statusCode).toBe(404);
    const unknown = await app.inject({
      method: 'PUT',
      url: '/v1/promotions/0192a000-0000-7000-8000-000000000001',
      headers: s.headers,
      payload: { version: 1, name: 'x x', kind: 'percent', percentBp: 1, scope: 'all' },
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('scale labels', () => {
  it('the owner sets them, the till pulls them, and turning them off clears them', async () => {
    const s = await store();
    const before = await app.inject({ method: 'GET', url: '/v1/store', headers: s.headers });
    expect(before.json<StoreResponse>().scaleBarcode).toBeNull();
    const config = { prefixes: ['20', '21'], itemDigits: 5, valueKind: 'weight', valueDecimals: 3 };
    const set = await app.inject({
      method: 'PUT',
      url: '/v1/store/scale',
      headers: s.headers,
      payload: { scaleBarcode: config },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json<StoreResponse>().scaleBarcode).toEqual(config);
    const sets = await pull(s.tenantId);
    expect(sets.settings.upserts[0]!.scaleBarcode).toEqual(config);

    const internal = await app.inject({
      method: 'PUT',
      url: '/v1/store/scale',
      headers: s.headers,
      payload: { scaleBarcode: { ...config, prefixes: ['29'] } },
    });
    expect(internal.statusCode).toBe(400);

    const off = await app.inject({
      method: 'PUT',
      url: '/v1/store/scale',
      headers: s.headers,
      payload: { scaleBarcode: null },
    });
    expect(off.json<StoreResponse>().scaleBarcode).toBeNull();
    const [log] = await ownerDb()<{ changes: Record<string, unknown> }[]>`
      select changes from audit_logs where action = 'store.scale_update' order by created_at desc limit 1`;
    expect(log!.changes).toEqual({ scaleBarcode: [config, null] });
  });
});
