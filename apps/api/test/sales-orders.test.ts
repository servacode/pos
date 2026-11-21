import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  CommissionPlanRow,
  CommittedRow,
  CustomerDetail,
  DistributionSettings,
  NoSaleReasonRow,
  PickingList,
  RegionRow,
  RepRow,
  SalesOrderRow,
  VanRow,
} from '@serva/core';
import { hashDeviceToken } from '../src/auth/device-guard';
import { cartLine, documents, makeProduct, push, sale, shiftOpen } from './accounting-fixtures';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * «المندوبون والتوزيع», the supervisor's desk (WP1 + WP2): settings, no-sale reasons, commission plans,
 * the customer's region and approval, and pre-sale orders: they post nothing, they are computed into
 * what is promised, and the sale that names one marks it delivered.
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

const setRepsLimit = (limit: number | null) =>
  ownerDb()`update plans set limits = limits || ${ownerDb().json({ reps: limit })}`;

beforeEach(async () => {
  await resetDatabase();
  await setRepsLimit(null);
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

/** A rep_phone on a van, with a token of its own */
async function repPhone(vanId: string, code = '701'): Promise<TestDevice> {
  const token = `sdt_${randomBytes(32).toString('base64url')}`;
  const [row] = await ownerDb()<{ id: string }[]>`
    insert into devices (tenant_id, branch_id, code, name, kind, status, token_hash)
    values (${s.tenantId}, ${vanId}, ${code}, 'جوال مندوب', 'rep_phone', 'active', ${hashDeviceToken(token)})
    returning id`;
  return {
    deviceId: row!.id,
    tenantId: s.tenantId,
    branchId: vanId,
    code,
    token,
    authorization: `Device ${token}`,
  };
}

const customerOf = async (name: string, extra: Record<string, unknown> = {}) =>
  ok<CustomerDetail>(s.accessToken, 'POST', '/v1/customers', { name, ...extra }, 201);

const vanOf = () =>
  ok<VanRow>(s.accessToken, 'POST', '/v1/vans', { name: 'سيارة 1', parentBranchId: s.branchId }, 201);

const dress = async () => {
  const p = await makeProduct(app, { ...s, device: undefined as never }, 'قميص', 100_000);
  return p.variantId;
};

describe('the distribution settings', () => {
  it('reads the defaults, saves the owner’s choice, and keeps it for the next read', async () => {
    const first = await ok<DistributionSettings>(s.accessToken, 'GET', '/v1/distribution/settings');
    expect(first).toMatchObject({
      requireCustomerApproval: true,
      orderHoldDays: 7,
      invoiceOrdersAt: 'delivery',
    });
    const saved = await ok<DistributionSettings>(s.accessToken, 'PUT', '/v1/distribution/settings', {
      ...first,
      gps: true,
      orderHoldDays: 14,
      invoiceOrdersAt: 'order',
    });
    expect(saved).toMatchObject({ gps: true, orderHoldDays: 14, invoiceOrdersAt: 'order' });
    expect(await ok(s.accessToken, 'GET', '/v1/distribution/settings')).toEqual(saved);
    const bad = await call(s.accessToken, 'PUT', '/v1/distribution/settings', { ...first, orderHoldDays: 0 });
    expect(bad.statusCode).toBe(400);
    const [log] = await ownerDb()<{ changes: Record<string, unknown> }[]>`
      select changes from audit_logs where tenant_id = ${s.tenantId} and action = 'distribution.settings'`;
    expect(log!.changes).toMatchObject({ gps: [false, true], orderHoldDays: [7, 14] });
  });

  it('is hidden while the plan has no reps, and for whoever lacks routes.manage', async () => {
    const cashier = await staffUser(app, s, 'cashier', '0955100001');
    expect((await call(cashier.accessToken, 'GET', '/v1/distribution/settings')).statusCode).toBe(403);
    await setRepsLimit(0);
    const res = await call(s.accessToken, 'GET', '/v1/distribution/settings');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_limit_reached');
  });

  it('tells the menu whether the plan has the module (me.subscription.repsEnabled)', async () => {
    const on = await ok<{ subscription: { repsEnabled?: boolean } }>(s.accessToken, 'GET', '/v1/me');
    expect(on.subscription.repsEnabled).toBe(true);
    await setRepsLimit(0);
    const off = await ok<{ subscription: { repsEnabled?: boolean } }>(s.accessToken, 'GET', '/v1/me');
    expect(off.subscription.repsEnabled).toBe(false);
  });
});

describe('the no-sale reasons', () => {
  it('lists the ones that came with the store, adds one, renames and stops it, and refuses a stale edit', async () => {
    const list = await ok<NoSaleReasonRow[]>(s.accessToken, 'GET', '/v1/no-sale-reasons');
    expect(list).toHaveLength(8);
    expect(list[0]).toMatchObject({ key: 'closed', name: 'المحل مغلق' });
    const made = await ok<NoSaleReasonRow>(
      s.accessToken,
      'POST',
      '/v1/no-sale-reasons',
      { name: 'سافر صاحب المحل' },
      201,
    );
    expect(made).toMatchObject({ key: null, sortOrder: 9, isActive: true, version: 1 });
    const stopped = await ok<NoSaleReasonRow>(s.accessToken, 'PATCH', `/v1/no-sale-reasons/${made.id}`, {
      name: 'سافر',
      isActive: false,
      version: 1,
    });
    expect(stopped).toMatchObject({ name: 'سافر', isActive: false, version: 2 });
    const stale = await call(s.accessToken, 'PATCH', `/v1/no-sale-reasons/${made.id}`, {
      name: 'x y',
      version: 1,
    });
    expect(stale.statusCode).toBe(409);
    // Another store's reason is not found (no leak)
    const other = await testStore(app, '0922222222');
    const theirs = await ok<NoSaleReasonRow[]>(other.accessToken, 'GET', '/v1/no-sale-reasons');
    const res = await call(s.accessToken, 'PATCH', `/v1/no-sale-reasons/${theirs[0]!.id}`, {
      name: 'اختراق',
      version: 1,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the commission plans', () => {
  it('keeps a flat plan with a rate and a tiered one with its tiers in order, and counts the reps under it', async () => {
    const flat = await ok<CommissionPlanRow>(
      s.accessToken,
      'POST',
      '/v1/commission-plans',
      { name: 'عمولة ثابتة', basis: 'sales', mode: 'flat', rateBp: 150 },
      201,
    );
    expect(flat).toMatchObject({ mode: 'flat', rateBp: 150, tiers: null, repCount: 0, isActive: true });
    const tiered = await ok<CommissionPlanRow>(
      s.accessToken,
      'POST',
      '/v1/commission-plans',
      {
        name: 'شرائح',
        mode: 'tiered',
        basis: 'collections',
        rateBp: 999,
        tiers: [
          { fromMinor: 500_000, rateBp: 300 },
          { fromMinor: 0, rateBp: 100 },
        ],
      },
      201,
    );
    expect(tiered.rateBp).toBeNull();
    expect(tiered.tiers).toEqual([
      { fromMinor: 0, rateBp: 100 },
      { fromMinor: 500_000, rateBp: 300 },
    ]);

    expect(
      (await call(s.accessToken, 'POST', '/v1/commission-plans', { name: 'عمولة ثابتة', rateBp: 10 }))
        .statusCode,
    ).toBe(400);
    expect((await call(s.accessToken, 'POST', '/v1/commission-plans', { name: 'بلا نسبة' })).statusCode).toBe(
      400,
    );

    const rep = await staffUser(app, s, 'rep', '0955100002');
    await ok<RepRow>(
      s.accessToken,
      'POST',
      '/v1/reps',
      { userId: rep.userId, branchId: s.branchId, commissionPlanId: flat.id },
      201,
    );
    const changed = await ok<CommissionPlanRow>(s.accessToken, 'PATCH', `/v1/commission-plans/${flat.id}`, {
      name: 'عمولة ثابتة',
      mode: 'flat',
      basis: 'sales',
      rateBp: 200,
      isActive: true,
      version: flat.version,
    });
    expect(changed).toMatchObject({ rateBp: 200, repCount: 1, version: 2 });
    const stale = await call(s.accessToken, 'PATCH', `/v1/commission-plans/${flat.id}`, {
      name: 'عمولة ثابتة',
      mode: 'flat',
      rateBp: 1,
      version: 1,
    });
    expect(stale.statusCode).toBe(409);
  });
});

describe('a rep’s phone', () => {
  it('is the rep_phone paired to his van, found without being typed, or named and checked', async () => {
    const van = await vanOf();
    const phone = await repPhone(van.id);
    const staff = await staffUser(app, s, 'rep', '0955100003');
    const rep = await ok<RepRow>(
      s.accessToken,
      'POST',
      '/v1/reps',
      { userId: staff.userId, branchId: s.branchId, vanBranchId: van.id },
      201,
    );
    expect(rep).toMatchObject({ deviceId: phone.deviceId, deviceName: 'جوال مندوب' });

    // A till is not a rep's phone; a phone of another van is not his
    const till = await createDevice(s.tenantId);
    const van2 = await ok<VanRow>(
      s.accessToken,
      'POST',
      '/v1/vans',
      { name: 'سيارة 2', parentBranchId: s.branchId },
      201,
    );
    const phone2 = await repPhone(van2.id, '702');
    for (const deviceId of [till.deviceId, phone2.deviceId, '0192a3b4-c5d6-7e8f-9a0b-000000000001']) {
      const bad = await call(s.accessToken, 'PATCH', `/v1/reps/${rep.id}`, {
        branchId: s.branchId,
        vanBranchId: van.id,
        deviceId,
        version: rep.version,
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.fields.deviceId).toBeTruthy();
    }
    // Moving the rep to another van lets go of the old phone and takes the new van's
    const moved = await ok<RepRow>(s.accessToken, 'PATCH', `/v1/reps/${rep.id}`, {
      branchId: s.branchId,
      vanBranchId: van2.id,
      version: rep.version,
    });
    expect(moved.deviceId).toBe(phone2.deviceId);
  });
});

describe('who can be made a rep', () => {
  it('lists the staff with the rep role who are not reps yet, to whoever holds routes.manage', async () => {
    const first = await staffUser(app, s, 'rep', '0955100010', { fullName: 'أحمد المندوب' });
    await staffUser(app, s, 'rep', '0955100011', { fullName: 'بسام المندوب' });
    await staffUser(app, s, 'cashier', '0955100012', { fullName: 'كاشير' });
    const names = async () =>
      (await ok<{ userId: string; name: string }[]>(s.accessToken, 'GET', '/v1/reps/candidates')).map(
        (c) => c.name,
      );
    expect(await names()).toEqual(['أحمد المندوب', 'بسام المندوب']);
    await ok(s.accessToken, 'POST', '/v1/reps', { userId: first.userId, branchId: s.branchId }, 201);
    expect(await names()).toEqual(['بسام المندوب']);
    const supervisor = await staffUser(app, s, 'sales_supervisor', '0955100013');
    expect((await call(supervisor.accessToken, 'GET', '/v1/reps/candidates')).statusCode).toBe(200);
    const cashier = await staffUser(app, s, 'cashier', '0955100014');
    expect((await call(cashier.accessToken, 'GET', '/v1/reps/candidates')).statusCode).toBe(403);
  });
});

describe('customers of the distribution', () => {
  it('keeps a region and a location, filters by them, and shows approval', async () => {
    const region = await ok<RegionRow>(s.accessToken, 'POST', '/v1/regions', { name: 'المزة' }, 201);
    const shop = await customerOf('بقالية الأمل', { regionId: region.id, lat: 33.5, lng: 36.3 });
    expect(shop).toMatchObject({
      regionId: region.id,
      regionName: 'المزة',
      lat: 33.5,
      lng: 36.3,
      approvalStatus: 'approved',
    });
    await customerOf('زبون بلا منطقة');
    const inRegion = await ok<{ items: { name: string }[] }>(
      s.accessToken,
      'GET',
      `/v1/customers?regionId=${region.id}`,
    );
    expect(inRegion.items.map((c) => c.name)).toEqual(['بقالية الأمل']);

    const half = await call(s.accessToken, 'POST', '/v1/customers', { name: 'نصف موقع', lat: 33 });
    expect(half.statusCode).toBe(400);
    const nowhere = await call(s.accessToken, 'POST', '/v1/customers', {
      name: 'منطقة غريبة',
      regionId: '0192a3b4-c5d6-7e8f-9a0b-000000000002',
    });
    expect(nowhere.statusCode).toBe(400);
    expect(nowhere.json().error.fields.regionId).toBeTruthy();

    // Clearing the region
    const cleared = await ok<CustomerDetail>(s.accessToken, 'PUT', `/v1/customers/${shop.id}`, {
      name: 'بقالية الأمل',
      regionId: null,
      lat: null,
      lng: null,
    });
    expect(cleared).toMatchObject({ regionId: null, lat: null, lng: null });
  });

  it('lets the supervisor approve or refuse a customer a rep added; refusing archives', async () => {
    const shop = await customerOf('زبون المندوب');
    await ownerDb()`update customers set approval_status = 'pending' where id = ${shop.id}`;
    const pending = await ok<{ items: { id: string }[] }>(
      s.accessToken,
      'GET',
      '/v1/customers?approval=pending',
    );
    expect(pending.items.map((c) => c.id)).toEqual([shop.id]);

    const approved = await ok<CustomerDetail>(s.accessToken, 'POST', `/v1/customers/${shop.id}/approval`, {
      status: 'approved',
    });
    expect(approved).toMatchObject({ approvalStatus: 'approved', archived: false });
    const refused = await ok<CustomerDetail>(s.accessToken, 'POST', `/v1/customers/${shop.id}/approval`, {
      status: 'rejected',
    });
    expect(refused).toMatchObject({ approvalStatus: 'rejected', archived: true });
    const back = await ok<CustomerDetail>(s.accessToken, 'POST', `/v1/customers/${shop.id}/approval`, {
      status: 'approved',
    });
    expect(back).toMatchObject({ approvalStatus: 'approved', archived: false });

    const rep = await staffUser(app, s, 'rep', '0955100004');
    expect(
      (await call(rep.accessToken, 'POST', `/v1/customers/${shop.id}/approval`, { status: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(s.accessToken, 'POST', `/v1/customers/${shop.id}/approval`, { status: 'pending' }))
        .statusCode,
    ).toBe(400);
  });
});

describe('pre-sale orders', () => {
  async function orderOf(customerId: string, variantId: string, extra: Record<string, unknown> = {}) {
    return ok<SalesOrderRow>(
      s.accessToken,
      'POST',
      '/v1/sales-orders',
      {
        customerId,
        warehouseBranchId: s.branchId,
        repId: null,
        currency: 'SYP',
        lines: [{ variantId, qty: 12_500, unitPriceMinor: 80_000 }],
        ...extra,
      },
      201,
    );
  }

  it('takes an order: numbered, added up by the server, holding for the settings’ days, posting nothing', async () => {
    const customer = await customerOf('مطعم الشام');
    const variantId = await dress();
    const before = await ownerDb()<{ n: number }[]>`select count(*)::int as n from journal_entries`;
    const order = await orderOf(customer.id, variantId, {
      totalMinor: 1,
      depositMinor: 100_000,
      note: 'صباحاً',
    });
    expect(order).toMatchObject({
      number: expect.stringMatching(/^SO-\d{4}-000001$/),
      status: 'open',
      customerName: 'مطعم الشام',
      warehouseName: 'الفرع الرئيسي',
      // 12.5 units at 800.00 each; the total the client wrote was ignored
      totalMinor: 1_000_000,
      depositMinor: 100_000,
      note: 'صباحاً',
      version: 1,
    });
    expect(order.lines).toEqual([
      { variantId, qty: 12_500, deliveredQty: 0, unitPriceMinor: 80_000, name: 'قميص', sku: null },
    ]);
    const days = (new Date(order.holdUntil!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const [after] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from journal_entries`;
    expect(after!.n).toBe(before[0]!.n);
    const [stock] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from stock_levels`;
    expect(stock!.n).toBe(0);

    const second = await orderOf(customer.id, variantId);
    expect(second.number).toMatch(/000002$/);
  });

  it('refuses a bad order: unknown customer or item, a deposit above the total, a stopped customer', async () => {
    const customer = await customerOf('زبون');
    const variantId = await dress();
    const base = {
      customerId: customer.id,
      warehouseBranchId: s.branchId,
      repId: null,
      currency: 'SYP',
      lines: [{ variantId, qty: 1000, unitPriceMinor: 1000 }],
    };
    const cases: [Record<string, unknown>, string][] = [
      [{ customerId: '0192a3b4-c5d6-7e8f-9a0b-000000000003' }, 'customerId'],
      [
        { lines: [{ variantId: '0192a3b4-c5d6-7e8f-9a0b-000000000004', qty: 1000, unitPriceMinor: 1 }] },
        'lines',
      ],
      [{ depositMinor: 5000 }, 'depositMinor'],
      [{ warehouseBranchId: '0192a3b4-c5d6-7e8f-9a0b-000000000005' }, 'warehouseBranchId'],
      [{ currency: 'EUR' }, 'currency'],
    ];
    for (const [change, field] of cases) {
      const res = await call(s.accessToken, 'POST', '/v1/sales-orders', { ...base, ...change });
      expect(res.statusCode, field).toBe(400);
      expect(Object.keys(res.json().error.fields).join(), field).toContain(field);
    }
    await ownerDb()`update customers set approval_status = 'rejected' where id = ${customer.id}`;
    expect((await call(s.accessToken, 'POST', '/v1/sales-orders', base)).statusCode).toBe(400);
  });

  it('is the same order when sent again with its id, and refused for another customer', async () => {
    const a = await customerOf('زبون أول');
    const b = await customerOf('زبون ثان');
    const variantId = await dress();
    const id = '0192a3b4-c5d6-7e8f-9a0b-0000000000aa';
    const first = await orderOf(a.id, variantId, { id });
    const again = await orderOf(a.id, variantId, { id });
    expect(again.id).toBe(first.id);
    expect(again.number).toBe(first.number);
    const clash = await call(s.accessToken, 'POST', '/v1/sales-orders', {
      id,
      customerId: b.id,
      warehouseBranchId: s.branchId,
      repId: null,
      currency: 'SYP',
      lines: [{ variantId, qty: 1000, unitPriceMinor: 1 }],
    });
    expect(clash.statusCode).toBe(409);
    const [count] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from sales_orders`;
    expect(count!.n).toBe(1);
  });

  it('computes what is promised from the open orders, and lets go of a cancelled one, never touching reserved_qty', async () => {
    const customer = await customerOf('زبون');
    const variantId = await dress();
    const one = await orderOf(customer.id, variantId);
    await orderOf(customer.id, variantId, { lines: [{ variantId, qty: 2000, unitPriceMinor: 80_000 }] });
    const promised = await ok<CommittedRow[]>(s.accessToken, 'GET', '/v1/sales-orders/committed');
    expect(promised).toEqual([{ warehouseBranchId: s.branchId, variantId, qty: 14_500 }]);

    const cancelled = await ok<SalesOrderRow>(s.accessToken, 'POST', `/v1/sales-orders/${one.id}/cancel`, {
      reason: 'الزبون ألغى',
      version: one.version,
    });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'الزبون ألغى' });
    expect(
      await ok<CommittedRow[]>(
        s.accessToken,
        'GET',
        `/v1/sales-orders/committed?warehouseBranchId=${s.branchId}`,
      ),
    ).toEqual([{ warehouseBranchId: s.branchId, variantId, qty: 2000 }]);

    // A closed order cannot be cancelled or sent again, and a stale screen is told so
    const twice = await call(s.accessToken, 'POST', `/v1/sales-orders/${one.id}/cancel`, {
      reason: 'مرة ثانية',
      version: cancelled.version,
    });
    expect(twice.statusCode).toBe(409);
    const stale = await call(s.accessToken, 'POST', `/v1/sales-orders/${one.id}/cancel`, {
      reason: 'قديم',
      version: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('stale_version');

    const [level] = await ownerDb()<
      { n: number }[]
    >`select count(*)::int as n from stock_levels where reserved_qty <> 0`;
    expect(level!.n).toBe(0);
  });

  it('reads an order past its hold date as expired, and it stops promising its goods', async () => {
    const customer = await customerOf('زبون');
    const variantId = await dress();
    const order = await orderOf(customer.id, variantId);
    await ownerDb()`update sales_orders set hold_until = now() - interval '1 hour' where id = ${order.id}`;
    expect((await ok<SalesOrderRow>(s.accessToken, 'GET', `/v1/sales-orders/${order.id}`)).status).toBe(
      'expired',
    );
    expect(await ok<CommittedRow[]>(s.accessToken, 'GET', '/v1/sales-orders/committed')).toEqual([]);
    const expired = await ok<SalesOrderRow[]>(s.accessToken, 'GET', '/v1/sales-orders?status=expired');
    expect(expired.map((o) => o.id)).toEqual([order.id]);
    expect(await ok<SalesOrderRow[]>(s.accessToken, 'GET', '/v1/sales-orders?status=active')).toEqual([]);
  });

  it('lists and filters, and finds an order by its number or its customer', async () => {
    const a = await customerOf('مطعم الشام');
    const b = await customerOf('بقالية النور');
    const variantId = await dress();
    const one = await orderOf(a.id, variantId);
    await orderOf(b.id, variantId);
    expect((await ok<SalesOrderRow[]>(s.accessToken, 'GET', '/v1/sales-orders')).length).toBe(2);
    const byName = await ok<SalesOrderRow[]>(
      s.accessToken,
      'GET',
      `/v1/sales-orders?q=${encodeURIComponent('الشام')}`,
    );
    expect(byName.map((o) => o.id)).toEqual([one.id]);
    const byNumber = await ok<SalesOrderRow[]>(s.accessToken, 'GET', '/v1/sales-orders?q=000002');
    expect(byNumber.map((o) => o.customerName)).toEqual(['بقالية النور']);
    expect(
      (await ok<SalesOrderRow[]>(s.accessToken, 'GET', `/v1/sales-orders?customerId=${b.id}`)).length,
    ).toBe(1);
    expect((await call(s.accessToken, 'GET', '/v1/sales-orders?status=nonsense')).statusCode).toBe(400);
  });

  it('sends an order to a van, where its goods are now promised, and the picking list adds up the shelf', async () => {
    const customer = await customerOf('زبون');
    const variantId = await dress();
    const van = await vanOf();
    const one = await orderOf(customer.id, variantId);
    await orderOf(customer.id, variantId, { lines: [{ variantId, qty: 2500, unitPriceMinor: 80_000 }] });
    await ownerDb()`
      insert into stock_levels (tenant_id, branch_id, variant_id, qty) values (${s.tenantId}, ${s.branchId}, ${variantId}, 10000)`;

    const list = await ok<PickingList>(
      s.accessToken,
      'GET',
      `/v1/sales-orders/picking?warehouseBranchId=${s.branchId}`,
    );
    expect(list.warehouseName).toBe('الفرع الرئيسي');
    expect(list.orders).toHaveLength(2);
    expect(list.items).toEqual([{ variantId, name: 'قميص', sku: null, qty: 15_000, onHand: 10_000 }]);

    const sent = await ok<SalesOrderRow>(s.accessToken, 'POST', `/v1/sales-orders/${one.id}/assign`, {
      warehouseBranchId: van.id,
      version: one.version,
    });
    expect(sent).toMatchObject({ warehouseBranchId: van.id, warehouseName: 'سيارة 1', branchId: s.branchId });
    const promised = await ok<CommittedRow[]>(s.accessToken, 'GET', '/v1/sales-orders/committed');
    expect(promised).toEqual(
      expect.arrayContaining([
        { warehouseBranchId: van.id, variantId, qty: 12_500 },
        { warehouseBranchId: s.branchId, variantId, qty: 2500 },
      ]),
    );
    const vanList = await ok<PickingList>(
      s.accessToken,
      'GET',
      `/v1/sales-orders/picking?warehouseBranchId=${van.id}&ids=${one.id}`,
    );
    expect(vanList.items).toEqual([{ variantId, name: 'قميص', sku: null, qty: 12_500, onHand: 0 }]);

    const stale = await call(s.accessToken, 'POST', `/v1/sales-orders/${one.id}/assign`, {
      warehouseBranchId: s.branchId,
      version: one.version,
    });
    expect(stale.statusCode).toBe(409);
    const nowhere = await call(s.accessToken, 'POST', `/v1/sales-orders/${one.id}/assign`, {
      warehouseBranchId: '0192a3b4-c5d6-7e8f-9a0b-000000000006',
      version: sent.version,
    });
    expect(nowhere.statusCode).toBe(400);
  });

  it('is for sales_orders.manage on a plan with the module, and never shows another store’s order', async () => {
    const customer = await customerOf('زبون');
    const variantId = await dress();
    const order = await orderOf(customer.id, variantId);

    const rep = await staffUser(app, s, 'rep', '0955100005');
    const cashier = await staffUser(app, s, 'cashier', '0955100006');
    for (const who of [rep, cashier]) {
      expect((await call(who.accessToken, 'GET', '/v1/sales-orders')).statusCode).toBe(403);
      expect((await call(who.accessToken, 'GET', `/v1/sales-orders/${order.id}`)).statusCode).toBe(403);
    }
    const supervisor = await staffUser(app, s, 'sales_supervisor', '0955100007');
    expect((await call(supervisor.accessToken, 'GET', '/v1/sales-orders')).statusCode).toBe(200);

    const other = await testStore(app, '0933333333');
    for (const url of [`/v1/sales-orders/${order.id}`]) {
      expect((await call(other.accessToken, 'GET', url)).statusCode).toBe(404);
    }
    expect(
      (
        await call(other.accessToken, 'POST', `/v1/sales-orders/${order.id}/cancel`, {
          reason: 'اختراق',
          version: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect((await ok<SalesOrderRow[]>(other.accessToken, 'GET', '/v1/sales-orders')).length).toBe(0);

    await setRepsLimit(0);
    const res = await call(s.accessToken, 'GET', '/v1/sales-orders');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_limit_reached');
  });

  it('is taken by a rep’s phone as his own: his van, his name, sent again it is the same', async () => {
    const customer = await customerOf('زبون');
    const variantId = await dress();
    const van = await vanOf();
    const phone = await repPhone(van.id);
    const staff = await staffUser(app, s, 'rep', '0955100008', { fullName: 'سمير المندوب' });
    const rep = await ok<RepRow>(
      s.accessToken,
      'POST',
      '/v1/reps',
      { userId: staff.userId, branchId: s.branchId, vanBranchId: van.id },
      201,
    );
    const body = {
      id: '0192a3b4-c5d6-7e8f-9a0b-0000000000bb',
      customerId: customer.id,
      warehouseBranchId: s.branchId,
      repId: null,
      currency: 'SYP',
      lines: [{ variantId, qty: 3000, unitPriceMinor: 50_000, deliveredQty: 3000 }],
    };
    const post = (auth: string, payload: unknown = body) =>
      app.inject({
        method: 'POST',
        url: '/v1/device/sales-orders',
        headers: { authorization: auth },
        payload: payload as object,
      });
    const res = await post(phone.authorization);
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json<SalesOrderRow>();
    expect(order).toMatchObject({
      repId: rep.id,
      repName: 'سمير المندوب',
      branchId: van.id,
      totalMinor: 150_000,
    });
    // A phone cannot say it delivered something already
    expect(order.lines[0]!.deliveredQty).toBe(0);
    const again = await post(phone.authorization);
    expect(again.statusCode).toBe(201);
    expect(again.json<SalesOrderRow>().id).toBe(order.id);

    // Another rep's name, a till, a revoked phone and a stopped plan are refused
    expect(
      (
        await post(phone.authorization, {
          ...body,
          id: undefined,
          repId: '0192a3b4-c5d6-7e8f-9a0b-000000000007',
        })
      ).statusCode,
    ).toBe(400);
    const till = await createDevice(s.tenantId);
    const refused = await post(till.authorization, { ...body, id: undefined });
    expect(refused.statusCode).toBe(403);
    expect((await post('Device sdt_' + 'x'.repeat(43), { ...body, id: undefined })).statusCode).toBe(401);
    const rules = await app.inject({
      method: 'GET',
      url: '/v1/device/distribution/settings',
      headers: { authorization: phone.authorization },
    });
    expect(rules.json()).toMatchObject({ orderHoldDays: 7 });
    await setRepsLimit(0);
    expect((await post(phone.authorization, { ...body, id: undefined })).statusCode).toBe(403);
  });
});

describe('the sale that delivers an order', () => {
  it('marks it partial then delivered, line by line, while the sale posts and moves stock exactly as always', async () => {
    const store = {
      ...s,
      device: await createDevice(s.tenantId),
    };
    const customer = await customerOf('مطعم الشام');
    const shirt = await makeProduct(app, store, 'قميص', 100_000);
    const hat = await makeProduct(app, store, 'قبعة', 50_000);
    const created = await ok<SalesOrderRow>(
      s.accessToken,
      'POST',
      '/v1/sales-orders',
      {
        customerId: customer.id,
        warehouseBranchId: s.branchId,
        repId: null,
        currency: 'SYP',
        lines: [
          { variantId: shirt.variantId, qty: 5000, unitPriceMinor: 100_000 },
          { variantId: hat.variantId, qty: 2000, unitPriceMinor: 50_000 },
        ],
      },
      201,
    );

    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(s.userId));
    const first = doc(
      'sale',
      sale(store, open.id, {
        customerId: customer.id,
        salesOrderId: created.id,
        lines: [cartLine(1, 100_000, { productId: shirt.productId, variantId: shirt.variantId, qty: 3000 })],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 300_000 }],
      }),
    );
    const res = await push(app, store.device, [open, first]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted']);
    const part = await ok<SalesOrderRow>(s.accessToken, 'GET', `/v1/sales-orders/${created.id}`);
    expect(part.status).toBe('partial');
    expect(part.lines.map((l) => l.deliveredQty)).toEqual([3000, 0]);
    // The rest is still promised
    expect(await ok<CommittedRow[]>(s.accessToken, 'GET', '/v1/sales-orders/committed')).toEqual(
      expect.arrayContaining([
        { warehouseBranchId: s.branchId, variantId: shirt.variantId, qty: 2000 },
        { warehouseBranchId: s.branchId, variantId: hat.variantId, qty: 2000 },
      ]),
    );
    // The sale: its stock moved out of the till's branch, the order itself moved nothing
    const [moved] = await ownerDb()<{ qty: string }[]>`
      select qty::text from stock_levels where variant_id = ${shirt.variantId} and branch_id = ${s.branchId}`;
    expect(Number(moved!.qty)).toBe(-3000);

    // The rest, more than ordered of the shirts: capped at what was ordered
    const second = doc(
      'sale',
      sale(store, open.id, {
        customerId: customer.id,
        salesOrderId: created.id,
        lines: [
          cartLine(1, 100_000, { productId: shirt.productId, variantId: shirt.variantId, qty: 3000 }),
          cartLine(2, 50_000, { productId: hat.productId, variantId: hat.variantId, qty: 2000 }),
        ],
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 400_000 }],
      }),
    );
    expect((await push(app, store.device, [second])).results[0]!.status).toBe('accepted');
    const done = await ok<SalesOrderRow>(s.accessToken, 'GET', `/v1/sales-orders/${created.id}`);
    expect(done.status).toBe('delivered');
    expect(done.lines.map((l) => l.deliveredQty)).toEqual([5000, 2000]);
    expect(await ok<CommittedRow[]>(s.accessToken, 'GET', '/v1/sales-orders/committed')).toEqual([]);
  });

  it('leaves an order alone when the sale is another customer’s, and a sale of an unknown order still posts', async () => {
    const store = { ...s, device: await createDevice(s.tenantId) };
    const owner = await customerOf('صاحب الطلبية');
    const stranger = await customerOf('غريب');
    const shirt = await makeProduct(app, store, 'قميص', 100_000);
    const order = await ok<SalesOrderRow>(
      s.accessToken,
      'POST',
      '/v1/sales-orders',
      {
        customerId: owner.id,
        warehouseBranchId: s.branchId,
        repId: null,
        currency: 'SYP',
        lines: [{ variantId: shirt.variantId, qty: 1000, unitPriceMinor: 100_000 }],
      },
      201,
    );
    const doc = documents(store.device);
    const open = doc('shift_open', shiftOpen(s.userId));
    const line = cartLine(1, 100_000, { productId: shirt.productId, variantId: shirt.variantId, qty: 1000 });
    const payments = [{ method: 'cash' as const, currency: 'SYP' as const, amountMinor: 100_000 }];
    const wrong = doc(
      'sale',
      sale(store, open.id, { customerId: stranger.id, salesOrderId: order.id, lines: [line], payments }),
    );
    const ghost = doc(
      'sale',
      sale(store, open.id, {
        customerId: owner.id,
        salesOrderId: '0192a3b4-c5d6-7e8f-9a0b-0000000000cc',
        lines: [line],
        payments,
      }),
    );
    const res = await push(app, store.device, [open, wrong, ghost]);
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect((await ok<SalesOrderRow>(s.accessToken, 'GET', `/v1/sales-orders/${order.id}`)).status).toBe(
      'open',
    );
    const [inv] = await ownerDb()<{ n: number }[]>`select count(*)::int as n from invoices`;
    expect(inv!.n).toBe(2);
  });
});
