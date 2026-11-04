import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUuidV7, parseSnapshot, payloadHash, type SyncDocumentBody } from '@serva/sync';
import { createDevice, deviceFields, firstBranch } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * Every route is classified here. A new route fails this file until it is: public routes are
 * listed on purpose, signed-in routes must refuse a missing token, and any route that takes an id
 * must get an IDOR case below (another store's id must answer 404), per 17 «الصلاحية في الخادم».
 * Device routes take no id: the store comes from the device token alone, and each gets a probe
 * that another store's device can neither see nor touch this store's data.
 */
const ROUTES: Record<string, 'public' | 'signed-in' | 'device' | 'activation' | 'platform'> = {
  'GET /health': 'public',
  'GET /v1/meta': 'public',
  'POST /v1/auth/register': 'public',
  'POST /v1/auth/register/verify': 'public',
  'POST /v1/auth/login': 'public',
  'POST /v1/auth/refresh': 'public',
  'POST /v1/auth/logout': 'public',
  'GET /v1/me': 'signed-in',
  'PUT /v1/me/pin': 'signed-in',
  'GET /v1/store': 'signed-in',
  'GET /v1/customers': 'signed-in',
  'POST /v1/customers': 'signed-in',
  'GET /v1/customers/:id': 'signed-in',
  'GET /v1/customers/:id/purchases': 'signed-in',
  'GET /v1/device/customers/:id/purchases': 'device',
  'PUT /v1/customers/:id': 'signed-in',
  'GET /v1/suppliers': 'signed-in',
  'POST /v1/suppliers': 'signed-in',
  'PUT /v1/suppliers/:id': 'signed-in',
  'GET /v1/purchases': 'signed-in',
  'POST /v1/purchases': 'signed-in',
  'GET /v1/purchases/:id': 'signed-in',
  'POST /v1/supplier-payments': 'signed-in',
  'GET /v1/inventory': 'signed-in',
  'GET /v1/inventory/expiry': 'signed-in',
  'GET /v1/serials': 'signed-in',
  'POST /v1/stocktakes': 'signed-in',
  'GET /v1/reports/profit': 'signed-in',
  'GET /v1/subscription': 'signed-in',
  'POST /v1/subscription/invoices': 'signed-in',
  'POST /v1/subscription/payments': 'signed-in',
  'POST /v1/platform/login': 'public',
  'GET /v1/platform/stores': 'platform',
  'PUT /v1/platform/stores/:id/subscription': 'platform',
  'GET /v1/platform/payments': 'platform',
  'POST /v1/platform/payments/:id/confirm': 'platform',
  'POST /v1/platform/payments/:id/reject': 'platform',
  'GET /v1/platform/plans': 'platform',
  'PUT /v1/platform/plans/:code': 'platform',
  'GET /v1/platform/settings': 'platform',
  'PUT /v1/platform/settings': 'platform',
  'PUT /v1/store/profile': 'signed-in',
  'PUT /v1/store/currency': 'signed-in',
  'PUT /v1/store/onboarding': 'signed-in',
  'PUT /v1/store/scale': 'signed-in',
  'PUT /v1/store/service': 'signed-in',
  'GET /v1/promotions': 'signed-in',
  'POST /v1/promotions': 'signed-in',
  'PUT /v1/promotions/:id': 'signed-in',
  'GET /v1/cheques': 'signed-in',
  'POST /v1/cheques/actions': 'signed-in',
  'POST /v1/device/staff-sessions': 'device',
  'POST /v1/device/holds': 'device',
  'POST /v1/sync/push': 'device',
  'GET /v1/sync/pull': 'device',
  'POST /v1/sync/resync': 'device',
  'POST /v1/sync/heartbeat': 'device',
  'GET /v1/sync/bootstrap': 'device',
  'GET /v1/sync/snapshots/:id': 'device',
  'POST /v1/devices/pairing-codes': 'signed-in',
  // The pairing code is the proof (rate limited); the owner method needs a Bearer token.
  'POST /v1/devices/activate': 'public',
  // A waiting device: `Authorization: Activation <secret>`
  'GET /v1/devices/activations/:id': 'activation',
  'GET /v1/devices': 'signed-in',
  'PATCH /v1/devices/:id': 'signed-in',
  'POST /v1/devices/:id/approve': 'signed-in',
  'POST /v1/devices/:id/reject': 'signed-in',
  'POST /v1/devices/:id/revoke': 'signed-in',
  'GET /v1/products': 'signed-in',
  'POST /v1/products': 'signed-in',
  'GET /v1/products/:id': 'signed-in',
  'GET /v1/products/options': 'signed-in',
  'PUT /v1/store/loyalty': 'signed-in',
  'GET /v1/transfers': 'signed-in',
  'GET /v1/supplier-returns': 'signed-in',
  'POST /v1/supplier-returns': 'signed-in',
  'POST /v1/transfers': 'signed-in',
  'POST /v1/prices/bulk': 'signed-in',
  'GET /v1/products/:id/images': 'signed-in',
  'POST /v1/products/:id/images': 'signed-in',
  'POST /v1/products/:id/images/order': 'signed-in',
  'PATCH /v1/products/:id/images/:imageId': 'signed-in',
  'DELETE /v1/products/:id/images/:imageId': 'signed-in',
  'GET /v1/images/:tenantId/:imageId': 'public',
  'GET /v1/shop/:slug': 'public',
  'GET /v1/shop/:slug/products/:id': 'public',
  'POST /v1/shop/:slug/orders': 'public',
  'POST /v1/shop/:slug/orders/code': 'public',
  'GET /v1/shop/:slug/orders/:token': 'public',
  'GET /v1/online-store': 'signed-in',
  'PUT /v1/online-store': 'signed-in',
  'GET /v1/online-orders': 'signed-in',
  'POST /v1/online-orders/:id/status': 'signed-in',
  'PATCH /v1/products/:id': 'signed-in',
  'POST /v1/products/:id/archive': 'signed-in',
  'POST /v1/products/:id/restore': 'signed-in',
  'GET /v1/barcodes/:code': 'signed-in',
  'GET /v1/categories': 'signed-in',
  'POST /v1/categories': 'signed-in',
  'PATCH /v1/categories/:id': 'signed-in',
  'GET /v1/units': 'signed-in',
  'POST /v1/units': 'signed-in',
  'PATCH /v1/units/:id': 'signed-in',
  'GET /v1/tax-rates': 'signed-in',
  'POST /v1/tax-rates': 'signed-in',
  'PATCH /v1/tax-rates/:id': 'signed-in',
  'GET /v1/accounts': 'signed-in',
  'GET /v1/reports/day': 'signed-in',
  'GET /v1/reports/merchandise': 'signed-in',
  'GET /v1/shifts': 'signed-in',
  'GET /v1/shifts/:id': 'signed-in',
  'GET /v1/journal': 'signed-in',
  'GET /v1/reports/trial-balance': 'signed-in',
  'GET /v1/sync/evidence': 'signed-in',
};

interface Stores {
  a: { tenantId: string; accessToken: string };
  b: { tenantId: string; accessToken: string };
}

const owner = (store: { accessToken: string }) => ({ authorization: `Bearer ${store.accessToken}` });

/** A device of store A waiting for approval, linked with a typed code. */
async function pendingDevice(app: FastifyInstance, a: Stores['a']) {
  const pairing = await app.inject({
    method: 'POST',
    url: '/v1/devices/pairing-codes',
    headers: owner(a),
    payload: { branchId: await firstBranch(a.tenantId) },
  });
  const { storeCode, manualCode } = pairing.json<{ storeCode: string; manualCode: string }>();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/devices/activate',
    payload: { method: 'code', storeCode, manualCode, ...deviceFields() },
  });
  return res.json<{ activationId: string; activationSecret: string }>();
}

