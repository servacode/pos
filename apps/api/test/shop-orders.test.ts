import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OnlineOrder,
  OnlineOrderRow,
  ProductDetail,
  ShopCodeSent,
  ShopHome,
  ShopOrderPlaced,
  ShopOrderTrack,
  SupplierRow,
} from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { closeAppDb, closeOwnerDb, codes, makeApp, resetDatabase, settled } from './helpers';

/**
 * The online shop, second step (26 › حياة الطلب): an order placed in the shop with a code to the
 * customer's phone, its own page, the pieces held once accepted, and the till that sells it closes it.
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
const PHONE = '0944555666';

async function openShop(store: Store, orderMode: 'whatsapp' | 'shop') {
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/online-store',
    headers: as(store),
    payload: {
      version: null,
      enabled: true,
      slug: 'nour-fashion',
      whatsapp: orderMode === 'whatsapp' ? '0933123456' : null,
      delivery: true,
      pickup: true,
      note: null,
      showOutOfStock: false,
      orderMode,
    },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Two dresses on the shelf */
async function dress(store: Store) {
  const product = (
    await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: as(store),
      payload: { nameAr: 'فستان', variants: [{ price: { currency: 'SYP', priceMinor: 900_000 } }] },
    })
  ).json<ProductDetail>();
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
      lines: [{ variantId: product.variants[0]!.id, qty: 2000, costMinor: 500_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { productId: product.id, variantId: product.variants[0]!.id };
}

const askCode = (phone = PHONE) =>
  app.inject({ method: 'POST', url: '/v1/shop/nour-fashion/orders/code', payload: { phone } });

const order = (lines: { variantId: string; qty: number }[], extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/v1/shop/nour-fashion/orders',
    payload: { name: 'ريم', phone: PHONE, fulfilment: 'pickup', address: null, note: null, lines, ...extra },
  });

async function placeWithCode(variantId: string, qty: number): Promise<ShopOrderPlaced> {
  const sent = (await askCode()).json<ShopCodeSent>();
  const code = codes.sent.at(-1)!.code;
  const res = await order([{ variantId, qty }], { challengeId: sent.challengeId, code });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ShopOrderPlaced>();
}

const ordersBox = async (store: Store) =>
  (await app.inject({ method: 'GET', url: '/v1/online-orders', headers: as(store) })).json<{
    items: OnlineOrder[];
  }>().items;

const decide = (store: Store, o: OnlineOrder, status: OnlineOrder['status']) =>
  app.inject({
    method: 'POST',
    url: `/v1/online-orders/${o.id}/status`,
    headers: as(store),
    payload: { status, version: o.version },
  });

