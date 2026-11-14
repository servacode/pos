import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUuidV7, parseSnapshot, payloadHash, type SyncDocumentBody } from '@serva/sync';
import { cartLine, documents, openStore, push, sale, shiftOpen } from './accounting-fixtures';
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
  'POST /v1/auth/forgot': 'public',
  'POST /v1/auth/forgot/reset': 'public',
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
  'GET /v1/device/subscription': 'device',
  'PUT /v1/customers/:id': 'signed-in',
  'POST /v1/customers/:id/payments': 'signed-in',
  'POST /v1/customers/:id/archive-duplicate': 'signed-in',
  'POST /v1/customers/:id/opening-debt': 'signed-in',
  'GET /v1/suppliers': 'signed-in',
  'POST /v1/suppliers': 'signed-in',
  'PUT /v1/suppliers/:id': 'signed-in',
  'GET /v1/purchases': 'signed-in',
  'POST /v1/purchases': 'signed-in',
  'GET /v1/purchases/:id': 'signed-in',
  'POST /v1/supplier-payments': 'signed-in',
  'GET /v1/inventory': 'signed-in',
  'GET /v1/inventory/expiry': 'signed-in',
  'GET /v1/batches/recall': 'signed-in',
  'POST /v1/batches/block': 'signed-in',
  'POST /v1/batches/unblock': 'signed-in',
  'GET /v1/serials': 'signed-in',
  'POST /v1/serials/fix': 'signed-in',
  'GET /v1/recipes/:productId': 'signed-in',
  'PUT /v1/recipes/:productId': 'signed-in',
  'GET /v1/reports/food-cost': 'signed-in',
  'GET /v1/warranty/lookup': 'signed-in',
  'GET /v1/warranty/claims': 'signed-in',
  'POST /v1/warranty/claims': 'signed-in',
  'POST /v1/warranty/claims/:id/status': 'signed-in',
  'GET /v1/rentals': 'signed-in',
  'GET /v1/maintenance': 'signed-in',
  'POST /v1/maintenance': 'signed-in',
  'POST /v1/maintenance/:id/visits': 'signed-in',
  'POST /v1/maintenance/:id/renew': 'signed-in',
  'GET /v1/contract-prices': 'signed-in',
  'POST /v1/contract-prices': 'signed-in',
  'PUT /v1/contract-prices/:id': 'signed-in',
  'DELETE /v1/contract-prices/:id': 'signed-in',
  'GET /v1/reports/debt-ageing': 'signed-in',
  'GET /v1/quotations': 'signed-in',
  'GET /v1/quotations/:id': 'signed-in',
  'POST /v1/quotations': 'signed-in',
  'PUT /v1/quotations/:id': 'signed-in',
  'POST /v1/quotations/:id/status': 'signed-in',
  'GET /v1/device/quotations': 'device',
  'GET /v1/device/quotations/:id': 'device',
  'POST /v1/device/quotations': 'device',
  'POST /v1/device/quotations/:id/convert': 'device',
  'POST /v1/stocktakes': 'signed-in',
  'POST /v1/import': 'signed-in',
  'GET /v1/export': 'signed-in',
  'GET /v1/reports/profit': 'signed-in',
  'GET /v1/subscription': 'signed-in',
  'POST /v1/subscription/invoices': 'signed-in',
  'POST /v1/subscription/payments': 'signed-in',
  'POST /v1/platform/login': 'public',
  'POST /v1/platform/login/code': 'public',
  'POST /v1/platform/login/password': 'public',
  'POST /v1/platform/login/enrol': 'public',
  'POST /v1/platform/login/enrol/confirm': 'public',
  'GET /v1/platform/2fa': 'platform',
  'POST /v1/platform/2fa/enrol': 'platform',
  'POST /v1/platform/2fa/enrol/confirm': 'platform',
  'GET /v1/platform/stores': 'platform',
  'PUT /v1/platform/stores/:id/subscription': 'platform',
  'GET /v1/platform/payments': 'platform',
  'POST /v1/platform/payments/:id/confirm': 'platform',
  'POST /v1/platform/payments/:id/reject': 'platform',
  'GET /v1/platform/plans': 'platform',
  'PUT /v1/platform/plans/:code': 'platform',
  'GET /v1/platform/settings': 'platform',
  'PUT /v1/platform/settings': 'platform',
  'GET /v1/platform/legal': 'platform',
  'PUT /v1/platform/legal': 'platform',
  'GET /v1/legal': 'public',
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
  'GET /v1/branches': 'signed-in',
  'POST /v1/branches': 'signed-in',
  'PATCH /v1/branches/:id': 'signed-in',
  'POST /v1/branches/:id/active': 'signed-in',
  'GET /v1/staff': 'signed-in',
  'POST /v1/staff': 'signed-in',
  'POST /v1/staff/pin-check': 'signed-in',
  'PATCH /v1/staff/:id': 'signed-in',
  'POST /v1/staff/:id/pin': 'signed-in',
  'POST /v1/staff/:id/deactivate': 'signed-in',
  'POST /v1/staff/:id/reactivate': 'signed-in',
  'POST /v1/device/holds': 'device',
  'POST /v1/broadcasts/preview': 'signed-in',
  'POST /v1/broadcasts': 'signed-in',
  'GET /v1/broadcasts': 'signed-in',
  'GET /v1/device/alterations': 'device',
  'POST /v1/device/alterations': 'device',
  'POST /v1/device/alterations/:id/status': 'device',
  'GET /v1/device/rentals': 'device',
  'GET /v1/device/rentals/units': 'device',
  'POST /v1/device/rentals': 'device',
  'POST /v1/device/rentals/:id/return': 'device',
  'GET /v1/device/maintenance': 'device',
  'POST /v1/device/maintenance/:id/billed': 'device',
  'GET /v1/device/contract-prices': 'device',
  'GET /v1/device/hall': 'device',
  'POST /v1/device/hall': 'device',
  'GET /v1/device/kitchen': 'device',
  'POST /v1/device/kitchen': 'device',
  'GET /v1/device/menu': 'device',
  'GET /v1/hall/cancellations': 'signed-in',
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
  'PUT /v1/store/pharmacy': 'signed-in',
  'PUT /v1/store/till': 'signed-in',
  'PUT /v1/store/catalog-options': 'signed-in',
  'GET /v1/device/invoices/lookup': 'device',
  'GET /v1/pharmacy/controlled-register': 'signed-in',
  'GET /v1/transfers': 'signed-in',
  'GET /v1/supplier-returns': 'signed-in',
  'POST /v1/supplier-returns': 'signed-in',
  'POST /v1/transfers': 'signed-in',
  'POST /v1/prices/bulk': 'signed-in',
  'POST /v1/prices/list/preview': 'signed-in',
  'POST /v1/prices/list/apply': 'signed-in',
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
  'POST /v1/shop/:slug/orders/:token/cancel-request': 'public',
  'GET /v1/online-store': 'signed-in',
  'PUT /v1/online-store': 'signed-in',
  'GET /v1/online-orders': 'signed-in',
  'POST /v1/online-orders/:id/status': 'signed-in',
  'GET /v1/online-orders/cod': 'signed-in',
  'POST /v1/online-orders/:id/delivery': 'signed-in',
  'PUT /v1/online-store/image/:slot': 'signed-in',
  'DELETE /v1/online-store/image/:slot': 'signed-in',
  'GET /v1/shop/:slug/coupon': 'public',
  'POST /v1/shop/:slug/products/:id/notify': 'public',
  'GET /v1/products/:id/shop-text': 'signed-in',
  'PUT /v1/products/:id/shop-text': 'signed-in',
  'GET /v1/products/:id/stock-alerts': 'signed-in',
  'POST /v1/stock-alerts/:id/notified': 'signed-in',
  'GET /v1/price-history': 'signed-in',
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
  'PUT /v1/tax-rates/default': 'signed-in',
  'GET /v1/accounts': 'signed-in',
  'GET /v1/reports/day': 'signed-in',
  'GET /v1/reports/merchandise': 'signed-in',
  'GET /v1/reports/sales-breakdown': 'signed-in',
  'GET /v1/shifts': 'signed-in',
  'GET /v1/shifts/:id': 'signed-in',
  'GET /v1/sales': 'signed-in',
  'GET /v1/sales/:id': 'signed-in',
  'GET /v1/journal': 'signed-in',
  'GET /v1/reports/trial-balance': 'signed-in',
  'GET /v1/customers/:id/statement': 'signed-in',
  'GET /v1/suppliers/:id/statement': 'signed-in',
  'GET /v1/expenses': 'signed-in',
  'POST /v1/expenses': 'signed-in',
  'POST /v1/expenses/:id/void': 'signed-in',
  'POST /v1/journal/manual': 'signed-in',
  'POST /v1/journal/:id/reverse': 'signed-in',
  'GET /v1/reports/profit-loss': 'signed-in',
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
function customerIdor(method: 'GET' | 'PUT' | 'POST', suffix = '', body?: Record<string, unknown>) {
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
      url: `/v1/customers/${id}${suffix}`,
      headers: owner(b),
      ...(method === 'PUT' ? { payload: { name: 'مسروق' } } : {}),
      ...(body ? { payload: body } : {}),
    });
    expect(res.statusCode, `${method} /v1/customers/:id${suffix}`).toBe(404);
    const [row] = await ownerDb()<{ name: string }[]>`select name from customers where id = ${id}`;
    expect(row!.name).toBe('زبون أ');
  };
}

