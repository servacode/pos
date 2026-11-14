import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OnlineOrder,
  OnlineStoreSettings,
  ProductDetail,
  ShopHome,
  ShopOrderPlaced,
  ShopProduct,
  SupplierRow,
} from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';

/**
 * The online shop, first step (26 › المتجر الإلكتروني): the store's link shows what is on the shelf
 * with its pictures and prices, and an order saved at the server's prices opens WhatsApp.
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

const SETTINGS = {
  version: null,
  enabled: true,
  slug: 'nour-fashion',
  whatsapp: '0933123456',
  delivery: true,
  pickup: true,
  note: 'التوصيل داخل المدينة خلال يوم',
  showOutOfStock: false,
};

async function openShop(store: Store, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/online-store',
    headers: as(store),
    payload: { ...SETTINGS, ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<OnlineStoreSettings>();
}

/** A shirt in M and L (L on the shelf, M not), and a scarf with nothing on the shelf */
async function goods(store: Store) {
  const create = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: '/v1/products', headers: as(store), payload });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ProductDetail>();
  };
  const shirt = await create({
    nameAr: 'قميص كتان',
    variants: ['M', 'L'].map((size) => ({
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: 'أبيض' },
      ],
      price: { currency: 'SYP', priceMinor: size === 'L' ? 460_000 : 450_000 },
    })),
  });
  const scarf = await create({
    nameAr: 'شال',
    variants: [{ price: { currency: 'SYP', priceMinor: 100_000 } }],
  });
  const supplier = (
    await app.inject({ method: 'POST', url: '/v1/suppliers', headers: as(store), payload: { name: 'معمل' } })
  ).json<SupplierRow>();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: as(store),
    payload: {
      supplierId: supplier.id,
      date: '2026-10-29',
      payment: 'credit',
      lines: [{ variantId: shirt.variants[1]!.id, qty: 5000, costMinor: 1_000_000 }],
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7]).toString('base64');
  const image = await app.inject({
    method: 'POST',
    url: `/v1/products/${shirt.id}/images`,
    headers: as(store),
    payload: { contentType: 'image/jpeg', data: jpeg, thumb: jpeg, width: 10, height: 10 },
  });
  expect(image.statusCode, image.body).toBe(201);
  return { shirt, scarf, m: shirt.variants[0]!.id, l: shirt.variants[1]!.id };
}

const order = (
  slug: string,
  lines: { variantId: string; qty: number }[],
  extra: Record<string, unknown> = {},
) =>
  app.inject({
    method: 'POST',
    url: `/v1/shop/${slug}/orders`,
    payload: {
      name: 'ريم',
      phone: '0944555666',
      fulfilment: 'delivery',
      address: 'المزة، جانب الجامع',
      note: null,
      lines,
      ...extra,
    },
  });