const deviceRow = async (id: string) =>
  (
    await ownerDb()<{ name: string; status: string; version: number }[]>`
      select name, status, version from devices where id = ${id}`
  )[0];

/** Store B's owner acting on store A's device: 404, and the device is untouched. */
function deviceIdor(path: (id: string) => string, method: 'PATCH' | 'POST') {
  return async (app: FastifyInstance, { a, b }: Stores) => {
    for (const target of [
      await createDevice(a.tenantId),
      { deviceId: (await pendingDevice(app, a)).activationId },
    ]) {
      const before = await deviceRow(target.deviceId);
      const res = await app.inject({
        method,
        url: path(target.deviceId),
        headers: owner(b),
        ...(method === 'PATCH' ? { payload: { name: 'مسروق', version: before!.version } } : {}),
      });
      expect(res.statusCode, `${method} ${path(':id')}`).toBe(404);
      expect(await deviceRow(target.deviceId)).toEqual(before);
    }
  };
}

let productCount = 0;
/** A product of store A with one barcode, made through its owner. */
async function productOf(app: FastifyInstance, a: Stores['a'], code = `IDOR-1${++productCount}`) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: owner(a),
    payload: {
      nameAr: 'منتج المتجر أ',
      variants: [{ price: { currency: 'SYP', priceMinor: 100 }, barcodes: [{ kind: 'standard', code }] }],
    },
  });
  return res.json<{ id: string; version: number; variants: { id: string }[] }>();
}