/** Store B's owner on store A's branch: 404, and the branch is untouched. */
function branchIdor(url: (id: string) => string, method: 'PATCH' | 'POST', payload: Record<string, unknown>) {
  return async (app: FastifyInstance, { a, b }: Stores) => {
    // The store's own first branch: the plan may not allow a second one
    const [first] = await ownerDb()<{ id: string }[]>`
      select id from branches where tenant_id = ${a.tenantId} order by code limit 1`;
    const id = first!.id;
    const [before] = await ownerDb()<{ name: string; is_active: boolean }[]>`
      select name, is_active from branches where id = ${id}`;
    const res = await app.inject({ method, url: url(id), headers: owner(b), payload });
    expect(res.statusCode, `${method} ${url(':id')}`).toBe(404);
    const [row] = await ownerDb()<{ name: string; is_active: boolean }[]>`
      select name, is_active from branches where id = ${id}`;
    expect(row).toEqual(before);
  };
}

/** Store B's owner on store A's staff member: 404, and the person is untouched. */
function staffIdor(method: 'PATCH' | 'POST', suffix: string, payload?: Record<string, unknown>) {
  return async (app: FastifyInstance, { a, b }: Stores) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/staff',
      headers: owner(a),
      payload: { fullName: 'كاشير أ', roleKey: 'cashier', branchIds: null, pin: '4829' },
    });
    const id = made.json<{ id: string }>().id;
    const read = async () =>
      (
        await ownerDb()<
          { version: number; status: string }[]
        >`select version, status from users where id = ${id}`
      )[0];
    const before = await read();
    const res = await app.inject({
      method,
      url: `/v1/staff/${id}${suffix}`,
      headers: owner(b),
      ...(payload ? { payload } : {}),
    });
    expect(res.statusCode, `${method} /v1/staff/:id${suffix}`).toBe(404);
    expect(await read()).toEqual(before);
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

