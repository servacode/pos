import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RepDaySheet, RepRow, RouteDetail, VanRow } from '@serva/core';
import type { BootstrapResponse, PullResponse } from '@serva/sync';
import { hashDeviceToken } from '../src/auth/device-guard';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * «وضع المندوب», the phone's side (apps/api › services/rep-day.ts, sync-pull.ts REP_PULL_SETS):
 * the day sheet for a rep_phone device, the sets only it pulls, and the two small writes of a day.
 * The device is the only thing that names a rep, so every IDOR check here is about devices.
 */

let app: FastifyInstance;
let s: TestStore;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb where is_free`;
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  await ownerDb()`update plans set limits = limits || '{"reps": null}'::jsonb`;
  s = await testStore(app);
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url, headers: bearer(token), ...(payload ? { payload: payload as object } : {}) });
const ok = async <T>(token: string, method: Method, url: string, payload?: unknown, status = 200) => {
  const res = await call(token, method, url, payload);
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
};

/** A phone of kind rep_phone paired to a branch (a van), with its own token */
async function repPhone(tenantId: string, branchId: string, code: string): Promise<TestDevice> {
  const token = `sdt_${randomBytes(32).toString('base64url')}`;
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
    values (${tenantId}, ${branchId}, ${code}, ${`هاتف ${code}`}, 'rep_phone', 'active', ${hashDeviceToken(token)})
    returning id`;
  return { deviceId: row!.id, tenantId, branchId, code, token, authorization: `Device ${token}` };
}

interface World {
  van: VanRow;
  rep: RepRow;
  phone: TestDevice;
  route: RouteDetail;
  customers: { inRoute: string; second: string; outside: string };
}

const allDays = [0, 1, 2, 3, 4, 5, 6];
let phoneSeq = 0;

