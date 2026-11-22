import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  Promotion,
  PromotionReport,
  ProductDetail,
  ShopHome,
  ShopOrderPlaced,
  SupplierRow,
} from '@serva/core';
import { createUuidV7 } from '@serva/sync';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/** Round 52: free delivery over an amount, ending/removing offers from the list, the catalogue cache dropped on save, the report's latest name. */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  delete process.env['SHOP_CATALOGUE_KEEP_MS'];
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

async function store() {
  const { body } = await registerStore(app, { phone: '0912345678' });
  return {
    tenantId: body.tenant.id as string,
    headers: { authorization: `Bearer ${body.accessToken as string}` },
  };
}
type S = Awaited<ReturnType<typeof store>>;

const saveShop = (s: S, version: number | null, extra: Record<string, unknown>) =>
  app.inject({
    method: 'PUT',
    url: '/v1/online-store',
    headers: s.headers,
    payload: {
      version,
      enabled: true,
      slug: 'nour-fashion',
      whatsapp: '0933123456',
      delivery: true,
      pickup: true,
      note: null,
      showOutOfStock: false,
      orderMode: 'whatsapp',
      ...extra,
    },
  });

async function dress(s: S) {
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: s.headers,
      payload: { nameAr: 'فستان', variants: [{ price: { currency: 'SYP', priceMinor: 900_000 } }] },
    })
  ).json<ProductDetail>();
  const supplier = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: s.headers, payload: { name: 'معمل' } })
  ).json<SupplierRow>();
  const bought = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: s.headers,
    payload: {
      supplierId: supplier.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId: product.variants[0]!.id, qty: 10_000, costMinor: 500_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return product.variants[0]!.id;
}

const order = (variantId: string, qty: number, fulfilment: 'delivery' | 'pickup') =>
  app.inject({
    method: 'POST',
    url: '/v1/shop/nour-fashion/orders',
    payload: {
      name: 'ريم',
      phone: '0944555666',
      fulfilment,
      address: fulfilment === 'delivery' ? 'المزة' : null,
      note: null,
      lines: [{ variantId, qty }],
    },
  });

const offer = (extra: Record<string, unknown> = {}) => ({
  name: 'خصم الشتاء',
  kind: 'percent',
  percentBp: 1000,
  scope: 'all',
  ...extra,
});