const QUOTATION = { lines: [{ name: 'قفازات', qty: 2000, unitPriceMinor: 10_000 }] };

/** Rows of store A's rentals, maintenance contracts and contract prices, written once per store straight into the tables */
const contractRows = new Map<string, ReturnType<typeof makeContractRows>>();
const contractRowsOf = (app: FastifyInstance, a: Stores['a']) => {
  if (!contractRows.has(a.tenantId)) contractRows.set(a.tenantId, makeContractRows(app, a));
  return contractRows.get(a.tenantId)!;
};
async function makeContractRows(app: FastifyInstance, a: Stores['a']) {
  const [branch] = await ownerDb()<{ id: string }[]>`
    select id from branches where tenant_id = ${a.tenantId} order by created_at limit 1`;
  const product = await productOf(app, a);
  const variantId = product.variants[0]!.id;
  const [rental] = await ownerDb()<{ id: string; version: number }[]>`
    insert into rentals (tenant_id, seq, number, branch_id, serial, variant_id, item, customer_name, customer_phone,
                         start_date, expected_return, rate_unit, rate_minor, currency)
    values (${a.tenantId}, (select coalesce(max(seq), 0) + 1 from rentals), 'RNT-000001', ${branch!.id}, ${`WC${Math.random()}`}, ${variantId}, 'كرسي', 'زبون', '0944555666',
            '2026-11-01', '2026-11-05', 'day', 1000, 'SYP')
    returning id, version`;
  const [contract] = await ownerDb()<{ id: string; version: number }[]>`
    insert into maintenance_contracts (tenant_id, seq, number, customer_name, start_date, end_date,
                                       visit_every_months, currency, price_minor)
    values (${a.tenantId}, (select coalesce(max(seq), 0) + 1 from maintenance_contracts), 'MC-000001', 'عيادة',
            '2026-01-01', '2026-12-31', 3, 'SYP', 1000)
    returning id, version`;
  const customer = await app.inject({
    method: 'POST',
    url: '/v1/customers',
    headers: owner(a),
    payload: { name: 'مشفى', kind: 'hospital' },
  });
  const customerId = customer.json<{ id: string }>().id;
  const [price] = await ownerDb()<{ id: string; version: number }[]>`
    insert into contract_prices (tenant_id, customer_id, variant_id, currency, price_minor, valid_from)
    values (${a.tenantId}, ${customerId}, ${variantId}, 'SYP', 900, '2026-01-01')
    returning id, version`;
  return {
    rental: rental!,
    contract: contract!,
    price: price!,
    customerId,
    variantId,
    productId: product.id,
  };
}