describe('the online shop', () => {
  it('is off and unknown until the owner turns it on with a free link and a WhatsApp number', async () => {
    const store = await openStore(app);
    const first = await app.inject({ method: 'GET', url: '/v1/online-store', headers: as(store) });
    expect(first.json<OnlineStoreSettings>()).toMatchObject({ version: null, enabled: false });
    expect((await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).statusCode).toBe(404);
    const noNumber = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: as(store),
      payload: { ...SETTINGS, whatsapp: null },
    });
    expect(noNumber.json()).toMatchObject({ error: { fields: { whatsapp: expect.any(String) } } });
    const badSlug = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: as(store),
      payload: { ...SETTINGS, slug: 'نور' },
    });
    expect(badSlug.statusCode).toBe(400);
    const saved = await openShop(store);
    expect(saved).toMatchObject({
      version: 1,
      enabled: true,
      slug: 'nour-fashion',
      whatsapp: '+963933123456',
    });

    // Another store cannot take the same link
    const other = await openStore(app, '0944000002');
    const taken = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: as(other),
      payload: { ...SETTINGS, slug: 'NOUR-fashion' },
    });
    expect(taken.json()).toMatchObject({ error: { fields: { slug: 'هذا الرابط لمحل آخر، اختر غيره' } } });

    // Off again: the link is gone
    await openShop(store, { version: 1, enabled: false });
    expect((await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).statusCode).toBe(404);
  });

  it('shows what is on the shelf with its picture, sizes and prices, and nothing a customer should not see', async () => {
    const store = await openStore(app);
    const { shirt, m, l } = await goods(store);
    await openShop(store);
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store).toMatchObject({ name: expect.any(String), whatsapp: '963933123456', currency: 'SYP' });
    // The scarf has nothing on the shelf: not shown
    expect(home.products).toEqual([
      {
        id: shirt.id,
        name: 'قميص كتان',
        categoryId: null,
        imageUrl: expect.stringMatching(/^\/v1\/images\/.+\?size=thumb$/),
        currency: 'SYP',
        priceMinor: 450_000,
        maxPriceMinor: 460_000,
        wasPriceMinor: null,
        offer: null,
        available: true,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        options: [
          { name: 'المقاس', values: ['L'] },
          { name: 'اللون', values: ['أبيض'] },
        ],
      },
    ]);
    expect(JSON.stringify(home)).not.toMatch(/cost|qty|stock|phone/i);

    const page = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${shirt.id}` })
    ).json<ShopProduct>();
    // M is not on the shelf, so only L is offered
    expect(page.variants.map((v) => [v.id, v.priceMinor, v.available])).toEqual([[l, 460_000, true]]);
    expect(page.options).toEqual([
      { name: 'المقاس', values: ['L'] },
      { name: 'اللون', values: ['أبيض'] },
    ]);
    expect(page.images).toHaveLength(1);
    expect(page.variants.some((v) => v.id === m)).toBe(false);

    // With «show what ran out», M shows as not available
    await openShop(store, { version: 1, showOutOfStock: true });
    const all = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${shirt.id}` })
    ).json<ShopProduct>();
    expect(all.variants.map((v) => [v.id, v.available])).toEqual([
      [m, false],
      [l, true],
    ]);
  });

  it('saves an order at the server’s prices, writes it for WhatsApp, and the shop follows it', async () => {
    const store = await openStore(app);
    const { l, m } = await goods(store);
    await openShop(store);
    // A price typed by the customer is never read: only the piece and how many
    const res = await order('nour-fashion', [
      { variantId: l, qty: 2 },
      { variantId: l, qty: 1 },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const placed = res.json<ShopOrderPlaced>();
    expect(placed).toMatchObject({ number: 'ONL-000001', totalMinor: 1_380_000, currency: 'SYP' });
    expect(placed.message).toContain('ONL-000001');
    expect(placed.message).toContain('قميص كتان (L · أبيض) × 3');
    expect(placed.message).toContain('التوصيل إلى: المزة، جانب الجامع');
    expect(placed.whatsappUrl).toMatch(/^https:\/\/wa\.me\/963933123456\?text=/);
    expect(decodeURIComponent(placed.whatsappUrl!.split('text=')[1]!)).toBe(placed.message);

    // What ran out cannot be ordered; delivery needs an address
    const gone = await order('nour-fashion', [{ variantId: m, qty: 1 }]);
    expect(gone.json()).toMatchObject({
      error: { fields: { 'lines.0': expect.stringContaining('لم تعد متوفرة') } },
    });
    expect((await order('nour-fashion', [{ variantId: l, qty: 1 }], { address: null })).statusCode).toBe(400);
    expect((await order('nour-fashion', [], {})).statusCode).toBe(400);

    const second = (
      await order('nour-fashion', [{ variantId: l, qty: 1 }], { fulfilment: 'pickup' })
    ).json<ShopOrderPlaced>();
    expect(second.number).toBe('ONL-000002');
    expect(second.message).toContain('الاستلام من المحل');

    const box = await app.inject({
      method: 'GET',
      url: '/v1/online-orders?status=pending',
      headers: as(store),
    });
    const items = box.json<{ items: OnlineOrder[] }>().items;
    expect(items.map((o) => o.number)).toEqual(['ONL-000002', 'ONL-000001']);
    const first = items[1]!;
    expect(first).toMatchObject({
      customerName: 'ريم',
      phone: '+963944555666',
      fulfilment: 'delivery',
      status: 'pending',
    });

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${first.id}/status`,
      headers: as(store),
      payload: { status: 'accepted', version: first.version },
    });
    expect(accepted.json<OnlineOrder>()).toMatchObject({ status: 'accepted', decidedAt: expect.any(String) });
    const backwards = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${first.id}/status`,
      headers: as(store),
      payload: { status: 'accepted', version: accepted.json<OnlineOrder>().version },
    });
    expect(backwards.statusCode).toBe(400);
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${first.id}/status`,
      headers: as(store),
      payload: { status: 'done', version: first.version },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('keeps each store’s shop and orders to itself', async () => {
    const a = await openStore(app);
    const { shirt, l } = await goods(a);
    await openShop(a);
    const b = await openStore(app, '0944000002');
    await openShop(b, { slug: 'other-shop' });
    // A's product and pieces are not on B's link
    expect(
      (await app.inject({ method: 'GET', url: `/v1/shop/other-shop/products/${shirt.id}` })).statusCode,
    ).toBe(404);
    expect((await order('other-shop', [{ variantId: l, qty: 1 }])).statusCode).toBe(400);
    const placed = (await order('nour-fashion', [{ variantId: l, qty: 1 }])).json<ShopOrderPlaced>();
    expect(placed.number).toBe('ONL-000001');
    const theirs = await app.inject({ method: 'GET', url: '/v1/online-orders', headers: as(b) });
    expect(theirs.json<{ items: OnlineOrder[] }>().items).toEqual([]);
    const mine = (await app.inject({ method: 'GET', url: '/v1/online-orders', headers: as(a) })).json<{
      items: OnlineOrder[];
    }>();
    const steal = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${mine.items[0]!.id}/status`,
      headers: as(b),
      payload: { status: 'rejected', version: mine.items[0]!.version },
    });
    expect(steal.statusCode).toBe(404);
  });

  it('shows a markdown and a running percent offer struck through, and orders at the offer price', async () => {
    const store = await openStore(app);
    const { shirt, l } = await goods(store);
    await openShop(store);
    // 20% off everything while it runs
    const promo = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: as(store),
      payload: { name: 'تنزيلات الشتاء', kind: 'percent', percentBp: 2000, scope: 'all' },
    });
    expect(promo.statusCode, promo.body).toBe(201);
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.products[0]).toMatchObject({
      priceMinor: 360_000,
      wasPriceMinor: 450_000,
      offer: 'تنزيلات الشتاء',
    });
    const page = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${shirt.id}` })
    ).json<ShopProduct>();
    expect(page.offer).toBe('تنزيلات الشتاء');
    expect(page.variants.map((v) => [v.priceMinor, v.wasPriceMinor])).toEqual([[368_000, 460_000]]);
    // The order is priced as the shop showed it
    const res = await order('nour-fashion', [{ variantId: l, qty: 1 }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<ShopOrderPlaced>().totalMinor).toBe(368_000);
  });

  it('adds the courier’s fee to a delivered order: flat, or by the area the customer picks', async () => {
    const store = await openStore(app);
    const { l } = await goods(store);
    await openShop(store, { deliveryFeeMinor: 5_000 });
    let home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store).toMatchObject({ deliveryFeeMinor: 5_000, deliveryAreas: [] });
    const flat = (await order('nour-fashion', [{ variantId: l, qty: 1 }])).json<ShopOrderPlaced>();
    expect([flat.totalMinor, flat.deliveryFeeMinor]).toEqual([460_000, 5_000]);
    expect(flat.message).toContain('أجرة التوصيل');
    expect(flat.message).toContain('الإجمالي');
    // Picked up: no fee
    const pickup = (
      await order('nour-fashion', [{ variantId: l, qty: 1 }], { fulfilment: 'pickup', address: null })
    ).json<ShopOrderPlaced>();
    expect(pickup.deliveryFeeMinor).toBe(0);

    // By area
    await openShop(store, {
      version: 1,
      deliveryAreas: [
        { name: 'المزة', feeMinor: 5_000 },
        { name: 'دمر', feeMinor: 10_000 },
      ],
    });
    home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store.deliveryAreas).toHaveLength(2);
    const noArea = await order('nour-fashion', [{ variantId: l, qty: 1 }]);
    expect(noArea.json()).toMatchObject({ error: { fields: { area: expect.any(String) } } });
    const far = (
      await order('nour-fashion', [{ variantId: l, qty: 1 }], { area: 'دمر' })
    ).json<ShopOrderPlaced>();
    expect(far.deliveryFeeMinor).toBe(10_000);
    const box = (await app.inject({ method: 'GET', url: '/v1/online-orders', headers: as(store) })).json<{
      items: OnlineOrder[];
    }>();
    expect(box.items[0]).toMatchObject({ deliveryFeeMinor: 10_000, deliveryArea: 'دمر' });
  });
});
