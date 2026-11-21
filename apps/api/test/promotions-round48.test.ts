import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Promotion, PromotionPreview, PromotionReport } from '@serva/core';
import { createUuidV7 } from '@serva/sync';
import { seedCatalog } from './catalog-fixtures';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/** Round 48: restarting an offer, a stopped offer's code, the promotion report and the scope preview. */

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
  return {
    tenantId: body.tenant.id as string,
    token: body.accessToken as string,
    headers: { authorization: `Bearer ${body.accessToken}` },
  };
}

const base = { kind: 'percent', percentBp: 1000, scope: 'all' } as const;

describe('promotions, round 48', () => {
  it('refuses to restart an old offer that carries a code and an audience, and says why', async () => {
    const s = await store();
    // Made stopped on purpose: the contract lets a stopped row keep both
    const made = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: s.headers,
      payload: { ...base, name: 'قديم', couponCode: 'OLD10', repOnly: true, archived: true },
    });
    expect(made.statusCode, made.body).toBe(201);
    const promo = made.json<Promotion>();
    const restart = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${promo.id}/archive`,
      headers: s.headers,
      payload: { version: promo.version, archived: false },
    });
    expect(restart.statusCode).toBe(400);
    expect(restart.json()).toMatchObject({
      error: { fields: { couponCode: expect.stringContaining('الكود') } },
    });
    const list = await app.inject({ method: 'GET', url: '/v1/promotions', headers: s.headers });
    expect(list.json<{ items: Promotion[] }>().items[0]!.archived).toBe(true);
  });

  it('a stopped offer frees its code; restarting the old one then says the code is taken', async () => {
    const s = await store();
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/v1/promotions', headers: s.headers, payload });
    const first = (await post({ ...base, name: 'صيف', couponCode: 'SUMMER10' })).json<Promotion>();
    expect((await post({ ...base, name: 'صيف ثان', couponCode: 'summer10' })).statusCode).toBe(400);
    const stop = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${first.id}/archive`,
      headers: s.headers,
      payload: { version: first.version, archived: true },
    });
    expect(stop.statusCode, stop.body).toBe(200);
    const second = await post({ ...base, name: 'صيف ثان', couponCode: 'summer10' });
    expect(second.statusCode, second.body).toBe(201);
    const stopped = stop.json<Promotion>();
    const again = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${first.id}/archive`,
      headers: s.headers,
      payload: { version: stopped.version, archived: false },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({
      error: { fields: { couponCode: 'هذا الكود لعرض آخر، اختر غيره' } },
    });
  });

  it('reports what each offer did at the tills in a period', async () => {
    const s = await store();
    const device = await createDevice(s.tenantId);
    const [user] = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${s.tenantId}`;
    const line = (qty: number, gross: number, off: number, source: string, reason: string) => ({
      qty,
      discount: { type: 'amount', minor: off, source, reason, approval: null },
      priced: { grossMinor: gross, lineDiscountMinor: off, netMinor: gross - off },
    });
    const db = ownerDb();
    const insert = (n: string, date: string, lines: unknown[]) =>
      db`insert into invoices (tenant_id, id, branch_id, device_id, number, business_date,
          device_time, shift_id, cashier_id, currency, tax_inclusive, gross_minor, discount_minor, tax_minor,
          total_minor, tip_minor, payload)
        values (${s.tenantId}, ${createUuidV7()()}, ${device.branchId}, ${device.deviceId}, ${n},
          ${date}, now(), ${createUuidV7()()}, ${user!.id}, 'SYP', true, 100, 0, 0, 100, 0,
          ${db.json({ lines } as never)})`;
    await insert('INV-1', '2026-11-10', [
      line(2000, 20_000, 2_000, 'promotion', 'خصم الشتاء'),
      line(1000, 5_000, 500, 'manual', 'خصم المدير'),
    ]);
    await insert('INV-2', '2026-11-11', [
      line(1000, 10_000, 1_000, 'promotion', 'خصم الشتاء'),
      line(1000, 0, 0, 'promotion', 'اشترِ 2 وخذ 1'),
    ]);
    await insert('INV-3', '2026-09-01', [line(1000, 10_000, 1_000, 'promotion', 'خصم الشتاء')]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/promotions/report?from=2026-11-01&to=2026-11-30',
      headers: s.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { items } = res.json<PromotionReport>();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'خصم الشتاء',
      currency: 'SYP',
      invoices: 2,
      pieces: 3,
      discountMinor: 3_000,
      netMinor: 27_000,
      freePieces: 0,
    });
    expect(items[1]).toMatchObject({ name: 'اشترِ 2 وخذ 1', pieces: 1, freePieces: 1, discountMinor: 0 });
    const bad = await app.inject({ method: 'GET', url: '/v1/promotions/report?from=x', headers: s.headers });
    expect(bad.statusCode).toBe(400);
    const anon = await app.inject({
      method: 'GET',
      url: '/v1/promotions/report?from=2026-11-01&to=2026-11-30',
    });
    expect(anon.statusCode).toBe(401);
  });

  it('counts the products an offer reaches before it is saved', async () => {
    const s = await store();
    const { products } = await seedCatalog(app, s.tenantId, s.token);
    const ask = (payload: Record<string, unknown>) =>
      app
        .inject({ method: 'POST', url: '/v1/promotions/preview', headers: s.headers, payload })
        .then((r) => ({ status: r.statusCode, body: r.json<PromotionPreview>() }));
    const all = await ask({ scope: 'all' });
    expect(all.status).toBe(200);
    expect(all.body.products).toBeGreaterThan(0);
    expect(all.body.sample.length).toBeLessThanOrEqual(3);
    const one = await ask({ scope: 'products', productIds: [products[0]!.id] });
    expect(one.body.products).toBe(1);
    const cat = await ask({ scope: 'categories', categoryIds: [products[0]!.categoryId] });
    expect(cat.body.products).toBeGreaterThanOrEqual(1);
    expect((await ask({ scope: 'products', productIds: [] })).body.products).toBe(0);
  });
});