async function customerOf(token: string, name: string, extra: Record<string, unknown> = {}) {
  const res = await call(token, 'POST', '/v1/customers', { name, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

async function world(store: TestStore, tag: string, days = allDays): Promise<World> {
  const van = await ok<VanRow>(
    store.accessToken,
    'POST',
    '/v1/vans',
    { name: `سيارة ${tag}`, parentBranchId: store.branchId },
    201,
  );
  const staff = await staffUser(app, store, 'rep', `0955${String(++phoneSeq).padStart(6, '0')}`, {
    fullName: `مندوب ${tag}`,
  });
  const rep = await ok<RepRow>(
    store.accessToken,
    'POST',
    '/v1/reps',
    { userId: staff.userId, branchId: store.branchId, vanBranchId: van.id, dailyCreditLimitMinor: 5_000_000 },
    201,
  );
  const phone = await repPhone(store.tenantId, van.id, '002');
  const inRoute = await customerOf(store.accessToken, `زبون ${tag} أول`, { creditLimitMinor: 9_000_000 });
  const second = await customerOf(store.accessToken, `زبون ${tag} ثان`);
  const outside = await customerOf(store.accessToken, `زبون ${tag} خارج الخط`);
  const made = await ok<RouteDetail>(
    store.accessToken,
    'POST',
    '/v1/routes',
    { name: `خط ${tag}`, weekdays: days, repId: rep.id },
    201,
  );
  const route = await ok<RouteDetail>(store.accessToken, 'PUT', `/v1/routes/${made.id}/customers`, {
    customerIds: [second, inRoute],
    version: made.version,
  });
  return { van, rep, phone, route, customers: { inRoute, second, outside } };
}

const sheetOf = (device: TestDevice) =>
  app.inject({ method: 'GET', url: '/v1/device/rep/day', headers: { authorization: device.authorization } });

describe('GET /v1/device/rep/day', () => {
  it('answers a rep phone with its own routes, customers in visiting order, balances and limits', async () => {
    const w = await world(s, '1');
    await ok(
      s.accessToken,
      'POST',
      `/v1/customers/${w.customers.inRoute}/opening-debt`,
      {
        amountMinor: 700_000,
        date: '2020-01-01',
      },
      201,
    );
    const res = await sheetOf(w.phone);
    expect(res.statusCode, res.body).toBe(200);
    const sheet = res.json<RepDaySheet>();
    expect(sheet.rep).toMatchObject({
      id: w.rep.id,
      vanBranchId: w.van.id,
      dailyCreditLimitMinor: 5_000_000,
      mode: 'van',
    });
    expect(sheet.routes).toHaveLength(1);
    expect(sheet.routes[0]!.customerIds).toEqual([w.customers.second, w.customers.inRoute]);
    expect(sheet.todayRouteIds).toEqual([w.route.id]);
    expect(sheet.customers.map((c) => c.id).sort()).toEqual([w.customers.inRoute, w.customers.second].sort());
    const debtor = sheet.customers.find((c) => c.id === w.customers.inRoute)!;
    expect(debtor).toMatchObject({
      balanceMinor: 700_000,
      overdueMinor: 700_000,
      creditLimitMinor: 9_000_000,
      approvalStatus: 'approved',
      priceTier: 'retail',
    });
    expect(sheet.customers.find((c) => c.id === w.customers.second)).toMatchObject({
      balanceMinor: 0,
      overdueMinor: 0,
    });
    expect(sheet.settings).toMatchObject({ requireCustomerApproval: true, orderHoldDays: 7 });
    expect(sheet.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sheet.openOrders).toEqual([]);
    expect(sheet.visits).toEqual([]);
    // Never any cost
    expect(res.body).not.toMatch(/cost/i);
  });

  it('lists a route only on its weekdays, but keeps every route of the rep on the sheet', async () => {
    const w = await world(s, '2', []);
    const sheet = (await sheetOf(w.phone)).json<RepDaySheet>();
    expect(sheet.routes).toHaveLength(1);
    expect(sheet.todayRouteIds).toEqual([]);
  });

  it('carries the contract prices in force for each customer, his own over his kind’s', async () => {
    const w = await world(s, '3');
    const [variant] = await ownerDb()<{ id: string }[]>`
      select v.id from variants v where v.tenant_id = ${s.tenantId} limit 1`;
    let variantId = variant?.id;
    if (!variantId) {
      const cat = await ok<{ id: string }>(
        s.accessToken,
        'POST',
        '/v1/products',
        {
          nameAr: 'منتج',
          variants: [{ price: { currency: 'SYP', priceMinor: 1000 } }],
        },
        201,
      );
      const [v] = await ownerDb()<{ id: string }[]>`select id from variants where product_id = ${cat.id}`;
      variantId = v!.id;
    }
    await ownerDb()`update customers set kind = 'pharmacy' where tenant_id = ${s.tenantId} and id = ${w.customers.second}`;
    await ownerDb()`
      insert into contract_prices (tenant_id, customer_id, customer_kind, variant_id, currency, price_minor, valid_from)
      values (${s.tenantId}, ${w.customers.inRoute}, null, ${variantId}, 'SYP', 800, current_date - 1),
             (${s.tenantId}, null, 'pharmacy', ${variantId}, 'SYP', 900, current_date - 1),
             (${s.tenantId}, null, 'pharmacy', ${variantId}, 'SYP', 100, current_date + 30)`;
    const sheet = (await sheetOf(w.phone)).json<RepDaySheet>();
    const byCustomer = new Map(sheet.contractPrices.map((p) => [p.customerId, p]));
    expect(byCustomer.get(w.customers.inRoute)).toMatchObject({ variantId, priceMinor: 800 });
    // The price that has not started yet is not in force
    expect(byCustomer.get(w.customers.second)).toMatchObject({ variantId, priceMinor: 900 });
  });

  it('carries the open orders of its van only, and the van stock', async () => {
    const w = await world(s, '4');
    const other = await world(s, '5');
    const product = await ok<{ id: string }>(
      s.accessToken,
      'POST',
      '/v1/products',
      {
        nameAr: 'سلعة',
        variants: [{ price: { currency: 'SYP', priceMinor: 1000 } }],
      },
      201,
    );
    const [v] = await ownerDb()<{ id: string }[]>`select id from variants where product_id = ${product.id}`;
    const lines = ownerDb().json([{ variantId: v!.id, qty: 5000, deliveredQty: 1000, unitPriceMinor: 1000 }]);
    const order = async (branch: string, warehouse: string, number: string, status: string) =>
      ownerDb()`
        insert into sales_orders (tenant_id, number, branch_id, warehouse_branch_id, customer_id, business_date,
                                  status, currency, total_minor, lines)
        values (${s.tenantId}, ${number}, ${branch}, ${warehouse}, ${w.customers.inRoute}, current_date,
                ${status}, 'SYP', 5000, ${lines})`;
    await order(w.van.id, s.branchId, 'SO-1', 'open');
    await order(s.branchId, w.van.id, 'SO-2', 'partial');
    await order(w.van.id, s.branchId, 'SO-3', 'cancelled');
    await order(other.van.id, s.branchId, 'SO-4', 'open');
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${s.tenantId}, ${w.van.id}, ${v!.id}, 12000), (${s.tenantId}, ${other.van.id}, ${v!.id}, 99000)`;
    const sheet = (await sheetOf(w.phone)).json<RepDaySheet>();
    expect(sheet.openOrders.map((o) => o.number).sort()).toEqual(['SO-1', 'SO-2']);
    expect(sheet.openOrders[0]!.lines[0]).toEqual({
      variantId: v!.id,
      qty: 5000,
      deliveredQty: 1000,
      unitPriceMinor: 1000,
    });
    expect(sheet.vanStock).toEqual([{ variantId: v!.id, qty: 12000 }]);
  });

  it('carries the invoices of the day’s customers from the last 60 days with what was returned', async () => {
    const w = await world(s, '6');
    const old = await world(s, '7');
    const invoice = (customer: string, device: TestDevice, number: string, daysAgo: number) =>
      ownerDb()<{ id: string }[]>`
        insert into invoices (tenant_id, branch_id, device_id, number, business_date, device_time, shift_id,
                              cashier_id, customer_id, currency, tax_inclusive, gross_minor, discount_minor,
                              tax_minor, total_minor, tip_minor, payload)
        values (${s.tenantId}, ${device.branchId}, ${device.deviceId}, ${number}, current_date - ${daysAgo}::int,
                now() - (${daysAgo}::int * interval '1 day'), ${randomUUID()}, ${randomUUID()}, ${customer}, 'SYP',
                true, 1000, 0, 0, 1000, 0, '{"lines":[]}'::jsonb)
        returning id`;
    const [fresh] = await invoice(w.customers.inRoute, w.phone, 'INV-1', 3);
    await invoice(w.customers.inRoute, w.phone, 'INV-OLD', 90);
    await invoice(old.customers.inRoute, old.phone, 'INV-OTHER', 1);
    const sheet = (await sheetOf(w.phone)).json<RepDaySheet>();
    expect(sheet.returnable.map((i) => i.number)).toEqual(['INV-1']);
    expect(sheet.returnable[0]).toMatchObject({
      id: fresh!.id,
      customerId: w.customers.inRoute,
      returned: [],
    });
  });

  it('refuses a cashier till, a revoked phone, a phone without a rep and a plan without reps', async () => {
    const w = await world(s, '8');
    const till = await createDevice(s.tenantId);
    const asTill = await sheetOf(till);
    expect(asTill.statusCode).toBe(403);
    expect(asTill.json().error.code).toBe('forbidden');

    const revoked = await repPhone(s.tenantId, w.van.id, '003');
    await ownerDb()`update devices set revoked_at = now(), status = 'revoked' where id = ${revoked.deviceId}`;
    expect((await sheetOf(revoked)).statusCode).toBe(403);

    expect((await app.inject({ method: 'GET', url: '/v1/device/rep/day' })).statusCode).toBe(401);

    await ok(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/active`, { active: false });
    const stopped = await sheetOf(w.phone);
    expect(stopped.statusCode).toBe(403);
    await ok(s.accessToken, 'POST', `/v1/reps/${w.rep.id}/active`, { active: true });

    await ownerDb()`update plans set limits = limits || '{"reps": 0}'::jsonb`;
    const gated = await sheetOf(w.phone);
    expect(gated.statusCode).toBe(403);
    expect(gated.json().error.code).toBe('plan_limit_reached');
  });

  it('never shows one rep’s routes or customers to another rep’s phone, or to another store', async () => {
    const mine = await world(s, '9');
    const theirs = await world(s, '10');
    const sheet = (await sheetOf(mine.phone)).json<RepDaySheet>();
    const ids = new Set(sheet.customers.map((c) => c.id));
    expect(ids.has(theirs.customers.inRoute)).toBe(false);
    expect(ids.has(theirs.customers.outside)).toBe(false);
    expect(sheet.routes.map((r) => r.id)).toEqual([mine.route.id]);

    const strangerStore = await testStore(app, '0922222222');
    const stranger = await world(strangerStore, '11');
    const strangerSheet = (await sheetOf(stranger.phone)).json<RepDaySheet>();
    expect(strangerSheet.customers.map((c) => c.id)).not.toContain(mine.customers.inRoute);
    expect(strangerSheet.routes.map((r) => r.id)).toEqual([stranger.route.id]);
  });
});

describe('POST /v1/device/rep/day and /visits', () => {
  const post = (device: TestDevice, url: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url,
      headers: { authorization: device.authorization },
      payload: payload as object,
    });
  // The store's own today (its time zone), as the sheet says it
  const today = async (device: TestDevice) => (await sheetOf(device)).json<RepDaySheet>().businessDate;

  it('starts the day once and keeps the float, and a retried visit is one row that shows on the sheet', async () => {
    const w = await world(s, '12');
    const day = await today(w.phone);
    const start = await post(w.phone, '/v1/device/rep/day', {
      businessDate: day,
      openingCash: { SYP: 100_000 },
      loadConfirmed: true,
    });
    expect(start.statusCode, start.body).toBe(200);
    const again = await post(w.phone, '/v1/device/rep/day', {
      businessDate: day,
      openingCash: { SYP: 150_000 },
    });
    expect(again.json<{ id: string }>().id).toBe(start.json<{ id: string }>().id);
    const [row] = await ownerDb()<{ opening_cash: Record<string, number>; confirmed: boolean }[]>`
      select opening_cash, load_confirmed_at is not null as confirmed from rep_days where tenant_id = ${s.tenantId}`;
    expect(row).toEqual({ opening_cash: { SYP: 150_000 }, confirmed: true });

    const visit = {
      id: randomUUID(),
      businessDate: day,
      customerId: w.customers.inRoute,
      routeId: w.route.id,
      arrivedAt: new Date().toISOString(),
      outcome: 'sale',
      docIds: [randomUUID()],
    };
    expect((await post(w.phone, '/v1/device/rep/visits', visit)).statusCode).toBe(201);
    expect(
      (await post(w.phone, '/v1/device/rep/visits', { ...visit, outcome: 'collection' })).statusCode,
    ).toBe(201);
    const rows = await ownerDb()<
      { outcome: string }[]
    >`select outcome from rep_visits where tenant_id = ${s.tenantId}`;
    expect(rows).toEqual([{ outcome: 'collection' }]);
    const sheet = (await sheetOf(w.phone)).json<RepDaySheet>();
    expect(sheet.visits).toHaveLength(1);
    expect(sheet.visits[0]).toMatchObject({
      id: visit.id,
      customerId: w.customers.inRoute,
      results: ['collection'],
      offRoute: false,
    });
  });

  it('asks a reason for a no-sale visit, and refuses a reason, a route or a customer that is not his', async () => {
    const w = await world(s, '13');
    const other = await world(s, '14');
    const base = {
      id: randomUUID(),
      businessDate: await today(w.phone),
      customerId: w.customers.outside,
      arrivedAt: new Date().toISOString(),
      offRoute: true,
    };
    const noReason = await post(w.phone, '/v1/device/rep/visits', { ...base, outcome: 'no_sale' });
    expect(noReason.statusCode).toBe(400);
    const [reason] = await ownerDb()<{ id: string }[]>`
      select id from no_sale_reasons where tenant_id = ${s.tenantId} and key = 'closed'`;
    const fine = await post(w.phone, '/v1/device/rep/visits', {
      ...base,
      outcome: 'no_sale',
      noSaleReasonId: reason!.id,
    });
    expect(fine.statusCode, fine.body).toBe(201);
    // Another rep's route cannot be named
    const stolen = await post(w.phone, '/v1/device/rep/visits', {
      ...base,
      id: randomUUID(),
      routeId: other.route.id,
    });
    expect(stolen.statusCode).toBe(400);
    // A visit id that belongs to another rep is not overwritten
    const clash = await post(other.phone, '/v1/device/rep/visits', {
      ...base,
      customerId: other.customers.inRoute,
    });
    expect(clash.statusCode).toBe(403);
    // An unknown customer
    const ghost = await post(w.phone, '/v1/device/rep/visits', {
      ...base,
      id: randomUUID(),
      customerId: randomUUID(),
    });
    expect(ghost.statusCode).toBe(400);
    // A till cannot write a visit
    const till = await createDevice(s.tenantId);
    expect((await post(till, '/v1/device/rep/visits', { ...base, id: randomUUID() })).statusCode).toBe(403);
  });
});