/** A rentable piece of store A in stock, for the probes that try to rent it from store B */
async function rentablePieceOf(app: FastifyInstance, a: Stores['a']) {
  const product = await productOf(app, a);
  const serial = `WC${Math.random()}`;
  await ownerDb()`update products set rentable = true where id = ${product.id}`;
  await ownerDb()`
    insert into serials (tenant_id, variant_id, serial, status)
    values (${a.tenantId}, ${product.variants[0]!.id}, ${serial}, 'in_stock')`;
  return serial;
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
  'POST /v1/shop/:slug/orders/:token/cancel-request': async (app, stores) => {
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
    const token = placed.json<{ trackPath: string }>().trackPath.split('/').at(-1)!;
    const ask = (slug: string) =>
      app.inject({ method: 'POST', url: `/v1/shop/${slug}/orders/${token}/cancel-request` });
    // A's order cannot be cancelled through B's link, and the failed try changes nothing
    expect((await ask('b-shop')).statusCode).toBe(404);
    const still = await app.inject({ method: 'GET', url: `/v1/shop/a-shop/orders/${token}` });
    expect(still.json<{ status: string }>().status).toBe('pending');
    expect((await ask('a-shop')).statusCode).toBe(200);
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
  'GET /v1/shop/:slug/coupon': async (app, stores) => {
    await twoShops(app, stores);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/promotions',
      headers: owner(stores.a),
      payload: { name: 'خصم', kind: 'percent', percentBp: 1000, scope: 'all', couponCode: 'IDORCODE' },
    });
    expect(made.statusCode, made.body).toBe(201);
    const ask = (slug: string) => app.inject({ method: 'GET', url: `/v1/shop/${slug}/coupon?code=IDORCODE` });
    expect((await ask('a-shop')).statusCode).toBe(200);
    // A's code opens nothing in B's shop
    expect((await ask('b-shop')).statusCode).toBe(400);
  },
  'POST /v1/shop/:slug/products/:id/notify': async (app, stores) => {
    const product = await twoShops(app, stores);
    const body = { variantId: product.variants[0]!.id, phone: '0944555666' };
    const at = (slug: string) =>
      app.inject({ method: 'POST', url: `/v1/shop/${slug}/products/${product.id}/notify`, payload: body });
    expect((await at('a-shop')).statusCode).toBe(204);
    expect((await at('b-shop')).statusCode).toBe(404);
  },
  'GET /v1/products/:id/stock-alerts': async (app, stores) => {
    const product = await twoShops(app, stores);
    const url = `/v1/products/${product.id}/stock-alerts`;
    expect((await app.inject({ method: 'GET', url, headers: owner(stores.a) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers: owner(stores.b) })).statusCode).toBe(404);
  },
  'POST /v1/stock-alerts/:id/notified': async (app, stores) => {
    const product = await twoShops(app, stores);
    await app.inject({
      method: 'POST',
      url: `/v1/shop/a-shop/products/${product.id}/notify`,
      payload: { variantId: product.variants[0]!.id, phone: '0944777888' },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/v1/products/${product.id}/stock-alerts`,
      headers: owner(stores.a),
    });
    const [alert] = list.json<{ items: { id: string }[] }>().items;
    const url = `/v1/stock-alerts/${alert!.id}/notified`;
    expect((await app.inject({ method: 'POST', url, headers: owner(stores.b) })).statusCode).toBe(404);
    const still = await app.inject({
      method: 'GET',
      url: `/v1/products/${product.id}/stock-alerts`,
      headers: owner(stores.a),
    });
    expect(still.json<{ items: { notifiedAt: string | null }[] }>().items[0]!.notifiedAt).toBeNull();
  },
  'GET /v1/products/:id/shop-text': catalogIdor(
    'products',
    productOf,
    'GET',
    (id) => `/v1/products/${id}/shop-text`,
  ),
  'PUT /v1/products/:id/shop-text': async (app, { a, b }) => {
    const record = await productOf(app, a);
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/products/${record.id}/shop-text`,
      headers: owner(b),
      payload: { description: 'مسروق', sizeGuide: null },
    });
    expect(res.statusCode).toBe(404);
    const mine = await app.inject({
      method: 'GET',
      url: `/v1/products/${record.id}/shop-text`,
      headers: owner(a),
    });
    expect(mine.json<{ description: string | null }>().description).toBeNull();
  },
  'PUT /v1/online-store/image/:slot': async (app, stores) => {
    await twoShops(app, stores);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]).toString('base64');
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/online-store/image/logo',
      headers: owner(stores.b),
      payload: { contentType: 'image/png', data: png, thumb: png, width: 8, height: 8 },
    });
    expect(put.statusCode, put.body).toBe(200);
    // B's logo is B's alone
    const logoOf = async (slug: string) =>
      (await app.inject({ method: 'GET', url: `/v1/shop/${slug}` })).json<{
        store: { logoUrl: string | null };
      }>().store.logoUrl;
    expect(await logoOf('a-shop')).toBeNull();
    expect(await logoOf('b-shop')).not.toBeNull();
  },
  'DELETE /v1/online-store/image/:slot': async (app, stores) => {
    await twoShops(app, stores);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]).toString('base64');
    await app.inject({
      method: 'PUT',
      url: '/v1/online-store/image/cover',
      headers: owner(stores.a),
      payload: { contentType: 'image/png', data: png, thumb: png, width: 8, height: 8 },
    });
    // B removing its own cover does not touch A's
    const gone = await app.inject({
      method: 'DELETE',
      url: '/v1/online-store/image/cover',
      headers: owner(stores.b),
    });
    expect(gone.statusCode).toBe(200);
    const home = await app.inject({ method: 'GET', url: '/v1/shop/a-shop' });
    expect(home.json<{ store: { coverUrl: string | null } }>().store.coverUrl).not.toBeNull();
  },
  'POST /v1/online-orders/:id/delivery': async (app, stores) => {
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
        fulfilment: 'delivery',
        address: 'المزة',
        lines: [{ variantId: service.json<{ variants: { id: string }[] }>().variants[0]!.id, qty: 1 }],
      },
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const mine = await app.inject({ method: 'GET', url: '/v1/online-orders', headers: owner(stores.a) });
    const [target] = mine.json<{ items: { id: string; version: number }[] }>().items;
    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${target!.id}/status`,
      headers: owner(stores.a),
      payload: { status: 'accepted', version: target!.version },
    });
    const version = accepted.json<{ version: number }>().version;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/online-orders/${target!.id}/delivery`,
      headers: owner(stores.b),
      payload: { stage: 'out', courier: 'مسروق', version },
    });
    expect(res.statusCode).toBe(404);
    const after = await app.inject({ method: 'GET', url: '/v1/online-orders', headers: owner(stores.a) });
    const row = after
      .json<{ items: { id: string; deliveryStage: string | null }[] }>()
      .items.find((o) => o.id === target!.id);
    expect(row!.deliveryStage).toBeNull();
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
  // Store B's owner on store A's customer, supplier, expense and entry: 404, nothing of A's in the answer.
  'GET /v1/customers/:id/statement': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/customers',
      headers: owner(a),
      payload: { name: 'زبون كشف' },
    });
    const id = made.json<{ id: string }>().id;
    const own = await app.inject({
      method: 'GET',
      url: `/v1/customers/${id}/statement?from=2026-01-01&to=2026-12-31`,
      headers: owner(a),
    });
    expect(own.statusCode, own.body).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/customers/${id}/statement?from=2026-01-01&to=2026-12-31`,
      headers: owner(b),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('زبون كشف');
  },
  'GET /v1/suppliers/:id/statement': async (app, { a, b }) => {
    const id = await supplierOf(app, a);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/suppliers/${id}/statement?from=2026-01-01&to=2026-12-31`,
      headers: owner(b),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('مورد أ');
  },
  'POST /v1/expenses/:id/void': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/expenses',
      headers: owner(a),
      payload: {
        date: '2026-10-30',
        branchId: await firstBranch(a.tenantId),
        accountCode: '6101',
        amountMinor: 5000,
        currency: 'SYP',
        payFrom: 'safe',
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const id = made.json<{ id: string }>().id;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/expenses/${id}/void`,
      headers: owner(b),
      payload: { reason: 'سرقة' },
    });
    expect(res.statusCode).toBe(404);
    const [n] = await ownerDb()<
      { n: number }[]
    >`select count(*)::int as n from journal_entries where kind = 'reversal'`;
    expect(n!.n).toBe(0);
  },
  'POST /v1/journal/:id/reverse': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/journal/manual',
      headers: owner(a),
      payload: {
        date: '2026-10-30',
        branchId: await firstBranch(a.tenantId),
        memo: 'قيد أ',
        lines: [
          { accountCode: '6190', debitMinor: 100 },
          { accountCode: '1120', creditMinor: 100 },
        ],
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/journal/${made.json<{ id: string }>().id}/reverse`,
      headers: owner(b),
      payload: { reason: 'سرقة' },
    });
    expect(res.statusCode).toBe(404);
  },
  // Another store's claim cannot be moved on: its id answers 404 and the row stays as it was
  // Another store's dish answers 404 for reading and for replacing its recipe, and its rows stay
  'GET /v1/recipes/:productId': async (app, { a, b }) => {
    const dish = (await productOf(app, a)).id;
    const res = await app.inject({ method: 'GET', url: `/v1/recipes/${dish}`, headers: owner(b) });
    expect(res.statusCode).toBe(404);
  },
  'PUT /v1/recipes/:productId': async (app, { a, b }) => {
    const dish = (await productOf(app, a)).id;
    const flour = (await productOf(app, b)).variants[0]!.id;
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/recipes/${dish}`,
      headers: owner(b),
      payload: { items: [{ variantId: flour, qty: 200 }] },
    });
    expect(res.statusCode).toBe(404);
    const rows = await ownerDb()`select 1 from recipe_items where product_id = ${dish}`;
    expect(rows).toHaveLength(0);
  },
  'POST /v1/warranty/claims/:id/status': async (app, { a, b }) => {
    const [claim] = await ownerDb()<{ id: string; version: number }[]>`
      insert into warranty_claims (tenant_id, seq, number, serial, item, issue)
      values (${a.tenantId}, 1, 'WC-000001', 'IMEI-A-1', 'جوال', 'لا يشحن')
      returning id, version`;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/warranty/claims/${claim!.id}/status`,
      headers: owner(b),
      payload: { status: 'ready', version: claim!.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { status: string }[]
    >`select status from warranty_claims where id = ${claim!.id}`;
    expect(row!.status).toBe('received');
  },
  // Another store's quotation answers 404 for reading, editing and moving on, and stays as it was
  'GET /v1/quotations/:id': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/quotations',
      headers: owner(a),
      payload: QUOTATION,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/quotations/${made.json<{ id: string }>().id}`,
      headers: owner(b),
    });
    expect(res.statusCode).toBe(404);
  },
  'PUT /v1/quotations/:id': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/quotations',
      headers: owner(a),
      payload: QUOTATION,
    });
    const q = made.json<{ id: string; version: number }>();
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/quotations/${q.id}`,
      headers: owner(b),
      payload: { ...QUOTATION, version: q.version, notes: 'تغيير' },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { notes: string | null }[]
    >`select notes from quotations where id = ${q.id}`;
    expect(row!.notes).toBeNull();
  },
  'POST /v1/quotations/:id/status': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/quotations',
      headers: owner(a),
      payload: QUOTATION,
    });
    const q = made.json<{ id: string; version: number }>();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/quotations/${q.id}/status`,
      headers: owner(b),
      payload: { status: 'sent', version: q.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<{ status: string }[]>`select status from quotations where id = ${q.id}`;
    expect(row!.status).toBe('draft');
  },
  'GET /v1/device/quotations/:id': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/quotations',
      headers: owner(a),
      payload: QUOTATION,
    });
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/quotations/${made.json<{ id: string }>().id}`,
      headers: { authorization: deviceB.authorization },
    });
    expect(res.statusCode).toBe(404);
  },
  'POST /v1/device/quotations/:id/convert': async (app, { a, b }) => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/quotations',
      headers: owner(a),
      payload: QUOTATION,
    });
    const q = made.json<{ id: string; version: number }>();
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/device/quotations/${q.id}/convert`,
      headers: { authorization: deviceB.authorization },
      payload: { version: q.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<{ status: string }[]>`select status from quotations where id = ${q.id}`;
    expect(row!.status).toBe('draft');
  },
  'POST /v1/device/alterations/:id/status': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/device/alterations',
      headers: { authorization: deviceA.authorization },
      payload: {
        customerName: 'زبون',
        phone: '0944555666',
        item: 'بنطال',
        work: 'تقصير',
        priceMinor: 0,
        dueDate: '2026-11-06',
      },
    });
    expect(made.statusCode, made.body).toBe(201);
    const t = made.json<{ id: string; version: number }>();
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/device/alterations/${t.id}/status`,
      headers: { authorization: deviceB.authorization },
      payload: { status: 'ready', version: t.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { status: string }[]
    >`select status from alteration_tickets where id = ${t.id}`;
    expect(row!.status).toBe('received');
  },
  'POST /v1/device/rentals/:id/return': async (app, { a, b }) => {
    const { rental } = await contractRowsOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/device/rentals/${rental.id}/return`,
      headers: { authorization: deviceB.authorization },
      payload: { version: rental.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<{ status: string }[]>`select status from rentals where id = ${rental.id}`;
    expect(row!.status).toBe('out');
  },
  'POST /v1/device/maintenance/:id/billed': async (app, { a, b }) => {
    const { contract } = await contractRowsOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/device/maintenance/${contract.id}/billed`,
      headers: { authorization: deviceB.authorization },
      payload: { version: contract.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { billed_on: string | null }[]
    >`select billed_on from maintenance_contracts where id = ${contract.id}`;
    expect(row!.billed_on).toBeNull();
  },
  'POST /v1/maintenance/:id/visits': async (app, { a, b }) => {
    const { contract } = await contractRowsOf(app, a);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/${contract.id}/visits`,
      headers: owner(b),
      payload: { technician: 'فني', version: contract.version },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { visits: unknown[] }[]
    >`select visits from maintenance_contracts where id = ${contract.id}`;
    expect(row!.visits).toEqual([]);
  },
  'POST /v1/maintenance/:id/renew': async (app, { a, b }) => {
    const { contract } = await contractRowsOf(app, a);
    const [before] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from maintenance_contracts`;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/maintenance/${contract.id}/renew`,
      headers: owner(b),
      payload: { version: contract.version },
    });
    expect(res.statusCode).toBe(404);
    const [count] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from maintenance_contracts`;
    expect(count!.n).toBe(before!.n);
  },
  'PUT /v1/contract-prices/:id': async (app, { a, b }) => {
    const { price, customerId, variantId } = await contractRowsOf(app, a);
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/contract-prices/${price.id}`,
      headers: owner(b),
      payload: { version: price.version, customerId, variantId, priceMinor: 1, validFrom: '2026-01-01' },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { price_minor: string }[]
    >`select price_minor::text from contract_prices where id = ${price.id}`;
    expect(row!.price_minor).toBe('900');
  },
  'DELETE /v1/contract-prices/:id': async (app, { a, b }) => {
    const { price } = await contractRowsOf(app, a);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/contract-prices/${price.id}`,
      headers: owner(b),
    });
    expect(res.statusCode).toBe(404);
    const [count] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from contract_prices`;
    expect(count!.n).toBeGreaterThan(0);
    const [still] = await ownerDb()<{ id: string }[]>`select id from contract_prices where id = ${price.id}`;
    expect(still!.id).toBe(price.id);
  },
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
  'POST /v1/customers/:id/payments': customerIdor('POST', '/payments', { amountMinor: 1000, method: 'cash' }),
  'POST /v1/customers/:id/opening-debt': customerIdor('POST', '/opening-debt', { amountMinor: 1000 }),
  'POST /v1/customers/:id/archive-duplicate': customerIdor('POST', '/archive-duplicate'),
  'PATCH /v1/branches/:id': branchIdor((id) => `/v1/branches/${id}`, 'PATCH', { name: 'مسروق' }),
  'POST /v1/branches/:id/active': branchIdor((id) => `/v1/branches/${id}/active`, 'POST', { active: false }),
  'PATCH /v1/staff/:id': staffIdor('PATCH', '', { fullName: 'مسروق' }),
  'POST /v1/staff/:id/pin': staffIdor('POST', '/pin', { pin: '7391' }),
  'POST /v1/staff/:id/deactivate': staffIdor('POST', '/deactivate'),
  'POST /v1/staff/:id/reactivate': staffIdor('POST', '/reactivate'),
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
  // Store B's owner asking for store A's invoice: 404, nothing of store A in the answer.
  'GET /v1/sales/:id': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    const [userA] = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${a.tenantId}`;
    const saleId = createUuidV7()();
    await ownerDb()`insert into invoices (tenant_id, id, branch_id, device_id, number, business_date,
        device_time, shift_id, cashier_id, currency, tax_inclusive, gross_minor, discount_minor, tax_minor,
        total_minor, tip_minor, payload)
      values (${a.tenantId}, ${saleId}, ${deviceA.branchId}, ${deviceA.deviceId}, 'INV-001-002-0000001',
        '2026-10-30', now(), ${createUuidV7()()}, ${userA!.id}, 'SYP', true, 100, 0, 0, 100, 0, '{}'::jsonb)`;
    const own = await app.inject({ method: 'GET', url: `/v1/sales/${saleId}`, headers: owner(a) });
    expect(own.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: `/v1/sales/${saleId}`, headers: owner(b) });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('INV-001-002');
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
/** Store A with a café menu, one table, a waiter-capable owner and an open order (optionally sent). */
async function hallFixtureOf(app: FastifyInstance, a: Stores['a'], send = false) {
  const deviceA = await createDevice(a.tenantId);
  const [me] = await ownerDb()<{ id: string }[]>`
    select id from users where tenant_id = ${a.tenantId} limit 1`;
  const userA = me!.id;
  await ownerDb()`update tenant_settings set service = ${ownerDb().json({ tables: ['1'], orderNumbers: false, kitchenTickets: true })} where tenant_id = ${a.tenantId}`;
  const made = await app.inject({
    method: 'POST',
    url: '/v1/products',
    headers: owner(a),
    payload: {
      nameAr: 'قهوة',
      type: 'service',
      variants: [{ price: { currency: 'SYP', priceMinor: 15_000 } }],
    },
  });
  const product = made.json<{ id: string; variants: { id: string }[] }>();
  const post = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/v1/device/hall',
      headers: { authorization: deviceA.authorization },
      payload,
    });
  const opened = await post({ type: 'open', userId: userA, table: '1' });
  expect(opened.statusCode, opened.body).toBe(200);
  const orderId = opened.json<{ order: { id: string } }>().order.id;
  const added = await post({
    type: 'add',
    userId: userA,
    orderId,
    lines: [{ productId: product.id, variantId: product.variants[0]!.id, name: 'قهوة', qty: 1 }],
  });
  expect(added.statusCode, added.body).toBe(200);
  if (send) expect((await post({ type: 'send', userId: userA, orderId })).statusCode).toBe(200);
  const [line] = await ownerDb()<
    { id: string }[]
  >`select id from open_order_lines where order_id = ${orderId}`;
  return { deviceA, orderId, userA, lineId: line!.id };
}

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
  'GET /v1/device/quotations/:id': async (app, { a, b }) => {
    await IDOR_PROBES['GET /v1/device/quotations/:id']!(app, { a, b });
  },
  'POST /v1/device/quotations/:id/convert': async (app, { a, b }) => {
    await IDOR_PROBES['POST /v1/device/quotations/:id/convert']!(app, { a, b });
  },
  'POST /v1/device/alterations/:id/status': async (app, { a, b }) => {
    await IDOR_PROBES['POST /v1/device/alterations/:id/status']!(app, { a, b });
  },
  'POST /v1/device/rentals/:id/return': async (app, { a, b }) => {
    await IDOR_PROBES['POST /v1/device/rentals/:id/return']!(app, { a, b });
  },
  'POST /v1/device/maintenance/:id/billed': async (app, { a, b }) => {
    await IDOR_PROBES['POST /v1/device/maintenance/:id/billed']!(app, { a, b });
  },
  // Another store's rentals, contracts, prices and pieces never reach this store's till
  'GET /v1/device/rentals': async (app, { a, b }) => {
    await contractRowsOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/rentals?status=all',
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'GET /v1/device/maintenance': async (app, { a, b }) => {
    await contractRowsOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/maintenance',
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'GET /v1/device/contract-prices': async (app, { a, b }) => {
    const { customerId } = await contractRowsOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/device/contract-prices?customerId=${customerId}`,
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'GET /v1/device/rentals/units': async (app, { a, b }) => {
    await rentablePieceOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/rentals/units',
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'POST /v1/device/rentals': async (app, { a, b }) => {
    const serial = await rentablePieceOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/rentals',
      headers: { authorization: deviceB.authorization },
      payload: {
        serial,
        customerName: 'زبون',
        phone: '0944555666',
        expectedReturn: '2099-01-01',
        rateUnit: 'day',
        rateMinor: 1000,
      },
    });
    expect(res.statusCode).toBe(400);
    const [row] = await ownerDb()<{ status: string }[]>`select status from serials where serial = ${serial}`;
    expect(row!.status).toBe('in_stock');
  },
  // An invoice is found by its number only inside its own store: another store's till gets 404
  'GET /v1/device/invoices/lookup': async (app) => {
    const owner = await openStore(app, '0933333333');
    const doc = documents(owner.device);
    const open = doc('shift_open', shiftOpen(owner.userId));
    const sold = doc(
      'sale',
      sale({ userId: owner.userId }, open.id, {
        lines: [cartLine(1, 15_000, { qty: 1000 })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 15_000 }],
      }),
    );
    await push(app, owner.device, [open, sold]);
    const find = (authorization: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/device/invoices/lookup?q=${encodeURIComponent(sold.number!)}`,
        headers: { authorization },
      });
    expect((await find(owner.device.authorization)).statusCode).toBe(200);
    const other = await registerStore(app, { phone: '0944444444' });
    const stranger = await createDevice(other.body.tenant.id as string);
    expect((await find(stranger.authorization)).statusCode).toBe(404);
  },
  // A till is told about its own store's subscription: A's lapse never reaches B's till
  'GET /v1/device/subscription': async (app, { a, b }) => {
    await ownerDb()`update subscriptions set status = 'suspended' where tenant_id = ${a.tenantId}`;
    const read = async (tenantId: string) =>
      (
        await app.inject({
          method: 'GET',
          url: '/v1/device/subscription',
          headers: { authorization: (await createDevice(tenantId)).authorization },
        })
      ).json<{ readOnly: boolean }>().readOnly;
    expect(await read(a.tenantId)).toBe(true);
    expect(await read(b.tenantId)).toBe(false);
    await ownerDb()`update subscriptions set status = 'active' where tenant_id = ${a.tenantId}`;
  },
  // The hall: store B's devices see none of store A's orders and cannot touch them by id
  'GET /v1/device/hall': async (app, { a, b }) => {
    const { orderId, deviceA } = await hallFixtureOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/hall',
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ orders: unknown[] }>().orders).toEqual([]);
    const own = await app.inject({
      method: 'GET',
      url: '/v1/device/hall',
      headers: { authorization: deviceA.authorization },
    });
    expect(own.json<{ orders: { id: string }[] }>().orders.map((o) => o.id)).toEqual([orderId]);
  },
  'POST /v1/device/hall': async (app, { a, b }) => {
    const { orderId, userA } = await hallFixtureOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    // Another store's order id is as good as none, and another store's staff are unknown
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/hall',
      headers: { authorization: deviceB.authorization },
      payload: { type: 'send', userId: userA, orderId },
    });
    expect([403, 404]).toContain(res.statusCode);
    const [row] = await ownerDb()<{ status: string }[]>`select status from open_orders where id = ${orderId}`;
    expect(row!.status).toBe('open');
  },
  'GET /v1/device/kitchen': async (app, { a, b }) => {
    const { deviceA } = await hallFixtureOf(app, a, true);
    const deviceB = await createDevice(b.tenantId);
    await ownerDb()`update devices set kind = 'kitchen_screen' where id = ${deviceB.deviceId}`;
    const seen = async (device: { authorization: string }) =>
      (
        await app.inject({
          method: 'GET',
          url: '/v1/device/kitchen',
          headers: { authorization: device.authorization },
        })
      ).json<{ tickets: unknown[] }>().tickets.length;
    expect(await seen(deviceB)).toBe(0);
    expect(await seen(deviceA)).toBe(1);
  },
  'POST /v1/device/kitchen': async (app, { a, b }) => {
    const { lineId } = await hallFixtureOf(app, a, true);
    const deviceB = await createDevice(b.tenantId);
    await ownerDb()`update devices set kind = 'kitchen_screen' where id = ${deviceB.deviceId}`;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/device/kitchen',
      headers: { authorization: deviceB.authorization },
      payload: { type: 'status', lineIds: [lineId], status: 'preparing' },
    });
    expect(res.statusCode).toBe(404);
    const [row] = await ownerDb()<
      { status: string }[]
    >`select status from open_order_lines where id = ${lineId}`;
    expect(row!.status).toBe('sent');
  },
  'GET /v1/device/menu': async (app, { a, b }) => {
    await hallFixtureOf(app, a);
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/menu',
      headers: { authorization: deviceB.authorization },
    });
    const menu = res.json<{ items: unknown[]; staff: { id: string }[] }>();
    expect(menu.items).toEqual([]);
    const usersA = await ownerDb()<{ id: string }[]>`select id from users where tenant_id = ${a.tenantId}`;
    const idsA = new Set(usersA.map((u) => u.id));
    expect(menu.staff.every((p) => !idsA.has(p.id))).toBe(true);
  },
  // Store B's till lists none of store A's tickets, and its new one is its own
  // Store B's till lists none of store A's quotations, and its new one is its own
  'GET /v1/device/quotations': async (app, { a, b }) => {
    await app.inject({
      method: 'POST',
      url: '/v1/quotations',
      headers: owner(a),
      payload: { ...QUOTATION, status: 'sent' },
    });
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/quotations',
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'POST /v1/device/quotations': async (app, { a, b }) => {
    const deviceB = await createDevice(b.tenantId);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/device/quotations',
      headers: { authorization: deviceB.authorization },
      payload: QUOTATION,
    });
    expect(made.statusCode, made.body).toBe(201);
    const [row] = await ownerDb()<{ tenant_id: string }[]>`
      select tenant_id from quotations where id = ${made.json<{ id: string }>().id}`;
    expect(row!.tenant_id).toBe(b.tenantId);
    expect(row!.tenant_id).not.toBe(a.tenantId);
  },
  'GET /v1/device/alterations': async (app, { a, b }) => {
    const deviceA = await createDevice(a.tenantId);
    await app.inject({
      method: 'POST',
      url: '/v1/device/alterations',
      headers: { authorization: deviceA.authorization },
      payload: {
        customerName: 'زبون',
        phone: '0944555666',
        item: 'بنطال',
        work: 'تقصير',
        priceMinor: 0,
        dueDate: '2026-11-06',
      },
    });
    const deviceB = await createDevice(b.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/device/alterations',
      headers: { authorization: deviceB.authorization },
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
  },
  'POST /v1/device/alterations': async (app, { a, b }) => {
    const deviceB = await createDevice(b.tenantId);
    const made = await app.inject({
      method: 'POST',
      url: '/v1/device/alterations',
      headers: { authorization: deviceB.authorization },
      payload: {
        customerName: 'زبون',
        phone: '0944555666',
        item: 'بنطال',
        work: 'تقصير',
        priceMinor: 0,
        dueDate: '2026-11-06',
      },
    });
    expect(made.statusCode).toBe(201);
    const id = made.json<{ id: string }>().id;
    const [row] = await ownerDb()<
      { tenant_id: string }[]
    >`select tenant_id from alteration_tickets where id = ${id}`;
    expect(row!.tenant_id).toBe(b.tenantId);
    expect(row!.tenant_id).not.toBe(a.tenantId);
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
  }, 90_000);

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
