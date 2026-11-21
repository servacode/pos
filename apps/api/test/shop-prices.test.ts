import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OnlineOrder,
  OnlineStoreSettings,
  ProductDetail,
  ShopHome,
  ShopOrderPlaced,
  ShopOrderTrack,
  ShopProduct,
  SupplierRow,
} from '@serva/core';
import { openStore, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, makeApp, resetDatabase } from './helpers';
import { bearer, staffUser, testStore } from './staff';

/**
 * «اعرض الأسعار في المتجر الإلكتروني»: off, the public shop sends no price anywhere and an order is
 * an inquiry; the order still keeps its server-side prices for the store's own box.
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
  showOutOfStock: false,
};

async function saveShop(store: Pick<Store, 'accessToken'>, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/online-store',
    headers: as(store),
    payload: { ...SETTINGS, ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<OnlineStoreSettings>();
}

/** A shirt in L on the shelf, priced 460,000 */
async function shirt(store: Store) {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: as(store),
    payload: {
      nameAr: 'قميص كتان',
      variants: [
        {
          attributes: [{ name: 'المقاس', value: 'L' }],
          price: { currency: 'SYP', priceMinor: 460_000 },
        },
      ],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const product = created.json<ProductDetail>();
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
      lines: [{ variantId: product.variants[0]!.id, qty: 5000, costMinor: 1_000_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { id: product.id, variant: product.variants[0]!.id };
}

/** 20% off everything while it runs: a price the shop strikes through */
async function promotion(store: Pick<Store, 'accessToken'>) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/promotions',
    headers: as(store),
    payload: { name: 'تنزيلات الشتاء', kind: 'percent', percentBp: 2000, scope: 'all' },
  });
  expect(res.statusCode, res.body).toBe(201);
}

const order = (variantId: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/shop/nour-fashion/orders',
    payload: {
      name: 'ريم',
      phone: '0944555666',
      fulfilment: 'delivery',
      address: 'المزة',
      note: null,
      lines: [{ variantId, qty: 2 }],
    },
  });

/** Any money field of the response with an amount in it */
const hasMoney = (value: unknown) => /Minor":[1-9]/.test(JSON.stringify(value));

describe('the online shop with prices hidden', () => {
  it('shows prices by default, so a shop saved before this setting is unchanged', async () => {
    const store = await openStore(app);
    const { id, variant } = await shirt(store);
    await promotion(store);
    const saved = await saveShop(store);
    expect(saved.showPrices).toBe(true);
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store.showPrices).toBe(true);
    expect(home.products[0]).toMatchObject({
      priceMinor: 368_000,
      wasPriceMinor: 460_000,
      offer: 'تنزيلات الشتاء',
    });
    const page = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${id}` })
    ).json<ShopProduct>();
    expect(page.showPrices).toBe(true);
    expect(page.variants[0]).toMatchObject({ id: variant, priceMinor: 368_000, wasPriceMinor: 460_000 });
  });

  it('leaks no price from the catalog, the product, the placed order or its tracking', async () => {
    const store = await openStore(app);
    const { id, variant } = await shirt(store);
    // A running offer and the delivery fee are prices too
    await promotion(store);
    await saveShop(store, { showPrices: false, deliveryFeeMinor: 10_000 });
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store).toMatchObject({ showPrices: false, deliveryFeeMinor: 0 });
    expect(home.products).toHaveLength(1);
    expect(home.products[0]).toMatchObject({
      name: 'قميص كتان',
      available: true,
      priceMinor: null,
      maxPriceMinor: null,
      wasPriceMinor: null,
      offer: null,
    });
    expect(hasMoney(home)).toBe(false);

    const pageRes = await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/products/${id}` });
    const page = pageRes.json<ShopProduct>();
    expect(page.showPrices).toBe(false);
    expect(page.variants[0]).toMatchObject({
      id: variant,
      available: true,
      priceMinor: null,
      wasPriceMinor: null,
    });
    expect(hasMoney(page)).toBe(false);
    expect(pageRes.body).not.toMatch(/460000|368000|تنزيلات/);
    expect(page.offer).toBeNull();

    const res = await order(variant);
    expect(res.statusCode, res.body).toBe(201);
    const placed = res.json<ShopOrderPlaced>();
    expect(placed).toMatchObject({
      number: 'ONL-000001',
      showPrices: false,
      totalMinor: null,
      deliveryFeeMinor: null,
    });
    // The WhatsApp message lists the pieces and quantities and no amount
    expect(placed.message).toContain('قميص كتان (L) × 2');
    expect(placed.message).not.toMatch(/المجموع|الإجمالي|أجرة|ل\.س|SYP|460|368|736/);
    expect(decodeURIComponent(placed.whatsappUrl!.split('text=')[1]!)).toBe(placed.message);
    expect(hasMoney(placed)).toBe(false);

    const token = placed.trackPath.split('/').pop()!;
    const trackRes = await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/orders/${token}` });
    const track = trackRes.json<ShopOrderTrack>();
    expect(track).toMatchObject({ showPrices: false, totalMinor: null, deliveryFeeMinor: null });
    expect(track.lines).toEqual([{ name: 'قميص كتان', label: 'L', qty: 2, totalMinor: null }]);
    expect(hasMoney(track)).toBe(false);

    // The store still gets the order with its server-side prices, in its own box
    const box = await app.inject({
      method: 'GET',
      url: '/v1/online-orders?status=pending',
      headers: as(store),
    });
    const [mine] = box.json<{ items: OnlineOrder[] }>().items;
    expect(mine).toMatchObject({ totalMinor: 736_000, deliveryFeeMinor: 10_000 });
    expect(mine!.lines[0]).toMatchObject({ priceMinor: 368_000, totalMinor: 736_000 });
  });

  it('shows prices again when the owner turns it back on', async () => {
    const store = await openStore(app);
    const { variant } = await shirt(store);
    const saved = await saveShop(store, { showPrices: false });
    expect(saved.showPrices).toBe(false);
    const placed = (await order(variant)).json<ShopOrderPlaced>();
    await saveShop(store, { version: 1, showPrices: true });
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.products[0]!.priceMinor).toBe(460_000);
    const token = placed.trackPath.split('/').pop()!;
    const track = (
      await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/orders/${token}` })
    ).json<ShopOrderTrack>();
    expect(track).toMatchObject({ showPrices: true, totalMinor: 920_000 });
  });

  it('is changed only by someone who may manage settings', async () => {
    const store = await testStore(app);
    const cashier = await staffUser(app, store, 'cashier', '0955000111');
    const denied = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: bearer(cashier.accessToken),
      payload: { ...SETTINGS, showPrices: false },
    });
    expect(denied.statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/v1/online-store', payload: SETTINGS })).statusCode).toBe(
      401,
    );
    const saved = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: bearer(store.accessToken),
      payload: { ...SETTINGS, showPrices: false },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<OnlineStoreSettings>().showPrices).toBe(false);
    const read = await app.inject({
      method: 'GET',
      url: '/v1/online-store',
      headers: bearer(store.accessToken),
    });
    expect(read.json<OnlineStoreSettings>().showPrices).toBe(false);
  });
});
