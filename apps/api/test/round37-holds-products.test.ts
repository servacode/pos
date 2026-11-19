import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  OnlineOrder,
  OnlineOrderRow,
  ProductDetail,
  ShopCodeSent,
  ShopHome,
  SupplierRow,
  TillProductPlaced,
} from '@serva/core';
import type { PullResponse } from '@serva/sync';
import { withTenant } from '@serva/db';
import { checkIntegrity, ledgerFingerprint, stockFingerprint } from '../src/services/integrity';
import { cartLine, documents, openStore, push, sale, shiftOpen, type Store } from './accounting-fixtures';
import { staffUser } from './staff';
import { appDb, closeAppDb, closeOwnerDb, codes, makeApp, ownerDb, resetDatabase, settled } from './helpers';

/**
 * Round 37, decisions 14 and 15 (the till).
 *
 * 14: a hold reserves its pieces: available = on hand - reserved, seen by the shop, the stock pages and the
 * till's pull; releasing, selling or lapsing frees them; reserving moves no stock and posts no entry.
 * 15: a product made at the till for an unknown barcode, by someone who may manage the catalog.
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

async function openShop(store: Store) {
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/online-store',
    headers: as(store),
    payload: {
      version: null,
      enabled: true,
      slug: 'nour-fashion',
      whatsapp: null,
      delivery: true,
      pickup: true,
      note: null,
      showOutOfStock: false,
      orderMode: 'shop',
    },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Three dresses on the shelf */
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
      lines: [{ variantId: product.variants[0]!.id, qty: 3000, costMinor: 500_000 }],
    },
  });
  expect(bought.statusCode, bought.body).toBe(201);
  return { productId: product.id, variantId: product.variants[0]!.id };
}

const hold = (store: Store, variantId: string, qty: number) =>
  app.inject({
    method: 'POST',
    url: '/v1/device/holds',
    headers: { authorization: store.device.authorization },
    payload: {
      customerName: 'سلمى',
      phone: '0933111222',
      note: null,
      depositCode: null,
      lines: [{ variantId, qty }],
    },
  });

/** What the stock page says of the first branch: on hand and reserved, thousandths */
async function stockPage(store: Store, productId: string) {
  const detail = (
    await app.inject({ method: 'GET', url: `/v1/products/${productId}`, headers: as(store) })
  ).json<ProductDetail>();
  const level = detail.variants[0]!.stock[0]!;
  return { qty: level.qty, reserved: level.reservedQty, available: level.qty - level.reservedQty };
}

const shopLeft = async () =>
  (await app.inject({ method: 'GET', url: '/v1/shop/nour-fashion' })).json<ShopHome>().products[0]
    ?.available ?? false;

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

const shopOrder = async (variantId: string, qty: number) => {
  const sent = (
    await app.inject({
      method: 'POST',
      url: '/v1/shop/nour-fashion/orders/code',
      payload: { phone: PHONE },
    })
  ).json<ShopCodeSent>();
  return app.inject({
    method: 'POST',
    url: '/v1/shop/nour-fashion/orders',
    payload: {
      name: 'ريم',
      phone: PHONE,
      fulfilment: 'pickup',
      address: null,
      note: null,
      lines: [{ variantId, qty }],
      challengeId: sent.challengeId,
      code: codes.sent.at(-1)!.code,
    },
  });
};

const books = (tenantId: string) =>
  withTenant(appDb().db, tenantId, async (tx) => ({
    ledger: (await ledgerFingerprint(tx, tenantId)).hash,
    stock: (await stockFingerprint(tx, tenantId)).hash,
    report: await checkIntegrity(tx, tenantId),
  }));

const setTill = (store: Store, till: Record<string, unknown>) =>
  app.inject({
    method: 'PUT',
    url: '/v1/store/till',
    headers: as(store),
    payload: { returnWindowDays: null, cardApprovalRequired: false, ...till },
  });