const catalogRow = async (table: string, id: string) =>
  (
    await ownerDb()<{ version: number; archived_at: Date | null }[]>`
    select version, archived_at from ${ownerDb()(table)} where id = ${id}`
  )[0];

/** Store B's owner acting on a catalog record of store A: 404, and the record is untouched. */
function catalogIdor(
  table: string,
  make: (app: FastifyInstance, a: Stores['a']) => Promise<{ id: string }>,
  method: 'GET' | 'PATCH' | 'POST',
  path: (id: string) => string,
) {
  return async (app: FastifyInstance, { a, b }: Stores) => {
    const record = await make(app, a);
    const before = await catalogRow(table, record.id);
    const res = await app.inject({
      method,
      url: path(record.id),
      headers: owner(b),
      ...(method === 'PATCH'
        ? { payload: { version: before!.version, name: 'مسروق', nameAr: 'مسروق' } }
        : {}),
    });
    expect(res.statusCode, `${method} ${path(':id')}`).toBe(404);
    expect(await catalogRow(table, record.id)).toEqual(before);
  };
}

const makeReference =
  (url: string, payload: Record<string, unknown>) => async (app: FastifyInstance, a: Stores['a']) =>
    (await app.inject({ method: 'POST', url, headers: owner(a), payload })).json<{ id: string }>();

/** Routes with an id in the path, each with a probe using another store's record. */
/** Store B's owner on store A's customer: 404, and the customer is untouched. */
function customerIdor(method: 'GET' | 'PUT') {
  return async (app: FastifyInstance, { a, b }: Stores) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: owner(a),
      payload: { name: 'زبون أ' },
    });
    const id = made.json<{ id: string }>().id;
    const res = await app.inject({
      method,
      url: `/v1/customers/${id}`,
      headers: owner(b),
      ...(method === 'PUT' ? { payload: { name: 'مسروق' } } : {}),
    });
    expect(res.statusCode, `${method} /v1/customers/:id`).toBe(404);
    const [row] = await ownerDb()<{ name: string }[]>`select name from customers where id = ${id}`;
    expect(row!.name).toBe('زبون أ');
  };
}

/** Store B's owner on store A's supplier and purchase: 404, nothing changed. */
async function supplierOf(app: FastifyInstance, a: Stores['a']) {
  const made = await app.inject({
    method: 'POST',
    url: '/v1/suppliers',
    headers: owner(a),
    payload: { name: 'مورد أ' },
  });
  return made.json<{ id: string }>().id;
}