const available = async () =>
  (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>().products[0]
    ?.available ?? false;

async function tillOrders(store: Store): Promise<OnlineOrderRow[]> {
  await settled();
  const page = await app.inject({
    method: 'GET',
    url: '/v1/sync/pull',
    headers: { authorization: store.device.authorization },
  });
  expect(page.statusCode, page.body).toBe(200);
  return (page.json<PullResponse>().sets as unknown as { online_orders: { upserts: OnlineOrderRow[] } })
    .online_orders.upserts;
}

describe('ordering in the shop itself', () => {
  it('confirms the phone by a code, then gives the customer a page for the order', async () => {
    const store = await openStore(app);
    await openShop(store, 'shop');
    const { variantId } = await dress(store);
    const home = (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>();
    expect(home.store.orderMode).toBe('shop');

    // No code, then a wrong one: refused, nothing saved
    expect((await order([{ variantId, qty: 1 }])).json()).toMatchObject({
      error: { fields: { code: expect.any(String) } },
    });
    const sent = (await askCode()).json<ShopCodeSent>();
    expect(sent).toMatchObject({ challengeId: expect.any(String), expiresIn: 600 });
    expect(codes.sent.at(-1)).toMatchObject({ phone: '+963944555666', purpose: 'shop_order' });
    const code = codes.sent.at(-1)!.code;
    const wrong = await order([{ variantId, qty: 1 }], {
      challengeId: sent.challengeId,
      code: code === '000000' ? '111111' : '000000',
    });
    expect(wrong.statusCode).toBe(400);
    // A code for another phone does not place this one's order
    const other = await order([{ variantId, qty: 1 }], {
      challengeId: sent.challengeId,
      code,
      phone: '0944000111',
    });
    expect(other.statusCode).toBe(400);
    expect(await ordersBox(store)).toEqual([]);

    const placed = await placeWithCode(variantId, 1);
    expect(placed).toMatchObject({
      number: 'ONL-000001',
      whatsappUrl: null,
      trackPath: expect.stringMatching(/^\/shop\/nour-fashion\/o\/[0-9a-f]{32}$/),
    });
    const [saved] = await ordersBox(store);
    expect(saved).toMatchObject({ source: 'shop', status: 'pending', phone: '+963944555666' });

    const token = placed.trackPath.split('/').at(-1)!;
    const page = await app.inject({ method: 'GET', url: `/v1/shop/nour-fashion/orders/${token}` });
    expect(page.json<ShopOrderTrack>()).toMatchObject({
      number: 'ONL-000001',
      status: 'pending',
      totalMinor: 900_000,
      lines: [{ name: 'فستان', qty: 1, totalMinor: 900_000 }],
    });
    // Not a guessable number, nor another store's
    const bad = await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion/orders/ONL-000001' });
    expect(bad.statusCode).toBe(404);
    const unknown = await app.inject({
      method: 'GET',
      url: `/v1/shop/nour-fashion/orders/${'a'.repeat(32)}`,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('sends no code for a store that takes orders on WhatsApp, and needs none there', async () => {
    const store = await openStore(app);
    await openShop(store, 'whatsapp');
    const { variantId } = await dress(store);
    expect((await askCode()).statusCode).toBe(400);
    const res = await order([{ variantId, qty: 1 }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<ShopOrderPlaced>()).toMatchObject({
      whatsappUrl: expect.stringContaining('https://wa.me/963933123456'),
      trackPath: expect.stringContaining('/shop/nour-fashion/o/'),
    });
  });
});

describe('an accepted order on its way to the till', () => {
  it('holds its pieces in the shop, reaches the tills, and the sale closes it', async () => {
    const store = await openStore(app);
    await openShop(store, 'shop');
    const { productId, variantId } = await dress(store);
    await placeWithCode(variantId, 2);
    expect(await available()).toBe(true);
    // A pending order is not at the till yet
    expect(await tillOrders(store)).toEqual([]);

    const [pending] = await ordersBox(store);
    expect((await decide(store, pending!, 'accepted')).statusCode).toBe(200);
    // Both dresses are held: the shop shows none left
    expect(await available()).toBe(false);
    const [atTill] = await tillOrders(store);
    expect(atTill).toMatchObject({
      id: pending!.id,
      number: 'ONL-000001',
      status: 'accepted',
      customerName: 'ريم',
      totalMinor: 1_800_000,
      lines: [{ variantId, qty: 2 }],
    });

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        onlineOrderId: pending!.id,
        lines: [cartLine(1, 900_000, { productId, variantId, qty: 2000 })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 1_800_000 }],
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const [done] = await ordersBox(store);
    expect(done).toMatchObject({ status: 'done' });
    expect((await tillOrders(store)).find((o) => o.id === pending!.id)?.status).toBe('done');
    // Sold: the shelf is empty for real now, nothing held
    expect(await available()).toBe(false);
  });

  it('gives the pieces back when an accepted order is rejected', async () => {
    const store = await openStore(app);
    await openShop(store, 'shop');
    const { variantId } = await dress(store);
    await placeWithCode(variantId, 2);
    const [pending] = await ordersBox(store);
    await decide(store, pending!, 'accepted');
    expect(await available()).toBe(false);
    const [accepted] = await ordersBox(store);
    expect((await decide(store, accepted!, 'rejected')).statusCode).toBe(200);
    expect(await available()).toBe(true);
  });
});

describe('«احجز» at the till', () => {
  it('holds the cart for a customer with the deposit voucher’s code, ready for pickup', async () => {
    const store = await openStore(app);
    await openShop(store, 'whatsapp');
    const { variantId } = await dress(store);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/holds',
      headers: { authorization: store.device.authorization },
      payload: {
        customerName: 'سلمى',
        phone: '0933111222',
        note: 'تمرّ الخميس',
        depositCode: 'GFT-001-001-0000001',
        lines: [{ variantId, qty: 2 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ number: 'ONL-000001', totalMinor: 1_800_000 });
    // Both dresses held: the shop shows none left
    expect(await available()).toBe(false);
    const [held] = await tillOrders(store);
    expect(held).toMatchObject({
      status: 'accepted',
      customerName: 'سلمى',
      depositCode: 'GFT-001-001-0000001',
      lines: [{ variantId, qty: 2 }],
    });
    const [boxed] = await ordersBox(store);
    expect(boxed).toMatchObject({ source: 'hold', status: 'accepted', fulfilment: 'pickup' });
  });
});