describe('decision 14: a hold reserves its pieces', () => {
  it('reserves without moving stock or posting, shows available = on hand - reserved, and frees on release', async () => {
    const store = await openStore(app);
    await openShop(store);
    const { productId, variantId } = await dress(store);
    expect(await stockPage(store, productId)).toEqual({ qty: 3000, reserved: 0, available: 3000 });
    const before = await books(store.tenantId);

    expect((await hold(store, variantId, 2)).statusCode).toBe(201);
    // Reserving moved no stock and posted nothing: the books are byte for byte the same
    const after = await books(store.tenantId);
    expect(after.ledger).toBe(before.ledger);
    expect(after.stock).toBe(before.stock);
    expect(after.report.checks.filter((c) => !c.ok)).toEqual([]);
    // The stock page: 3 on hand, 2 reserved, 1 available
    expect(await stockPage(store, productId)).toEqual({ qty: 3000, reserved: 2000, available: 1000 });

    // The shop: the reserved pieces cannot be ordered by another person, the one left can
    expect((await shopOrder(variantId, 2)).statusCode).toBe(400);
    expect((await shopOrder(variantId, 1)).statusCode).toBe(201);

    // Releasing the hold frees its pieces
    const box = await ordersBox(store);
    const held = box.find((o) => o.source === 'hold')!;
    expect((await decide(store, held, 'rejected')).statusCode).toBe(200);
    expect(await stockPage(store, productId)).toEqual({ qty: 3000, reserved: 0, available: 3000 });
    expect((await shopOrder(variantId, 2)).statusCode).toBe(201);
  });

  it('stops reserving by itself when the hold lapses, deleting nothing', async () => {
    const store = await openStore(app);
    await openShop(store);
    const { productId, variantId } = await dress(store);
    await hold(store, variantId, 3);
    expect(await shopLeft()).toBe(false);
    expect((await stockPage(store, productId)).reserved).toBe(3000);
    await ownerDb()`update online_orders set reserved_until = now() - interval '1 minute'`;
    expect((await stockPage(store, productId)).reserved).toBe(0);
    expect(await shopLeft()).toBe(true);
    // The hold itself is still there, still accepted, still waiting at the till
    const [row] = await ownerDb()<{ status: string }[]>`select status from online_orders`;
    expect(row!.status).toBe('accepted');
  });

  it('lapses after the store’s own number of days (7 by default)', async () => {
    const store = await openStore(app);
    const { variantId } = await dress(store);
    await hold(store, variantId, 1);
    expect((await setTill(store, { holdExpiryDays: 2 })).statusCode).toBe(200);
    await hold(store, variantId, 1);
    const rows = await ownerDb()<{ days: number }[]>`
      select round(extract(epoch from (reserved_until - now())) / 86400)::int as days from online_orders order by seq`;
    expect(rows.map((r) => r.days)).toEqual([7, 2]);
  });

  it('refuses a second hold over what is left, where the store forbids selling over the stock', async () => {
    const store = await openStore(app);
    const { variantId } = await dress(store);
    expect((await setTill(store, { blockNegativeStock: true })).statusCode).toBe(200);
    expect((await hold(store, variantId, 2)).statusCode).toBe(201);
    const over = await hold(store, variantId, 2);
    expect(over.statusCode).toBe(400);
    expect(over.body).toContain('المتاح');
    expect((await hold(store, variantId, 1)).statusCode).toBe(201);
    // Nothing left now
    expect((await hold(store, variantId, 1)).statusCode).toBe(400);
  });

  it('selling the hold consumes the reservation: the stock moves once, by the sale', async () => {
    const store = await openStore(app);
    const { productId, variantId } = await dress(store);
    await hold(store, variantId, 2);
    const [held] = await ordersBox(store);
    expect(await stockPage(store, productId)).toEqual({ qty: 3000, reserved: 2000, available: 1000 });

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(store.userId));
    const sold = doc(
      'sale',
      sale(store, open.id, {
        onlineOrderId: held!.id,
        lines: [cartLine(1, 900_000, { productId, variantId, qty: 2000 })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 1_800_000 }],
      }),
    );
    const res = await push(app, store.device, [open, sold]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    expect((await ordersBox(store))[0]).toMatchObject({ status: 'done' });
    // 3 - 2 sold = 1 on hand, nothing reserved, 1 available: the piece is not counted twice
    expect(await stockPage(store, productId)).toEqual({ qty: 1000, reserved: 0, available: 1000 });
    const { report } = await books(store.tenantId);
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('tells the till what each hold keeps, and where, through its own pull', async () => {
    const store = await openStore(app);
    const { variantId } = await dress(store);
    await hold(store, variantId, 2);
    await settled();
    const page = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: store.device.authorization },
    });
    const rows = (
      page.json<PullResponse>().sets as unknown as { online_orders: { upserts: OnlineOrderRow[] } }
    ).online_orders.upserts;
    expect(rows[0]).toMatchObject({
      status: 'accepted',
      branchId: store.device.branchId,
      reservedUntil: expect.any(String),
      lines: [{ variantId, qty: 2 }],
    });
  });
});