describe('the sets only a rep phone pulls', () => {
  const pull = (device: TestDevice, query = '') =>
    app.inject({
      method: 'GET',
      url: `/v1/sync/pull${query}`,
      headers: { authorization: device.authorization },
    });
  const bootstrap = (device: TestDevice) =>
    app.inject({
      method: 'GET',
      url: '/v1/sync/bootstrap',
      headers: { authorization: device.authorization },
    });

  it('adds regions, routes, route_customers, no_sale_reasons and sales_orders to a rep phone’s pull, and to no other device', async () => {
    const w = await world(s, '15');
    await ownerDb()`insert into regions (tenant_id, name) values (${s.tenantId}, 'المزة')`;
    await settled();
    const rep = await pull(w.phone);
    expect(rep.statusCode, rep.body).toBe(200);
    const sets = rep.json<PullResponse>().sets;
    for (const name of ['regions', 'routes', 'route_customers', 'no_sale_reasons', 'sales_orders']) {
      expect(Object.keys(sets), name).toContain(name);
    }
    expect(sets.regions!.upserts).toHaveLength(1);
    expect(sets.routes!.upserts).toEqual([
      expect.objectContaining({
        id: w.route.id,
        name: 'خط 15',
        weekdays: allDays,
        repId: w.rep.id,
        isActive: true,
      }),
    ]);
    expect(
      sets.route_customers!.upserts.map((r) => (r as unknown as { customerId: string }).customerId).sort(),
    ).toEqual([w.customers.inRoute, w.customers.second].sort());
    expect(sets.no_sale_reasons!.upserts).toHaveLength(8);

    const till = await createDevice(s.tenantId);
    const tillSets = Object.keys((await pull(till)).json<PullResponse>().sets);
    for (const name of ['regions', 'routes', 'route_customers', 'no_sale_reasons', 'sales_orders']) {
      expect(tillSets, name).not.toContain(name);
    }
    const asked = await pull(till, `?cursors=${encodeURIComponent(JSON.stringify({ routes: '0' }))}`);
    expect(asked.statusCode).toBe(400);
  });

  it('puts the same sets in a rep phone’s bootstrap, and leaves a till’s bootstrap as it was', async () => {
    const w = await world(s, '16');
    await settled();
    const rep = (await bootstrap(w.phone)).json<BootstrapResponse>();
    expect(Object.keys(rep.cursors)).toEqual(
      expect.arrayContaining([
        'regions',
        'routes',
        'route_customers',
        'no_sale_reasons',
        'sales_orders',
        'customers',
      ]),
    );
    const till = (await bootstrap(await createDevice(s.tenantId))).json<BootstrapResponse>();
    expect(Object.keys(till.cursors)).not.toContain('routes');
    expect(Object.keys(till.cursors)).toContain('customers');
  });

  it('gives a van’s phone only the customers of its rep’s routes and the ones it added, and a till all of them', async () => {
    const w = await world(s, '17');
    const other = await world(s, '18');
    // A customer the phone's own document created
    const created = randomUUID();
    await ownerDb()`
      insert into sync_inbox (tenant_id, doc_id, device_id, device_seq, doc_type, payload_hash, payload,
                              contract_version, engine_version, device_time, business_date, status)
      values (${s.tenantId}, ${created}, ${w.phone.deviceId}, 1, 'customer', ${'a'.repeat(64)}, '{}'::jsonb, 1, '1', now(),
              current_date, 'accepted')`;
    await ownerDb()`
      insert into customers (tenant_id, id, name, created_by_doc) values (${s.tenantId}, ${created}, 'زبون المندوب', ${created})`;
    await settled();
    const names = async (device: TestDevice) =>
      new Set(
        (await pull(device))
          .json<PullResponse>()
          .sets.customers!.upserts.map((c) => (c as unknown as { name: string }).name),
      );
    const van = await names(w.phone);
    expect(van).toEqual(new Set(['زبون 17 أول', 'زبون 17 ثان', 'زبون المندوب']));
    const till = await names(await createDevice(s.tenantId));
    expect(till.size).toBe(7);
    expect(till.has('زبون 18 أول')).toBe(true);
    expect(other.customers.inRoute).toBeTruthy();
    // The row carries what the rep needs: the approval, the region and the place
    const row = (await pull(w.phone)).json<PullResponse>().sets.customers!.upserts[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(row)).toEqual(
      expect.arrayContaining(['approvalStatus', 'regionId', 'lat', 'lng', 'creditLimitMinor', 'priceTier']),
    );
  });

  it('scopes routes and orders to the phone’s own van, and never carries cost', async () => {
    const w = await world(s, '19');
    const other = await world(s, '20');
    const product = await ok<{ id: string }>(
      s.accessToken,
      'POST',
      '/v1/products',
      {
        nameAr: 'سلعة',
        variants: [{ price: { currency: 'SYP', priceMinor: 1000 } }],
      },
      201,
    );
    const [v] = await ownerDb()<{ id: string }[]>`select id from variants where product_id = ${product.id}`;
    const lines = ownerDb().json([{ variantId: v!.id, qty: 1000, deliveredQty: 0, unitPriceMinor: 1000 }]);
    for (const [n, branch] of [
      ['SO-A', w.van.id],
      ['SO-B', other.van.id],
    ] as const) {
      await ownerDb()`
        insert into sales_orders (tenant_id, number, branch_id, warehouse_branch_id, customer_id, business_date,
                                  currency, total_minor, lines)
        values (${s.tenantId}, ${n}, ${branch}, ${s.branchId}, ${w.customers.inRoute}, current_date, 'SYP', 1000, ${lines})`;
    }
    await settled();
    const sets = (await pull(w.phone)).json<PullResponse>().sets;
    expect(sets.routes!.upserts.map((r) => (r as { id: string }).id)).toEqual([w.route.id]);
    expect(sets.sales_orders!.upserts.map((r) => (r as unknown as { number: string }).number)).toEqual([
      'SO-A',
    ]);
    expect(JSON.stringify(sets.sales_orders)).not.toMatch(/cost/i);
    expect(Object.keys(sets.sales_orders!.upserts[0]!).sort()).toEqual(
      [
        'id',
        'number',
        'status',
        'customerId',
        'branchId',
        'warehouseBranchId',
        'repId',
        'businessDate',
        'currency',
        'totalMinor',
        'depositMinor',
        'deliveryDate',
        'lines',
        'version',
      ].sort(),
    );
    // Deleting a route is announced to the phone as a deletion
    await ownerDb()`delete from route_customers where tenant_id = ${s.tenantId} and route_id = ${w.route.id}`;
    await ownerDb()`delete from routes where tenant_id = ${s.tenantId} and id = ${w.route.id}`;
    await settled();
    const cursors = Object.fromEntries(Object.entries(sets).map(([k, p]) => [k, p.cursor]));
    const next = (
      await pull(w.phone, `?cursors=${encodeURIComponent(JSON.stringify(cursors))}`)
    ).json<PullResponse>();
    expect(next.sets.routes!.deletes).toEqual([w.route.id]);
  });
});
