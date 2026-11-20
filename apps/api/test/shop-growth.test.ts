import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CodSummary,
  OnlineOrder,
  OnlineStoreSettings,
  PriceChange,
  ProductDetail,
  ProductTexts,
  ShopCoupon,
  ShopHome,
  ShopOrderPlaced,
  ShopOrderTrack,
  ShopProduct,
  StockAlert,
  SupplierRow,
} from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';
import { settled } from './helpers';
import { bearer, staffUser, testStore } from './staff';

/**
 * The shop's growth (26): the product's description, the delivery stage and the couriers' cash, the
 * coupon code, the store's look, «أبلغني عند التوفر» and the price-change history.
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
  note: null,
  showOutOfStock: true,
};

async function saveShop(store: Pick<Store, 'accessToken'>, extra: Record<string, unknown> = {}) {
  const current = await app.inject({ method: 'GET', url: '/v1/online-store', headers: as(store) });
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/online-store',
    headers: as(store),
    payload: { ...SETTINGS, version: current.json<OnlineStoreSettings>().version, ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<OnlineStoreSettings>();
}

/** A product with one piece priced 460,000; `stocked` pieces on the shelf */
async function item(store: Pick<Store, 'accessToken'>, name = 'قميص كتان', stocked = 5) {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: name,
      variants: [
        { attributes: [{ name: 'المقاس', value: 'L' }], price: { currency: 'SYP', priceMinor: 460_000 } },
      ],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const product = created.json<ProductDetail>();
  if (stocked > 0) {
    const supplier = (
      await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: as(store),
        payload: { name: `معمل ${name}` },
      })
    ).json<SupplierRow>();
    const bought = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: as(store),
      payload: {
        supplierId: supplier.id,
        date: '2026-10-29',
        payment: 'credit',
        lines: [{ variantId: product.variants[0]!.id, qty: stocked * 1000, costMinor: 1_000_000 }],
      },
    });
    expect(bought.statusCode, bought.body).toBe(201);
  }
  return { id: product.id, variant: product.variants[0]!.id, version: product.version };
}

const placeOrder = (variantId: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/shop/nour-fashion/orders',
    payload: {
      name: 'ريم',
      phone: '0944555666',
      fulfilment: 'delivery',
      address: 'المزة، شارع الجلاء',
      note: null,
      lines: [{ variantId, qty: 2 }],
      ...extra,
    },
  });

const hasMoney = (value: unknown) => /Minor":[1-9]/.test(JSON.stringify(value));

async function orders(store: Pick<Store, 'accessToken'>, status = 'all') {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/online-orders${status === 'all' ? '' : `?status=${status}`}`,
    headers: as(store),
  });
  return res.json<{ items: OnlineOrder[] }>().items;
}

async function accept(store: Pick<Store, 'accessToken'>) {
  const [o] = await orders(store, 'pending');
  const res = await app.inject({
    method: 'POST',
    url: `/v1/online-orders/${o!.id}/status`,
    headers: as(store),
    payload: { status: 'accepted', version: o!.version },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<OnlineOrder>();
}

const delivery = (
  store: Pick<Store, 'accessToken'>,
  o: Pick<OnlineOrder, 'id'>,
  payload: Record<string, unknown>,
) =>
  app.inject({
    method: 'POST',
    url: `/v1/online-orders/${o.id}/delivery`,
    headers: as(store),
    payload,
  });

describe('the product description and size guide', () => {
  it('is saved on the product page and shown, as plain text, on the shop page', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store);
    const empty = await app.inject({
      method: 'GET',
      url: `/v1/products/${p.id}/shop-text`,
      headers: as(store),
    });
    expect(empty.json<ProductTexts>()).toEqual({ description: null, sizeGuide: null });

    const saved = await app.inject({
      method: 'PUT',
      url: `/v1/products/${p.id}/shop-text`,
      headers: as(store),
      payload: {
        description: '  قميص كتان ناعم.\r\nيُغسل بالماء البارد  ',
        sizeGuide: 'S: 36\nM: 38<script>alert(1)</script>\u0007‮',
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<ProductTexts>()).toEqual({
      description: 'قميص كتان ناعم.\nيُغسل بالماء البارد',
      // Markup stays as typed text (the page shows text, never runs it); control and direction marks go
      sizeGuide: 'S: 36\nM: 38<script>alert(1)</script>',
    });

    const page = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${p.id}` })
    ).json<ShopProduct>();
    expect(page.description).toBe('قميص كتان ناعم.\nيُغسل بالماء البارد');
    expect(page.sizeGuide).toContain('<script>');

    // Blank clears it
    const cleared = await app.inject({
      method: 'PUT',
      url: `/v1/products/${p.id}/shop-text`,
      headers: as(store),
      payload: { description: '   ', sizeGuide: null },
    });
    expect(cleared.json<ProductTexts>()).toEqual({ description: null, sizeGuide: null });
    const bare = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${p.id}` })
    ).json<ShopProduct>();
    expect(bare).toMatchObject({ description: null, sizeGuide: null });
  });

  it('never makes the hidden prices leak, and is the owner’s to edit', async () => {
    const store = await testStore(app);
    const p = await item(store);
    await saveShop(store, { showPrices: false });
    await app.inject({
      method: 'PUT',
      url: `/v1/products/${p.id}/shop-text`,
      headers: as(store),
      payload: { description: 'وصف', sizeGuide: null },
    });
    const res = await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${p.id}` });
    expect(hasMoney(res.json())).toBe(false);

    const cashier = await staffUser(app, store, 'cashier', '0955000111');
    const denied = await app.inject({
      method: 'PUT',
      url: `/v1/products/${p.id}/shop-text`,
      headers: bearer(cashier.accessToken),
      payload: { description: 'x', sizeGuide: null },
    });
    expect(denied.statusCode).toBe(403);
    const missing = await app.inject({
      method: 'PUT',
      url: '/v1/products/00000000-0000-7000-8000-000000000000/shop-text',
      headers: as(store),
      payload: { description: 'x', sizeGuide: null },
    });
    expect(missing.statusCode).toBe(404);
    const long = await app.inject({
      method: 'PUT',
      url: `/v1/products/${p.id}/shop-text`,
      headers: as(store),
      payload: { description: 'x'.repeat(4001), sizeGuide: null },
    });
    expect(long.statusCode).toBe(400);
  });
});