/** A product of store A with one picture */
async function pictureOf(app: FastifyInstance, a: Stores['a']) {
  const product = await productOf(app, a);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
  const res = await app.inject({
    method: 'POST',
    url: `/v1/products/${product.id}/images`,
    headers: owner(a),
    payload: { contentType: 'image/jpeg', data: jpeg, thumb: jpeg, width: 10, height: 10 },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { productId: product.id, image: res.json<{ id: string; uploadId: string; version: number }>() };
}

/** Store B reaches none of store A's pictures, and A's still has its one */
const imageIdor =
  (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: (productId: string, imageId: string) => string,
    payload?: (version: number, imageId: string) => unknown,
  ) =>
  async (app: FastifyInstance, { a, b }: Stores) => {
    const { productId, image } = await pictureOf(app, a);
    const res = await app.inject({
      method,
      url: path(productId, image.id),
      headers: owner(b),
      ...(payload ? { payload: payload(image.version, image.id) as Record<string, unknown> } : {}),
    });
    expect(res.statusCode, `${method} ${path(':id', ':imageId')}`).toBe(404);
    const mine = await app.inject({
      method: 'GET',
      url: `/v1/products/${productId}/images`,
      headers: owner(a),
    });
    expect(mine.json<{ items: { id: string; version: number }[] }>().items).toEqual([
      expect.objectContaining({ id: image.id, version: image.version }),
    ]);
  };

/** Both stores' shops on: A on «a-shop» with a product on its shelf, B on «b-shop» */
async function twoShops(app: FastifyInstance, { a, b }: Stores) {
  for (const [store, slug] of [
    [a, 'a-shop'],
    [b, 'b-shop'],
  ] as const) {
    const now = await app.inject({ method: 'GET', url: '/v1/online-store', headers: owner(store) });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/online-store',
      headers: owner(store),
      payload: {
        version: now.json<{ version: number | null }>().version,
        enabled: true,
        slug,
        whatsapp: '0933123456',
        delivery: true,
        pickup: true,
        note: null,
        showOutOfStock: true,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  return productOf(app, a);
}

const IDOR_PROBES: Record<string, (app: FastifyInstance, stores: Stores) => Promise<void>> = {
  'GET /v1/shop/:slug': async (app, stores) => {
    const product = await twoShops(app, stores);
    const b = await app.inject({ method: 'GET', url: '/v1/shop/b-shop' });
    expect(b.statusCode).toBe(200);
    expect(JSON.stringify(b.json())).not.toContain(product.id);
    expect((await app.inject({ method: 'GET', url: '/v1/shop/no-such-shop' })).statusCode).toBe(404);
  },
  'GET /v1/shop/:slug/products/:id': async (app, stores) => {
    const product = await twoShops(app, stores);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/shop/a-shop/products/${product.id}` })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/shop/b-shop/products/${product.id}` })).statusCode,
    ).toBe(404);
  },
  'POST /v1/shop/:slug/orders': async (app, stores) => {
    const product = await twoShops(app, stores);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shop/b-shop/orders',
      payload: {
        name: 'زبون',
        phone: '0944555666',
        fulfilment: 'pickup',
        lines: [{ variantId: product.variants[0]!.id, qty: 1 }],
      },
    });
    // A's piece is not B's: refused, and nothing is saved for B
    expect(res.statusCode).toBe(400);
    const box = await app.inject({ method: 'GET', url: '/v1/online-orders', headers: owner(stores.b) });
    expect(box.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'POST /v1/shop/:slug/orders/code': async (app, stores) => {
    await twoShops(app, stores);
    const ask = (slug: string) =>
      app.inject({ method: 'POST', url: `/v1/shop/${slug}/orders/code`, payload: { phone: '0944555666' } });
    // Both shops take orders on WhatsApp: no code is sent for either, nor for a shop that is not there
    expect((await ask('b-shop')).statusCode).toBe(400);
    expect((await ask('no-such-shop')).statusCode).toBe(404);
  },
  'GET /v1/shop/:slug/orders/:token': async (app, stores) => {
    await twoShops(app, stores);
    const service = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: owner(stores.a),
      payload: {
        nameAr: 'تقصير',
        type: 'service',
        variants: [{ price: { currency: 'SYP', priceMinor: 100 } }],
      },
    });
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/shop/a-shop/orders',
      payload: {
        name: 'زبون',
        phone: '0944555666',
        fulfilment: 'pickup',
        lines: [{ variantId: service.json<{ variants: { id: string }[] }>().variants[0]!.id, qty: 1 }],
      },
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const token = placed.json<{ trackPath: string }>().trackPath.split('/').at(-1)!;
    const at = (slug: string) => app.inject({ method: 'GET', url: `/v1/shop/${slug}/orders/${token}` });
    expect((await at('a-shop')).statusCode).toBe(200);
    // A's order is not on B's link
    expect((await at('b-shop')).statusCode).toBe(404);
  },
  'POST /v1/online-orders/:id/status': async (app, stores) => {
    const product = await twoShops(app, stores);
    // A's shirt has no stock and the shop shows what ran out, but it cannot be ordered: use a service
    const service = await app.inject({
      method: 'POST',
      url: '/v1/products',
      headers: owner(stores.a),
      payload: {
        nameAr: 'تقصير',
        type: 'service',
        variants: [{ price: { currency: 'SYP', priceMinor: 100 } }],
      },
    });
    expect(service.statusCode, service.body).toBe(201);
    const placed = await app.inject({
      method: 'POST',
      url: '/v1/shop/a-shop/orders',
      payload: {
        name: 'زبون',
        phone: '0944555666',
        fulfilment: 'pickup',
        lines: [{ variantId: service.json<{ variants: { id: string }[] }>().variants[0]!.id, qty: 1 }],
      },
    });
    expect(placed.statusCode, placed.body).toBe(201);
    expect(product.id).toBeDefined();
    const mine = await app.inject({ method: 'GET', url: '/v1/online-orders', headers: owner(stores.a) });
    const [target] = mine.json<{ items: { id: string; version: number; status: string }[] }>().items;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${target!.id}/status`,
      headers: owner(stores.b),
      payload: { status: 'rejected', version: target!.version },
    });
    expect(res.statusCode).toBe(404);
    const after = await app.inject({ method: 'GET', url: '/v1/online-orders', headers: owner(stores.a) });
    expect(after.json<{ items: { status: string }[] }>().items[0]!.status).toBe('pending');
  },
  'GET /v1/products/:id/images': imageIdor('GET', (p) => `/v1/products/${p}/images`),
  'POST /v1/products/:id/images': imageIdor(
    'POST',
    (p) => `/v1/products/${p}/images`,
    () => ({
      contentType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 0xff, 9]).toString('base64'),
      thumb: Buffer.from([0xff, 0xd8, 0xff, 9]).toString('base64'),
      width: 1,
      height: 1,
    }),
  ),
  'POST /v1/products/:id/images/order': imageIdor(
    'POST',
    (p) => `/v1/products/${p}/images/order`,
    (_version, imageId) => ({ ids: [imageId] }),
  ),
  'PATCH /v1/products/:id/images/:imageId': imageIdor(
    'PATCH',
    (p, i) => `/v1/products/${p}/images/${i}`,
    (version) => ({ version, optionValue: 'مسروق' }),
  ),
  'DELETE /v1/products/:id/images/:imageId': imageIdor('DELETE', (p, i) => `/v1/products/${p}/images/${i}`),
  'GET /v1/images/:tenantId/:imageId': async (app, { a, b }) => {
    const { image } = await pictureOf(app, a);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/images/${a.tenantId}/${image.uploadId}` })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/v1/images/${b.tenantId}/${image.uploadId}` })).statusCode,
    ).toBe(404);
  },
  'PUT /v1/promotions/:id': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: owner(a),
      payload: { name: 'عرض أ', kind: 'percent', percentBp: 500, scope: 'all' },
    });
    const { id } = made.json<{ id: string }>();
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/promotions/${id}`,
      headers: owner(b),
      payload: { version: 1, name: 'مسروق', kind: 'percent', percentBp: 9000, scope: 'all' },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<{ name: string }[]>`select name from promotions where id = ${id}`;
    expect(row!.name).toBe('عرض أ');
  },
  'PUT /v1/suppliers/:id': async (app, { a, b }) => {
    const id = await supplierOf(app, a);
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/suppliers/${id}`,
      headers: owner(b),
      payload: { name: 'مسروق' },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<{ name: string }[]>`select name from suppliers where id = ${id}`;
    expect(row!.name).toBe('مورد أ');
  },
  'GET /v1/purchases/:id': async (app, { a, b }) => {
    const supplierId = await supplierOf(app, a);
    const product = await productOf(app, a);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: owner(a),
      payload: {
        supplierId,
        date: '2026-10-30',
        payment: 'credit',
        lines: [{ variantId: product.variants[0]!.id, qty: 1000, costMinor: 100 }],
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/purchases/${made.json<{ id: string }>().id}`,
      headers: owner(b),
    });
    expect(res.statusCode).toBe(404);
  },
  'GET /v1/customers/:id': customerIdor('GET'),
  'GET /v1/customers/:id/purchases': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: owner(a),
      payload: { name: 'زبون أ' },
    });
    const id = made.json<{ id: string }>().id;
    const res = await app.inject({ method: 'GET', url: `/v1/customers/${id}/purchases`, headers: owner(b) });
    expect(res.statusCode).toBe(404);
  },
  'GET /v1/device/customers/:id/purchases': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: owner(a),
      payload: { name: 'زبون أ' },
    });
    const id = made.json<{ id: string }>().id;
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/customers/${id}/purchases`,
      headers: { authorization: deviceB.authorization },
    });
    expect(res.statusCode).toBe(404);
  },
  'PUT /v1/customers/:id': customerIdor('PUT'),
  'GET /v1/products/:id': catalogIdor('products', productOf, 'GET', (id) => `/v1/products/${id}`),
  'PATCH /v1/products/:id': catalogIdor('products', productOf, 'PATCH', (id) => `/v1/products/${id}`),
  'POST /v1/products/:id/archive': catalogIdor(
    'products',
    productOf,
    'POST',
    (id) => `/v1/products/${id}/archive`,
  ),
  'POST /v1/products/:id/restore': catalogIdor(
    'products',
    productOf,
    'POST',
    (id) => `/v1/products/${id}/restore`,
  ),
  'PATCH /v1/categories/:id': catalogIdor(
    'categories',
    makeReference('/v1/categories', { name: 'تصنيف أ' }),
    'PATCH',
    (id) => `/v1/categories/${id}`,
  ),
  'PATCH /v1/units/:id': catalogIdor(
    'units',
    makeReference('/v1/units', { name: 'متر', symbol: 'م' }),
    'PATCH',
    (id) => `/v1/units/${id}`,
  ),
  'PATCH /v1/tax-rates/:id': catalogIdor(
    'tax_rates',
    makeReference('/v1/tax-rates', { name: 'طابع', rateBp: 100, kind: 'stamp' }),
    'PATCH',
    (id) => `/v1/tax-rates/${id}`,
  ),
  // Store B looking up store A's barcode finds nothing, even though barcodes are only unique per store.
  'GET /v1/barcodes/:code': async (app, { a, b }) => {
    await productOf(app, a, 'IDOR-0002');
    const res = await app.inject({ method: 'GET', url: '/v1/barcodes/IDOR-0002', headers: owner(b) });
    expect(res.statusCode).toBe(404);
    // Store B may hold the same code for its own product.
    expect((await productOf(app, b, 'IDOR-0002')).id).toBeDefined();
  },
  'PATCH /v1/devices/:id': deviceIdor((id) => `/v1/devices/${id}`, 'PATCH'),
  'POST /v1/devices/:id/approve': deviceIdor((id) => `/v1/devices/${id}/approve`, 'POST'),
  'POST /v1/devices/:id/reject': deviceIdor((id) => `/v1/devices/${id}/reject`, 'POST'),
  'POST /v1/devices/:id/revoke': deviceIdor((id) => `/v1/devices/${id}/revoke`, 'POST'),
  // The poll secret of a device of store B never reads store A's waiting device.
  'GET /v1/devices/activations/:id': async (app, { a, b }) => {
    const deviceA = await pendingDevice(app, a);
    const deviceB = await pendingDevice(app, b);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/devices/activations/${deviceA.activationId}`,
      headers: { authorization: `Activation ${deviceB.activationSecret}` },
    });
    expect(res.statusCode).toBe(401);
  },
  // Store B's owner asking for store A's shift report: 404, nothing of store A in the answer.
  'GET /v1/shifts/:id': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const [userA] = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${a.tenantId}`;
    const shiftId = createUuidV7()();
    await ownerDb()`insert into shifts (tenant_id, id, branch_id, device_id, number, opened_by, opened_at)
      values (${a.tenantId}, ${shiftId}, ${deviceA.branchId}, ${deviceA.deviceId}, 'SFT-001-002-0000001',
              ${userA!.id}, now())`;
    const own = await app.inject({ method: 'GET', url: `/v1/shifts/${shiftId}`, headers: owner(a) });
    expect(own.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: `/v1/shifts/${shiftId}`, headers: owner(b) });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('SFT-001-002');
  },
  'GET /v1/sync/snapshots/:id': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const boot = await app.inject({
      method: 'GET',
      url: '/v1/sync/bootstrap',
      headers: { authorization: deviceA.authorization },
    });
    const res = await app.inject({
      method: 'GET',
      url: boot.json<{ url: string }>().url,
      headers: { authorization: deviceB.authorization },
    });
    expect(res.statusCode).toBe(404);
  },
};

/** Device routes: store B's device acting on store A's ids gets nothing of store A. */
const DEVICE_SCOPE_PROBES: Record<string, (app: FastifyInstance, stores: Stores) => Promise<void>> = {
  'POST /v1/sync/push': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const body: SyncDocumentBody = {
      id: createUuidV7()(),
      seq: 1,
      type: 'cart_event',
      number: null,
      deviceTime: '2026-10-30T09:00:00.000Z',
      businessDate: '2026-10-30',
      deviceOffsetMs: 0,
      engineVersion: '1',
      contractVersion: 1,
      deps: [],
      payload: { name: 'A' },
    };
    const send = (authorization: string, payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: { authorization },
        payload: {
          contractVersion: 1,
          appVersion: '1',
          sentAt: '2026-10-30T09:00:00.000Z',
          documents: [{ ...body, payload, hash: payloadHash({ ...body, payload }) }],
        },
      });
    expect((await send(deviceA.authorization, { name: 'A' })).json().results[0].status).toBe('accepted');
    // Same id from store B: a document of store B, never a conflict with (or a read of) store A's.
    const fromB = await send(deviceB.authorization, { name: 'B' });
    expect(fromB.json().results[0].status).toBe('accepted');
    const rows = await ownerDb()<{ tenant_id: string; device_id: string }[]>`
      select tenant_id, device_id from sync_inbox where doc_id = ${body.id} order by tenant_id = ${a.tenantId} desc`;
    expect(rows).toEqual([
      { tenant_id: a.tenantId, device_id: deviceA.deviceId },
      { tenant_id: b.tenantId, device_id: deviceB.deviceId },
    ]);
  },
  'GET /v1/sync/pull': async (app, { a, b }) => {
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: deviceB.authorization },
    });
    const text = res.body;
    expect(res.json().sets.settings.upserts.map((s: { id: string }) => s.id)).toEqual([b.tenantId]);
    expect(text).not.toContain(a.tenantId);
    const [userA] = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${a.tenantId}`;
    expect(text).not.toContain(userA!.id);
  },
  'POST /v1/sync/resync': async (app, { b }) => {
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/resync',
      headers: { authorization: deviceB.authorization },
      payload: { sets: ['users'] },
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().sets)).toEqual(['users']);
  },
  'POST /v1/sync/heartbeat': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/heartbeat',
      headers: { authorization: deviceB.authorization },
      payload: {
        contractVersion: 1,
        appVersion: '1',
        sentAt: '2026-10-30T09:00:00.000Z',
        lastIssued: { INV: 5 },
        unsentCount: 7,
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = await ownerDb()<{ device_id: string }[]>`select device_id from doc_sequences`;
    expect(rows.map((r) => r.device_id)).toEqual([deviceB.deviceId]);
    const [rowA] = await ownerDb()<{ unsent_count: number | null }[]>`
      select unsent_count from devices where id = ${deviceA.deviceId}`;
    expect(rowA!.unsent_count).toBeNull();
  },
  'GET /v1/sync/bootstrap': async (app, { a, b }) => {
    const deviceB = await createDevice(b.tenantId);
    const boot = await app.inject({
      method: 'GET',
      url: '/v1/sync/bootstrap',
      headers: { authorization: deviceB.authorization },
    });
    const file = await app.inject({
      method: 'GET',
      url: boot.json<{ url: string }>().url,
      headers: { authorization: deviceB.authorization },
    });
    const text = gunzipSync(file.rawPayload).toString('utf8');
    expect(parseSnapshot(text).sets.settings!.map((s) => s.id)).toEqual([b.tenantId]);
    expect(text).not.toContain(a.tenantId);
  },
  // Store B's device typing the right PIN of store A's owner: refused, and store A records nothing.
  'POST /v1/device/staff-sessions': async (app, { a, b }) => {
    const set = await app.inject({
      method: 'PUT',
      url: '/v1/me/pin',
      headers: owner(a),
      payload: { pin: '285713', password: 'secret-pass-1' },
    });
    expect(set.statusCode).toBe(204);
    const [userA] = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${a.tenantId}`;
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/staff-sessions',
      headers: { authorization: deviceB.authorization },
      payload: { userId: userA!.id, pin: '285713' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('المالك');
    const [attempts] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from pin_attempts where tenant_id = ${a.tenantId}`;
    expect(attempts!.n).toBe(0);
  },
  // Store B's device holding store A's piece: refused, and neither store has a hold
  'POST /v1/device/holds': async (app, { a, b }) => {
    const product = await productOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/holds',
      headers: { authorization: deviceB.authorization },
      payload: {
        customerName: 'زبون',
        phone: '0944555666',
        depositCode: null,
        lines: [{ variantId: product.variants[0]!.id, qty: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
    const [n] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from online_orders`;
    expect(n!.n).toBe(0);
  },
  'GET /v1/sync/snapshots/:id': async (app, { a, b }) => {
    await IDOR_PROBES['GET /v1/sync/snapshots/:id']!(app, { a, b });
  },
  'GET /v1/device/customers/:id/purchases': async (app, { a, b }) => {
    await IDOR_PROBES['GET /v1/device/customers/:id/purchases']!(app, { a, b });
  },
};

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

const registeredRoutes = () => [...app.routeList].sort();

async function twoStores(): Promise<Stores> {
  const a = (await registerStore(app, { phone: '0911111111' })).body;
  const b = (await registerStore(app, { phone: '0922222222' })).body;
  return {
    a: { tenantId: a.tenant.id as string, accessToken: a.accessToken as string },
    b: { tenantId: b.tenant.id as string, accessToken: b.accessToken as string },
  };
}

describe('route registry', () => {
  it('every route is classified', () => {
    expect(registeredRoutes()).toEqual(Object.keys(ROUTES).sort());
  });

  it('signed-in routes refuse a missing or forged token', async () => {
    for (const [route, access] of Object.entries(ROUTES)) {
      if (access !== 'signed-in') continue;
      const [method, url] = route.split(' ') as ['GET', string];
      for (const authorization of [undefined, 'Bearer forged']) {
        const res = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        expect(res.statusCode, `${route} ${authorization ?? 'no token'}`).toBe(401);
      }
    }
  });

  it('device routes refuse a missing token, a forged one and a signed-in user’s token', async () => {
    const { body } = await registerStore(app);
    for (const [route, access] of Object.entries(ROUTES)) {
      if (access !== 'device') continue;
      const [method, url] = route.split(' ') as ['GET', string];
      for (const authorization of [undefined, `Device sdt_${'x'.repeat(43)}`, `Bearer ${body.accessToken}`]) {
        const res = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        expect(res.statusCode, `${route} ${authorization ?? 'no token'}`).toBe(401);
      }
    }
  });

  it('platform routes refuse a missing token, a forged one and a store owner’s token', async () => {
    const { body } = await registerStore(app);
    for (const [route, access] of Object.entries(ROUTES)) {
      if (access !== 'platform') continue;
      const [method, url] = route.split(' ') as ['GET', string];
      for (const authorization of [undefined, 'Bearer forged', `Bearer ${body.accessToken}`]) {
        const res = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        expect(res.statusCode, `${route} ${authorization ?? 'no token'}`).toBe(401);
      }
    }
  });

  it('every device route has a cross-store probe', () => {
    const deviceRoutes = Object.entries(ROUTES)
      .filter(([, access]) => access === 'device')
      .map(([route]) => route);
    expect(deviceRoutes.sort()).toEqual(Object.keys(DEVICE_SCOPE_PROBES).sort());
  });

  it('device scope probes: another store’s device sees and touches nothing of this store', async () => {
    const stores = await twoStores();
    for (const probe of Object.values(DEVICE_SCOPE_PROBES)) await probe(app, stores);
  });

  it('every route with an id in its path has an IDOR probe', () => {
    // The platform panel sees every store by design: it has its own sign-in instead (above)
    const withIds = registeredRoutes().filter((r) => r.includes(':') && !r.includes('/v1/platform/'));
    expect(withIds.sort()).toEqual(Object.keys(IDOR_PROBES).sort());
  });

  it('IDOR probes: another store’s ids answer 404', async () => {
    const stores = await twoStores();
    for (const probe of Object.values(IDOR_PROBES)) await probe(app, stores);
  });

  it('the activation poll refuses a missing, malformed or unknown secret', async () => {
    for (const authorization of [
      undefined,
      'Activation nope',
      `Activation sda_${'x'.repeat(43)}`,
      'Bearer x',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/devices/activations/0192a000-0000-7000-8000-000000000001',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode, authorization ?? 'no secret').toBe(401);
    }
  });
});