describe('decision 15: a product made at the till for an unknown barcode', () => {
  const add = (store: Store, actorId: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/device/products',
      headers: { authorization: store.device.authorization },
      payload: {
        actorId,
        nameAr: 'قميص أزرق',
        priceMinor: 450_000,
        categoryId: null,
        barcode: '6291041500213',
        ...extra,
      },
    });

  it('lets whoever manages the catalog add it, through the product API’s own write, awaiting review', async () => {
    const store = await openStore(app);
    const res = await add(store, store.userId);
    expect(res.statusCode, res.body).toBe(201);
    const placed = res.json<TillProductPlaced>();
    expect(placed).toMatchObject({ nameAr: 'قميص أزرق', barcode: '6291041500213' });
    const detail = (
      await app.inject({ method: 'GET', url: `/v1/products/${placed.productId}`, headers: as(store) })
    ).json<ProductDetail>();
    expect(detail.status).toBe('temporary');
    // The owner reviews it: «اعتمد الصنف» makes it active, and nothing else can be set this way
    const approved = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${placed.productId}`,
      headers: as(store),
      payload: { version: detail.version, status: 'active' },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json<ProductDetail>().status).toBe('active');
    const refused = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${placed.productId}`,
      headers: as(store),
      payload: { version: approved.json<ProductDetail>().version, status: 'temporary' },
    });
    expect(refused.statusCode).toBe(400);
    expect(detail.variants[0]).toMatchObject({
      price: { currency: 'SYP', priceMinor: 450_000 },
      barcodes: [expect.objectContaining({ code: '6291041500213' })],
    });
    // The barcode now finds it, like any other product's
    const found = await app.inject({
      method: 'GET',
      url: '/v1/barcodes/6291041500213',
      headers: as(store),
    });
    expect(found.statusCode, found.body).toBe(200);
    // Audited twice: the product's own entry and the till's
    const audits = await ownerDb()<{ action: string }[]>`
      select action from audit_logs where entity = 'product' order by created_at`;
    expect(audits.map((a) => a.action)).toEqual([
      'product.created',
      'product.created_at_till',
      'product.updated',
    ]);
  });

  it('refuses a cashier, and takes a manager’s code as the manager signing it', async () => {
    const store = await openStore(app);
    const branchId = store.device.branchId;
    const owned = {
      tenantId: store.tenantId,
      userId: store.userId,
      accessToken: store.accessToken,
      branchId,
    };
    const cashier = await staffUser(app, owned, 'cashier', '0955333444', { branchId });
    const manager = await staffUser(app, owned, 'manager', '0955333555', { branchId });
    const refused = await add(store, cashier.userId);
    expect(refused.statusCode).toBe(403);
    expect(await ownerDb()`select 1 from products`).toHaveLength(0);
    expect((await add(store, manager.userId)).statusCode).toBe(201);
    // Nobody the store knows
    const stranger = await add(store, '0194c8a0-0000-7000-8000-000000000001', { barcode: '6291041500220' });
    expect(stranger.statusCode).toBe(403);
  });

  it('refuses a barcode the store already has, a price of zero and a name left empty', async () => {
    const store = await openStore(app);
    expect((await add(store, store.userId)).statusCode).toBe(201);
    const twice = await add(store, store.userId);
    expect(twice.statusCode).toBe(409);
    expect((await add(store, store.userId, { barcode: '6291041500220', priceMinor: 0 })).statusCode).toBe(
      400,
    );
    expect((await add(store, store.userId, { barcode: '6291041500220', nameAr: '  ' })).statusCode).toBe(400);
    expect(await ownerDb()`select 1 from products`).toHaveLength(1);
  });
});