describe('the delivery stage', () => {
  it('goes out with a courier then is delivered, shows on the tracking, and the courier owes the cash', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store, { deliveryFeeMinor: 10_000 });
    const placed = (await placeOrder(p.variant)).json<ShopOrderPlaced>();
    const token = placed.trackPath.split('/').pop()!;
    const track = () =>
      app
        .inject({ method: 'GET', url: `/v1/shop/nour-fashion/orders/${token}` })
        .then((r) => r.json<ShopOrderTrack>());

    // Not before the store accepted it
    const [pending] = await orders(store, 'pending');
    const early = await delivery(store, pending!, {
      stage: 'out',
      courier: 'أبو علي',
      version: pending!.version,
    });
    expect(early.statusCode).toBe(400);

    const accepted = await accept(store);
    expect((await track()).deliveryStage).toBeNull();
    const noName = await delivery(store, accepted, { stage: 'out', courier: ' ', version: accepted.version });
    expect(noName.statusCode).toBe(400);
    const skip = await delivery(store, accepted, { stage: 'delivered', version: accepted.version });
    expect(skip.statusCode).toBe(400);

    const out = await delivery(store, accepted, {
      stage: 'out',
      courier: 'أبو علي',
      version: accepted.version,
    });
    expect(out.statusCode, out.body).toBe(200);
    const outOrder = out.json<OnlineOrder>();
    expect(outOrder).toMatchObject({ status: 'accepted', deliveryStage: 'out', courierName: 'أبو علي' });
    expect(outOrder.outAt).not.toBeNull();
    expect((await track()).deliveryStage).toBe('out');
    // A second tap on the same version is the same action, said so
    const again = await delivery(store, accepted, {
      stage: 'out',
      courier: 'أبو علي',
      version: accepted.version,
    });
    expect(again.statusCode).toBe(409);

    // The cash expected per courier: the pieces and the courier's fee
    const cod = await app.inject({ method: 'GET', url: '/v1/online-orders/cod', headers: as(store) });
    expect(cod.json<CodSummary>()).toMatchObject({
      currency: 'SYP',
      couriers: [
        {
          courier: 'أبو علي',
          expectedMinor: 930_000,
          orders: [{ number: 'ONL-000001', collectMinor: 930_000, address: 'المزة، شارع الجلاء' }],
        },
      ],
    });

    const done = await delivery(store, outOrder, { stage: 'delivered', version: outOrder.version });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<OnlineOrder>()).toMatchObject({ deliveryStage: 'delivered', status: 'accepted' });
    expect((await track()).deliveryStage).toBe('delivered');
    const after = await app.inject({ method: 'GET', url: '/v1/online-orders/cod', headers: as(store) });
    expect(after.json<CodSummary>().couriers).toEqual([]);
  });

  it('is only for a delivery order, and only for those who see orders', async () => {
    const store = await testStore(app);
    const p = await item(store);
    await saveShop(store);
    await placeOrder(p.variant, { fulfilment: 'pickup', address: null });
    const accepted = await accept(store);
    const pickup = await delivery(store, accepted, {
      stage: 'out',
      courier: 'س',
      version: accepted.version,
    });
    expect(pickup.statusCode).toBe(400);
    const cashier = await staffUser(app, store, 'cashier', '0955000222');
    const denied = await app.inject({
      method: 'GET',
      url: '/v1/online-orders/cod',
      headers: bearer(cashier.accessToken),
    });
    expect([200, 403]).toContain(denied.statusCode);
    const noToken = await app.inject({ method: 'GET', url: '/v1/online-orders/cod' });
    expect(noToken.statusCode).toBe(401);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/online-orders/00000000-0000-7000-8000-000000000000/delivery',
      headers: as(store),
      payload: { stage: 'delivered', version: 1 },
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('coupon codes', () => {
  const coupon = (store: Pick<Store, 'accessToken'>, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: as(store),
      payload: {
        name: 'خصم الصيف',
        kind: 'percent',
        percentBp: 1000,
        scope: 'all',
        couponCode: 'summer10',
        ...extra,
      },
    });

  it('is kept once per store, in capitals, and never in the public prices', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store);
    const made = await coupon(store);
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json<{ couponCode: string }>().couponCode).toBe('SUMMER10');
    const dup = await coupon(store, { name: 'آخر', couponCode: 'Summer10' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json<{ error: { fields: Record<string, string> } }>().error.fields.couponCode).toBeTruthy();
    expect((await coupon(store, { couponCode: 'a b' })).statusCode).toBe(400);

    // The offer does not run by itself: nobody sees its price without the code
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.products[0]).toMatchObject({ priceMinor: 460_000, wasPriceMinor: null, offer: null });
    const page = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${p.id}` })
    ).json<ShopProduct>();
    expect(page.variants[0]).toMatchObject({ priceMinor: 460_000, wasPriceMinor: null });
  });

  it('is checked by the server and prices the order that carries it', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store);
    await coupon(store);
    const check = (code: string) =>
      app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/coupon?code=${encodeURIComponent(code)}` });
    const ok = await check('Summer10');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<ShopCoupon>()).toEqual({ name: 'خصم الصيف', percentBp: 1000, kind: 'percent' });
    expect((await check('NOPE')).statusCode).toBe(400);
    expect((await check('')).statusCode).toBe(400);

    const bad = await placeOrder(p.variant, { coupon: 'WRONG' });
    expect(bad.statusCode).toBe(400);
    const placed = await placeOrder(p.variant, { coupon: 'summer10' });
    expect(placed.statusCode, placed.body).toBe(201);
    // 2 × 460,000 less 10%
    expect(placed.json<ShopOrderPlaced>()).toMatchObject({ totalMinor: 828_000 });
    expect(placed.json<ShopOrderPlaced>().message).toContain('كود الخصم: SUMMER10');
    const [mine] = await orders(store);
    expect(mine).toMatchObject({ couponCode: 'SUMMER10', totalMinor: 828_000 });
    const token = placed.json<ShopOrderPlaced>().trackPath.split('/').pop()!;
    const track = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/orders/${token}` })
    ).json<ShopOrderTrack>();
    expect(track.coupon).toBe('SUMMER10');

    // Without the code the same cart is at the shelf price
    const plain = await placeOrder(p.variant);
    expect(plain.json<ShopOrderPlaced>().totalMinor).toBe(920_000);
  });

  it('refuses a stopped or not yet running offer, and reveals no price when prices are hidden', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store, { showPrices: false });
    await coupon(store, {
      couponCode: 'LATER',
      startsAt: new Date(Date.now() + 86_400_000 * 3).toISOString(),
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion/coupon?code=LATER' })).statusCode,
    ).toBe(400);
    await coupon(store, { name: 'مفتوح', couponCode: 'OPEN5', percentBp: 500 });
    const ok = await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion/coupon?code=OPEN5' });
    expect(ok.json<ShopCoupon>()).toEqual({ name: 'مفتوح', percentBp: null, kind: 'percent' });
    const placed = await placeOrder(p.variant, { coupon: 'OPEN5' });
    expect(hasMoney(placed.json())).toBe(false);
    expect(placed.json<ShopOrderPlaced>().message).not.toMatch(/ل\.س|SYP|\d{3},/);
    // The store still sees the discounted server-side total
    expect((await orders(store))[0]).toMatchObject({ couponCode: 'OPEN5', totalMinor: 874_000 });
    const [stopped] = [
      await coupon(store, {
        name: 'قديم',
        couponCode: 'OLD',
        endsAt: new Date(Date.now() - 1000).toISOString(),
        startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ];
    expect(stopped.statusCode).toBe(201);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion/coupon?code=OLD' })).statusCode,
    ).toBe(400);
  });
});

describe('the coupon at the till', () => {
  it('reaches the till only on the order that carries it, never as a promotion for every sale', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store);
    await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: as(store),
      payload: { name: 'للجميع', kind: 'percent', percentBp: 500, scope: 'all' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: as(store),
      payload: { name: 'خصم الصيف', kind: 'percent', percentBp: 1000, scope: 'all', couponCode: 'SUMMER10' },
    });
    const placed = await placeOrder(p.variant, { coupon: 'summer10' });
    expect(placed.statusCode, placed.body).toBe(201);
    await accept(store);

    await settled();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    expect(res.statusCode, res.body).toBe(200);
    const sets = res.json<{
      sets: Record<string, { upserts: Record<string, unknown>[] }>;
    }>().sets;
    // The coupon's promotion is masked as stopped on every till: it never prices a sale by itself
    const promos = Object.fromEntries(sets.promotions!.upserts.map((x) => [x.name as string, x]));
    expect(promos['للجميع']).toMatchObject({ archived: false });
    expect(promos['خصم الصيف']).toMatchObject({ archived: true });
    expect(promos['خصم الصيف']).not.toHaveProperty('couponCode');
    // The order carries the offer as it was when the customer placed it
    expect(sets.online_orders!.upserts[0]).toMatchObject({
      number: 'ONL-000001',
      couponRule: {
        name: 'خصم الصيف',
        kind: 'percent',
        percentBp: 1000,
        scope: 'all',
        couponCode: 'SUMMER10',
      },
    });
  });

  it('is null on an order without a coupon', async () => {
    const store = await openStore(app);
    const p = await item(store);
    await saveShop(store);
    await placeOrder(p.variant);
    await accept(store);
    await settled();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    const sets = res.json<{ sets: Record<string, { upserts: Record<string, unknown>[] }> }>().sets;
    expect(sets.online_orders!.upserts[0]!.couponRule).toBeNull();
  });
});

describe('the store’s look', () => {
  // The first bytes of a PNG: the server checks them, not the picture
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
  const upload = (store: Pick<Store, 'accessToken'>, slot: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'PUT',
      url: `/v1/online-store/image/${slot}`,
      headers: as(store),
      payload: { contentType: 'image/png', data: PNG, thumb: PNG, width: 400, height: 400, ...extra },
    });

  it('shows the tagline, the accent and the pictures on the shop, and takes them away', async () => {
    const store = await openStore(app);
    await item(store);
    const before = await app.inject({ method: 'GET', url: '/v1/online-store', headers: as(store) });
    expect(before.json<OnlineStoreSettings>()).toMatchObject({ accent: 'emerald', tagline: null });
    // The pictures wait for the first save
    expect((await upload(store, 'logo')).statusCode).toBe(409);

    const saved = await saveShop(store, { tagline: 'أناقة كل يوم', accent: 'teal' });
    expect(saved).toMatchObject({ tagline: 'أناقة كل يوم', accent: 'teal', logoUrl: null, coverUrl: null });
    const logo = await upload(store, 'logo');
    expect(logo.statusCode, logo.body).toBe(200);
    const cover = await upload(store, 'cover', { width: 1600, height: 500 });
    expect(cover.statusCode, cover.body).toBe(200);
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store).toMatchObject({ tagline: 'أناقة كل يوم', accent: 'teal' });
    expect(home.store.logoUrl).toMatch(/^\/v1\/images\/.+\?size=thumb$/);
    expect(home.store.coverUrl).toMatch(/^\/v1\/images\//);
    const served = await app.inject({ method: 'GET', url: home.store.coverUrl! });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');

    // Saving the settings again does not drop the pictures
    const again = await saveShop(store, { tagline: null, accent: 'blue' });
    expect(again).toMatchObject({ tagline: null, accent: 'blue' });
    expect(again.logoUrl).not.toBeNull();

    const gone = await app.inject({
      method: 'DELETE',
      url: '/v1/online-store/image/logo',
      headers: as(store),
    });
    expect(gone.json<OnlineStoreSettings>().logoUrl).toBeNull();
    expect(gone.json<OnlineStoreSettings>().coverUrl).not.toBeNull();
  });

  it('takes only the identity’s own accents and real pictures', async () => {
    const store = await openStore(app);
    const free = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: as(store),
      payload: { ...SETTINGS, accent: '#ff0000' },
    });
    expect(free.statusCode).toBe(400);
    await saveShop(store);
    expect(
      (await upload(store, 'logo', { data: Buffer.from('not an image').toString('base64') })).statusCode,
    ).toBe(400);
    expect((await upload(store, 'banner')).statusCode).toBe(404);
    const noToken = await app.inject({
      method: 'PUT',
      url: '/v1/online-store/image/logo',
      payload: { contentType: 'image/png', data: PNG, thumb: PNG, width: 4, height: 4 },
    });
    expect(noToken.statusCode).toBe(401);
  });
});

describe('«أبلغني عند التوفر»', () => {
  const notify = (productId: string, variantId: string, phone = '0944111222') =>
    app.inject({
      method: 'POST',
      url: `/v1/shop/nour-fashion/products/${productId}/notify`,
      payload: { variantId, phone },
    });

  it('keeps the phones left on a piece that is out, per product, and marks the ones told', async () => {
    const store = await openStore(app);
    const out = await item(store, 'فستان', 0);
    const there = await item(store, 'قميص', 3);
    await saveShop(store, { showPrices: false });
    expect((await notify(out.id, out.variant)).statusCode).toBe(204);
    // The same phone twice is once
    expect((await notify(out.id, out.variant)).statusCode).toBe(204);
    expect((await notify(out.id, out.variant, '0955333444')).statusCode).toBe(204);
    // A piece on the shelf needs no waiting; a stranger's piece is not found; a bad phone is refused
    expect((await notify(there.id, there.variant)).statusCode).toBe(409);
    expect((await notify(out.id, there.variant)).statusCode).toBe(404);
    expect((await notify(out.id, out.variant, '12')).statusCode).toBe(400);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/products/${out.id}/stock-alerts`,
      headers: as(store),
    });
    const items = list.json<{ items: StockAlert[] }>().items;
    expect(items.map((a) => a.phone)).toHaveLength(2);
    expect(items[0]).toMatchObject({ variantLabel: 'L', inStock: false, notifiedAt: null });

    const told = await app.inject({
      method: 'POST',
      url: `/v1/stock-alerts/${items[0]!.id}/notified`,
      headers: as(store),
    });
    expect(told.statusCode, told.body).toBe(200);
    const after = (
      await app.inject({ method: 'GET', url: `/v1/products/${out.id}/stock-alerts`, headers: as(store) })
    ).json<{ items: StockAlert[] }>().items;
    // The ones still waiting come first
    expect(after[0]!.notifiedAt).toBeNull();
    expect(after[1]!.notifiedAt).not.toBeNull();
    expect(
      (
        await app.inject({ method: 'GET', url: `/v1/products/${there.id}/stock-alerts`, headers: as(store) })
      ).json<{
        items: StockAlert[];
      }>().items,
    ).toEqual([]);
  });

  it('is the store’s own list, for those who manage the catalog', async () => {
    const store = await testStore(app);
    const out = await item(store, 'فستان', 0);
    await saveShop(store);
    await notify(out.id, out.variant);
    const cashier = await staffUser(app, store, 'cashier', '0955000333');
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/products/${out.id}/stock-alerts`,
      headers: bearer(cashier.accessToken),
    });
    expect(denied.statusCode).toBe(403);
    const none = await app.inject({
      method: 'POST',
      url: '/v1/stock-alerts/00000000-0000-7000-8000-000000000000/notified',
      headers: as(store),
    });
    expect(none.statusCode).toBe(404);
  });
});

describe('the price-change history', () => {
  const history = (store: Pick<Store, 'accessToken'>, query = '') =>
    app.inject({ method: 'GET', url: `/v1/price-history${query}`, headers: as(store) }).then((r) => ({
      status: r.statusCode,
      items: (r.json<{ items: PriceChange[] }>().items ?? []) as PriceChange[],
    }));

  it('lists a product edit, a price list and a bulk change, with who, from-to and the source', async () => {
    const store = await openStore(app);
    const a = await item(store, 'قميص', 2);
    const b = await item(store, 'بنطال', 2);
    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${a.id}`,
      headers: as(store),
      payload: {
        version: a.version,
        variants: [{ id: a.variant, price: { currency: 'SYP', priceMinor: 500_000 } }],
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const list = await app.inject({
      method: 'POST',
      url: '/v1/prices/list/apply',
      headers: as(store),
      payload: { fileName: 'خريف.xlsx', changes: [{ variantId: b.variant, newMinor: 700_000 }] },
    });
    expect(list.statusCode, list.body).toBe(200);

    const all = await history(store);
    expect(all.status).toBe(200);
    expect(all.items.map((i) => i.source).sort()).toEqual([
      'price_list',
      'price_list_summary',
      'product_edit',
    ]);
    const editRow = all.items.find((i) => i.source === 'product_edit')!;
    expect(editRow).toMatchObject({
      productId: a.id,
      productName: 'قميص',
      variantLabel: 'L',
      oldMinor: 460_000,
      newMinor: 500_000,
    });
    expect(editRow.userName).toBeTruthy();
    expect(all.items.find((i) => i.source === 'price_list')).toMatchObject({
      productName: 'بنطال',
      oldMinor: 460_000,
      newMinor: 700_000,
      note: 'خريف.xlsx',
    });
    expect(all.items.find((i) => i.source === 'price_list_summary')).toMatchObject({
      oldMinor: null,
      note: expect.stringContaining('1 قطعة'),
    });

    // One product: its own rows only
    const mine = await history(store, `?productId=${a.id}`);
    expect(mine.items.map((i) => i.source)).toEqual(['product_edit']);
    // A day in the past has nothing, today has all
    expect((await history(store, '?to=2020-01-01')).items).toEqual([]);
    // The store's day can differ from UTC's around midnight: a day either side covers it
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    expect((await history(store, `?from=${day(-1)}&to=${day(1)}`)).items.length).toBe(3);
    expect((await history(store, '?limit=1')).items).toHaveLength(1);
    expect((await history(store, '?from=junk')).status).toBe(400);
  });

  it('shows a bulk change per piece, and a markdown ending as such', async () => {
    const store = await openStore(app);
    await item(store, 'قميص', 1);
    const cat = (
      await app.inject({
        method: 'POST',
        url: '/v1/categories',
        headers: as(store),
        payload: { name: 'صيفي' },
      })
    ).json<{ id: string }>();
    const p = await item(store, 'تيشرت', 1);
    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${p.id}`,
      headers: as(store),
      payload: { version: p.version, categoryId: cat.id },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const bulk = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/prices/bulk',
        headers: as(store),
        payload: { categoryId: cat.id, apply: true, roundToMinor: 1000, ...payload },
      });
    expect((await bulk({ mode: 'move', percentBp: -3000 })).statusCode).toBe(200);
    expect((await bulk({ mode: 'restore', percentBp: 0 })).statusCode).toBe(200);
    const rows = (await history(store)).items;
    expect(rows.map((r) => r.source)).toEqual(['bulk', 'bulk']);
    const notes = rows.map((r) => r.note).join('|');
    expect(notes).toContain('إنهاء التخفيض');
    expect(notes).toContain('تعديل جماعي -30٪');
    // A product filter leaves the bulk rows out
    expect((await history(store, `?productId=${p.id}`)).items).toEqual([]);
  });

  it('is for those who manage the catalog, and one store never sees another’s', async () => {
    const a = await testStore(app);
    const cashier = await staffUser(app, a, 'cashier', '0955000444');
    expect(
      (await app.inject({ method: 'GET', url: '/v1/price-history', headers: bearer(cashier.accessToken) }))
        .statusCode,
    ).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/price-history' })).statusCode).toBe(401);
    const p = await item(a, 'قميص', 1);
    await app.inject({
      method: 'PATCH',
      url: `/v1/products/${p.id}`,
      headers: as(a),
      payload: {
        version: p.version,
        variants: [{ id: p.variant, price: { currency: 'SYP', priceMinor: 1 } }],
      },
    });
    const b = await testStore(app, '0966000111');
    expect((await history(b)).items).toEqual([]);
    expect((await history(a)).items).toHaveLength(1);
  });
});

describe('round 44: what the customer is told, what a code is worth, who decides', () => {
  const promo = (store: Pick<Store, 'accessToken'>, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: as(store),
      payload: { name: 'عرض', kind: 'percent', percentBp: 1000, scope: 'all', ...extra },
    });
  const quote = (lines: { variantId: string; qty: number }[], coupon: string | null) =>
    app.inject({ method: 'POST', url: '/v1/shop/nour-fashion/quote', payload: { lines, coupon } });
  type Refused = { error: { message: string; fields: Record<string, string> } };

  it('puts the refusal in the alert itself, not only in the field', async () => {
    const store = await testStore(app);
    const p = await item(store, 'قميص كتان', 1);
    await saveShop(store);
    const tooMany = await placeOrder(p.variant, { lines: [{ variantId: p.variant, qty: 3 }] });
    expect(tooMany.statusCode).toBe(400);
    const body = tooMany.json<Refused>().error;
    expect(body.message).toContain('المتوفر');
    expect(body.fields['lines.0']).toBe(body.message);
    const bad = await placeOrder(p.variant, { coupon: 'NOPE', lines: [{ variantId: p.variant, qty: 1 }] });
    const badBody = bad.json<Refused>().error;
    expect(badBody.message).toBe(badBody.fields.coupon);
  });

  it('quotes the code as the order will be priced: a better offer already on the line leaves it at nothing', async () => {
    const store = await testStore(app);
    const p = await item(store);
    await saveShop(store);
    // The shop's own 15% offer, and two codes: 10% (worse) and 20% (better)
    expect((await promo(store, { name: 'تنزيلات', percentBp: 1500 })).statusCode).toBe(201);
    expect((await promo(store, { name: 'عشرة', couponCode: 'TEN' })).statusCode).toBe(201);
    expect((await promo(store, { name: 'عشرون', percentBp: 2000, couponCode: 'TWENTY' })).statusCode).toBe(
      201,
    );
    const lines = [{ variantId: p.variant, qty: 2 }];
    // 460,000 less 15% is 391,000 a piece
    const plain = (await quote(lines, null)).json<{ subtotalMinor: number; discountMinor: number }>();
    expect(plain).toMatchObject({ subtotalMinor: 782_000, discountMinor: 0 });
    const ten = (await quote(lines, 'ten')).json<{ discountMinor: number; totalMinor: number }>();
    expect(ten).toMatchObject({ discountMinor: 0, totalMinor: 782_000 });
    const twenty = (await quote(lines, 'TWENTY')).json<{ discountMinor: number; totalMinor: number }>();
    expect(twenty.discountMinor).toBe(782_000 - 736_000);
    // ...and the order carries the very same total
    const placed = await placeOrder(p.variant, { coupon: 'TWENTY' });
    expect(placed.json<ShopOrderPlaced>().totalMinor).toBe(twenty.totalMinor);
    expect((await quote(lines, 'WRONG')).statusCode).toBe(400);
    await saveShop(store, { showPrices: false });
    expect((await quote(lines, null)).json()).toMatchObject({ showPrices: false, totalMinor: 0 });
  });

  it('says what kind of offer a code opens, and refuses a code on an offer for some customers only', async () => {
    const store = await testStore(app);
    await item(store);
    await saveShop(store);
    const buyGet = await promo(store, {
      kind: 'buy_get',
      percentBp: null,
      buyQty: 2,
      getQty: 1,
      couponCode: 'BGX',
    });
    expect(buyGet.statusCode).toBe(201);
    const open = await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion/coupon?code=BGX' });
    expect(open.json<ShopCoupon>().kind).toBe('buy_get');
    const audience = await promo(store, { name: 'جملة', couponCode: 'WHOLE', priceTiers: ['wholesale'] });
    expect(audience.statusCode).toBe(400);
    expect(audience.json<Refused>().error.fields.couponCode).toBeTruthy();
    const rep = await promo(store, { name: 'مندوب', couponCode: 'REP1', repOnly: true });
    expect(rep.statusCode).toBe(400);
    // A stopped offer with both is let through: an old row must still be stoppable
    const old = await promo(store, { name: 'قديم', couponCode: 'OLD1', repOnly: true, archived: true });
    expect(old.statusCode).toBe(201);
  });

  it('stops and restarts an offer without reading the rest of it, once per version', async () => {
    const store = await testStore(app);
    const made = (await promo(store)).json<{ id: string; version: number }>();
    const stop = (version: number, archived: boolean) =>
      app.inject({
        method: 'POST',
        url: `/v1/promotions/${made.id}/archive`,
        headers: as(store),
        payload: { version, archived },
      });
    const stopped = await stop(made.version, true);
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json<{ archived: boolean }>().archived).toBe(true);
    // The same click again with the old version: stale, not a second change
    expect((await stop(made.version, true)).statusCode).toBe(409);
    const again = await stop(stopped.json<{ version: number }>().version, false);
    expect(again.json<{ archived: boolean }>().archived).toBe(false);
    const cashier = await staffUser(app, store, 'cashier', '0955000555');
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/promotions/${made.id}/archive`,
      headers: bearer(cashier.accessToken),
      payload: { version: 1, archived: true },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('lets only a manager decide orders and see the couriers cash; a rep may look', async () => {
    const store = await testStore(app);
    const p = await item(store);
    await saveShop(store);
    await placeOrder(p.variant);
    const [pending] = await orders(store, 'pending');
    const rep = await staffUser(app, store, 'rep', '0955000666');
    const list = await app.inject({
      method: 'GET',
      url: '/v1/online-orders',
      headers: bearer(rep.accessToken),
    });
    expect(list.statusCode).toBe(200);
    const decide = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${pending!.id}/status`,
      headers: bearer(rep.accessToken),
      payload: { status: 'accepted', version: pending!.version },
    });
    expect(decide.statusCode).toBe(403);
    const cod = await app.inject({
      method: 'GET',
      url: '/v1/online-orders/cod',
      headers: bearer(rep.accessToken),
    });
    expect(cod.statusCode).toBe(403);
    expect(await orders(store, 'pending')).toHaveLength(1);
  });

  it('refuses to accept what the shelf cannot cover, unless told the pieces are coming', async () => {
    const store = await testStore(app);
    const p = await item(store, 'قميص كتان', 2);
    await saveShop(store);
    await placeOrder(p.variant, { lines: [{ variantId: p.variant, qty: 2 }] });
    // Another order for the same two pieces: placing it is fine (a pending order holds nothing)
    await placeOrder(p.variant, { lines: [{ variantId: p.variant, qty: 2 }], phone: '0944777888' });
    const [second, first] = await orders(store, 'pending');
    const take = (o: OnlineOrder, extra: Record<string, unknown> = {}) =>
      app.inject({
        method: 'POST',
        url: `/v1/online-orders/${o.id}/status`,
        headers: as(store),
        payload: { status: 'accepted', version: o.version, ...extra },
      });
    expect((await take(first!)).statusCode).toBe(200);
    const refused = await take(second!);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<Refused>().error.fields.stock).toContain('قميص كتان');
    expect((await take(second!, { force: true })).statusCode).toBe(200);
  });

  it('pages the orders by a cursor and keeps the shop page cacheable', async () => {
    const store = await testStore(app);
    const p = await item(store, 'قميص كتان', 9);
    await saveShop(store);
    for (const phone of ['0944000001', '0944000002', '0944000003']) {
      await placeOrder(p.variant, { phone, lines: [{ variantId: p.variant, qty: 1 }] });
    }
    const page = (cursor = '') =>
      app
        .inject({ method: 'GET', url: `/v1/online-orders?limit=2${cursor}`, headers: as(store) })
        .then((r) => r.json<{ items: OnlineOrder[]; nextCursor: string | null }>());
    const one = await page();
    expect(one.items).toHaveLength(2);
    expect(one.nextCursor).toBe('2');
    const two = await page('&cursor=2');
    expect(two.items).toHaveLength(1);
    expect(two.nextCursor).toBeNull();
    expect(new Set([...one.items, ...two.items].map((o) => o.id)).size).toBe(3);
    const home = await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' });
    expect(home.headers['cache-control']).toBe('public, max-age=30');
  });

  it('answers a repeated tap with the first order, and a different order with a new one', async () => {
    const store = await testStore(app);
    const p = await item(store, 'قميص كتان', 9);
    await saveShop(store);
    const first = (await placeOrder(p.variant)).json<ShopOrderPlaced>();
    const second = (await placeOrder(p.variant)).json<ShopOrderPlaced>();
    expect(second.number).toBe(first.number);
    expect(second.trackPath).toBe(first.trackPath);
    expect(await orders(store)).toHaveLength(1);
    const lines = [{ variantId: p.variant, qty: 3 }];
    const other = (await placeOrder(p.variant, { lines })).json<ShopOrderPlaced>();
    expect(other.number).not.toBe(first.number);
  });
});