describe('promotions and shop, round 52', () => {
  it('free delivery over an amount: below it the courier fee stays, at or above it the fee is gone', async () => {
    const s = await store();
    const variantId = await dress(s);
    const saved = await saveShop(s, null, { deliveryFeeMinor: 10_000, freeDeliveryOverMinor: 1_000_000 });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().freeDeliveryOverMinor).toBe(1_000_000);
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store.freeDeliveryOverMinor).toBe(1_000_000);

    const below = await order(variantId, 1, 'delivery');
    expect(below.statusCode, below.body).toBe(201);
    expect(below.json<ShopOrderPlaced>().deliveryFeeMinor).toBe(10_000);
    const above = await order(variantId, 2, 'delivery');
    expect(above.statusCode, above.body).toBe(201);
    expect(above.json<ShopOrderPlaced>().deliveryFeeMinor).toBe(0);
    // Pickup never carries a fee, and zero is refused as «no offer»
    const pickup = await order(variantId, 2, 'pickup');
    expect(pickup.json<ShopOrderPlaced>().deliveryFeeMinor).toBe(0);
    const version = saved.json().version as number;
    const zero = await saveShop(s, version, { freeDeliveryOverMinor: 0 });
    expect(zero.statusCode).toBe(400);
    const cleared = await saveShop(s, version, { deliveryFeeMinor: 10_000, freeDeliveryOverMinor: null });
    expect(cleared.json().freeDeliveryOverMinor).toBeNull();
    const again = await order(variantId, 3, 'delivery');
    expect(again.json<ShopOrderPlaced>().deliveryFeeMinor).toBe(10_000);
  });

  it('moves the end date from the list, refuses an end before the start, and archives (never deletes) a stopped offer', async () => {
    const s = await store();
    const made = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: s.headers,
      payload: offer({ startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z' }),
    });
    expect(made.statusCode, made.body).toBe(201);
    const p = made.json<Promotion>();
    const early = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${p.id}/end-date`,
      headers: s.headers,
      payload: { version: p.version, endsAt: '2026-10-30T00:00:00.000Z' },
    });
    expect(early.statusCode).toBe(400);
    const moved = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${p.id}/end-date`,
      headers: s.headers,
      payload: { version: p.version, endsAt: '2026-12-31T00:00:00.000Z' },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<Promotion>().endsAt).toBe('2026-12-31T00:00:00.000Z');
    expect(moved.json<Promotion>().name).toBe('خصم الشتاء');
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${p.id}/end-date`,
      headers: s.headers,
      payload: { version: p.version, endsAt: null },
    });
    expect(stale.statusCode).toBe(409);

    const v2 = moved.json<Promotion>().version;
    // There is no delete route: history is kept, a stopped offer is only archived
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/promotions/${p.id}?version=${v2}`,
      headers: s.headers,
    });
    expect(del.statusCode).toBe(404);
    const stopped = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${p.id}/archive`,
      headers: s.headers,
      payload: { version: v2, archived: true },
    });
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json<Promotion>().archived).toBe(true);
    expect(stopped.json<Promotion>().version).toBeGreaterThan(v2);
    // The row stays (the tills drop it at the next pull by its archived flag), and the change is audited
    const list = await app.inject({ method: 'GET', url: '/v1/promotions', headers: s.headers });
    const kept = list.json<{ items: Promotion[] }>().items;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.archived).toBe(true);
    const [audited] = await ownerDb()<{ n: string }[]>`
      select count(*)::text as n from audit_logs where action = 'promotion.update' and tenant_id = ${s.tenantId}`;
    expect(audited!.n).toBe('2'); // the new end date, then the archive
  });

  it('an owner save drops the kept catalogue at once', async () => {
    process.env['SHOP_CATALOGUE_KEEP_MS'] = '30000';
    const s = await store();
    const saved = await saveShop(s, null, { tagline: 'قبل' });
    const read = async () =>
      (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>().store.tagline;
    expect(await read()).toBe('قبل');
    // A change that does not go through the dashboard is not seen: the answer is kept
    await ownerDb()`update online_stores set tagline = 'مباشرة' where tenant_id = ${s.tenantId}`;
    expect(await read()).toBe('قبل');
    // A save through the dashboard drops it
    const [row] = await ownerDb()<
      { version: number }[]
    >`select version from online_stores where tenant_id = ${s.tenantId}`;
    expect(saved.statusCode).toBe(200);
    const next = await saveShop(s, row!.version, { tagline: 'بعد' });
    expect(next.statusCode, next.body).toBe(200);
    expect(await read()).toBe('بعد');
    // A new offer drops it too
    await ownerDb()`update online_stores set tagline = 'ثالث' where tenant_id = ${s.tenantId}`;
    expect(await read()).toBe('بعد');
    await app.inject({ method: 'POST', url: '/v1/promotions', headers: s.headers, payload: offer() });
    expect(await read()).toBe('ثالث');
  });

  it('names an offer by its latest invoice, not by the alphabet', async () => {
    const s = await store();
    const device = await createDevice(s.tenantId);
    const db = ownerDb();
    const [user] = await db<{ id: string }[]>`select id from users where tenant_id = ${s.tenantId}`;
    const offerId = createUuidV7()();
    const sale = (n: string, date: string, reason: string) =>
      db`insert into invoices (tenant_id, id, branch_id, device_id, number, business_date,
          device_time, shift_id, cashier_id, currency, tax_inclusive, gross_minor, discount_minor, tax_minor,
          total_minor, tip_minor, payload)
        values (${s.tenantId}, ${createUuidV7()()}, ${device.branchId}, ${device.deviceId}, ${n},
          ${date}, now(), ${createUuidV7()()}, ${user!.id}, 'SYP', true, 100, 0, 0, 100, 0,
          ${db.json({
            lines: [
              {
                lineNo: 1,
                qty: 1000,
                discount: {
                  type: 'amount',
                  minor: 100,
                  source: 'promotion',
                  reason,
                  approval: null,
                  promotionId: offerId,
                },
                priced: { grossMinor: 1000, lineDiscountMinor: 100, netMinor: 900 },
              },
            ],
          } as never)})`;
    // «ألف» is on the later invoice, «باء» on the earlier one: the later one wins although it sorts first
    await sale('INV-1', '2026-11-05', 'باء');
    await sale('INV-2', '2026-11-12', 'ألف');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/promotions/report?from=2026-11-01&to=2026-11-30',
      headers: s.headers,
    });
    expect(res.json<PromotionReport>().items).toHaveLength(1);
    expect(res.json<PromotionReport>().items[0]!.name).toBe('ألف');
  });
});
