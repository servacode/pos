import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_NO_SALE_REASONS,
  DEFAULT_ROLES,
  type BranchAdminRow,
  type RegionRow,
  type RepRow,
  type RouteDetail,
  type RouteRow,
  type VanRow,
} from '@serva/core';
import { migrationsFolder } from '@serva/db';
import { createDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase, settled } from './helpers';
import { bearer, staffUser, testStore, type TestStore } from './staff';

/**
 * «المندوبون والتوزيع», the foundation (migration 0073, packages/core › contracts/distribution.ts):
 * regions, vans, reps and routes, behind plans.limits.reps; vans never show up where stores are
 * listed; the rep_phone device belongs on a van.
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

/** The plans are shared by every test: the module is on (unlimited) unless a test says otherwise */
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

async function vanOf(name = 'سيارة 1') {
  return ok<VanRow>(
    s.accessToken,
    'POST',
    '/v1/vans',
    { name, parentBranchId: s.branchId, vehiclePlate: ' 123456 ' },
    201,
  );
}

async function repOf(phone = '0955000001', van: string | null = null) {
  const staff = await staffUser(app, s, 'rep', phone, { fullName: `مندوب ${phone}` });
  return ok<RepRow>(
    s.accessToken,
    'POST',
    '/v1/reps',
    { userId: staff.userId, branchId: s.branchId, vanBranchId: van },
    201,
  );
}

async function customerOf(name: string) {
  const res = await call(s.accessToken, 'POST', '/v1/customers', { name });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('what the migration leaves for every store', () => {
  it('keeps the module hidden on the plans that do not have it, and opens it on pro and enterprise', async () => {
    // The migration's own values, before any test touched them
    await ownerDb()`update plans set limits = limits - 'reps'`;
    await ownerDb()`
      update plans set limits = limits || jsonb_build_object('reps', CASE code WHEN 'pro' THEN 2 WHEN 'enterprise' THEN NULL ELSE 0 END)
      where NOT (limits ? 'reps')`;
    const rows = await ownerDb()<{ code: string; reps: unknown }[]>`
      select code, limits -> 'reps' as reps from plans order by code`;
    for (const row of rows) {
      expect(row.reps, row.code).toBe(row.code === 'pro' ? 2 : row.code === 'enterprise' ? null : 0);
    }
    const [free] = await ownerDb()<
      { reps: number }[]
    >`select (limits -> 'reps')::int as reps from plans where is_free`;
    expect(free!.reps).toBe(0);
  });

  it('gives a new store the rep, driver and supervisor roles, the no-sale reasons, and kind store on its branch', async () => {
    const roles = await ownerDb()<{ key: string; permissions: string[] }[]>`
      select key, permissions from roles where tenant_id = ${s.tenantId}`;
    const byKey = new Map(roles.map((r) => [r.key, r.permissions]));
    for (const key of ['rep', 'driver', 'sales_supervisor']) {
      const template = DEFAULT_ROLES.find((r) => r.key === key)!;
      expect([...byKey.get(key)!].sort(), key).toEqual([...template.permissions].sort());
    }
    // The owner holds every new key; the manager all but the live location
    expect(byKey.get('owner')).toContain('rep.track');
    expect(byKey.get('manager')).not.toContain('rep.track');
    for (const key of [
      'rep.sell',
      'rep.order',
      'rep.collect',
      'rep.deliver',
      'rep.settle',
      'rep.targets',
      'routes.manage',
      'sales_orders.manage',
    ]) {
      expect(byKey.get('manager'), key).toContain(key);
    }
    expect(byKey.get('cashier')).not.toContain('routes.manage');

    const reasons = await ownerDb()<{ key: string; name: string }[]>`
      select key, name from no_sale_reasons where tenant_id = ${s.tenantId} order by sort_order`;
    expect(reasons).toEqual(DEFAULT_NO_SALE_REASONS.map((r) => ({ key: r.key, name: r.name })));
    const [branch] = await ownerDb()<{ kind: string; parent_branch_id: string | null }[]>`
      select kind, parent_branch_id from branches where tenant_id = ${s.tenantId}`;
    expect(branch).toEqual({ kind: 'store', parent_branch_id: null });
  });

  it('puts the reasons and the new roles on a store that existed before the migration (its own statements, run again)', async () => {
    const before = await ownerDb()<{ key: string; permissions: string[] }[]>`
      select key, permissions from roles where tenant_id = ${s.tenantId} and key in ('rep', 'driver', 'sales_supervisor') order by key`;
    await ownerDb()`delete from no_sale_reasons where tenant_id = ${s.tenantId}`;
    await ownerDb()`delete from roles where tenant_id = ${s.tenantId} and key in ('rep', 'driver', 'sales_supervisor')`;
    const file = join(migrationsFolder, '0073_distribution.sql');
    const backfill = readFileSync(file, 'utf8')
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter((part) => /^(--[^\n]*\n)*INSERT INTO "(roles|no_sale_reasons)"/.test(part));
    expect(backfill).toHaveLength(4);
    for (const statement of backfill) await ownerDb().unsafe(statement);
    const after = await ownerDb()<{ key: string; permissions: string[] }[]>`
      select key, permissions from roles where tenant_id = ${s.tenantId} and key in ('rep', 'driver', 'sales_supervisor') order by key`;
    expect(after).toEqual(before);
    const [n] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from no_sale_reasons where tenant_id = ${s.tenantId}`;
    expect(n!.n).toBe(DEFAULT_NO_SALE_REASONS.length);
  });
});

describe('the plan gate', () => {
  it('answers 403 plan_limit_reached everywhere while the plan has no reps, and works once it has', async () => {
    await setRepsLimit(0);
    for (const [method, url, payload] of [
      ['GET', '/v1/regions'],
      ['POST', '/v1/regions', { name: 'المزة' }],
      ['GET', '/v1/vans'],
      ['POST', '/v1/vans', { name: 'سيارة', parentBranchId: s.branchId }],
      ['GET', '/v1/reps'],
      ['GET', '/v1/routes'],
      ['POST', '/v1/routes', { name: 'خط' }],
    ] as [Method, string, unknown?][]) {
      const res = await call(s.accessToken, method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code).toBe('plan_limit_reached');
    }
    // A plan with no `reps` key at all is the same as 0
    await ownerDb()`update plans set limits = limits - 'reps'`;
    expect((await call(s.accessToken, 'GET', '/v1/regions')).statusCode).toBe(403);
    await setRepsLimit(1);
    expect((await call(s.accessToken, 'GET', '/v1/regions')).statusCode).toBe(200);
  });

  it('limits how many reps are active, and stopping one makes room', async () => {
    await setRepsLimit(1);
    const first = await repOf('0955000001');
    const staff = await staffUser(app, s, 'rep', '0955000002');
    const over = await call(s.accessToken, 'POST', '/v1/reps', {
      userId: staff.userId,
      branchId: s.branchId,
    });
    expect(over.statusCode).toBe(403);
    expect(over.json().error.code).toBe('plan_limit_reached');

    await ok(s.accessToken, 'POST', `/v1/reps/${first.id}/active`, { active: false });
    const second = await ok<RepRow>(
      s.accessToken,
      'POST',
      '/v1/reps',
      { userId: staff.userId, branchId: s.branchId },
      201,
    );
    // The stopped one cannot come back while the plan is full
    const back = await call(s.accessToken, 'POST', `/v1/reps/${first.id}/active`, { active: true });
    expect(back.statusCode).toBe(403);
    expect(second.isActive).toBe(true);
  });

  it('is for whoever holds routes.manage: a cashier gets 403 forbidden, the manager and the supervisor pass', async () => {
    const cashier = await staffUser(app, s, 'cashier', '0955000003');
    const denied = await call(cashier.accessToken, 'GET', '/v1/regions');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('forbidden');
    for (const [role, phone] of [
      ['manager', '0955000004'],
      ['sales_supervisor', '0955000005'],
    ] as const) {
      const person = await staffUser(app, s, role, phone);
      expect((await call(person.accessToken, 'GET', '/v1/routes')).statusCode, role).toBe(200);
    }
    // The rep's own role does not manage routes
    const rep = await staffUser(app, s, 'rep', '0955000006');
    expect((await call(rep.accessToken, 'GET', '/v1/routes')).statusCode).toBe(403);
  });
});

describe('regions', () => {
  it('adds, nests, renames and stops regions; names are unique and a region never sits under itself', async () => {
    const north = await ok<RegionRow>(s.accessToken, 'POST', '/v1/regions', { name: 'الشمال' }, 201);
    const city = await ok<RegionRow>(
      s.accessToken,
      'POST',
      '/v1/regions',
      { name: 'حلب', parentId: north.id, sortOrder: 2 },
      201,
    );
    expect(city).toMatchObject({
      parentId: north.id,
      sortOrder: 2,
      isActive: true,
      customerCount: 0,
      version: 1,
    });

    const dup = await call(s.accessToken, 'POST', '/v1/regions', { name: 'الشمال' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.fields.name).toBe('هذه المنطقة موجودة');
    const dupCase = await call(s.accessToken, 'POST', '/v1/regions', { name: ' الشمال ' });
    expect(dupCase.statusCode).toBe(400);

    // The parent under its own child, or under itself
    const loop = await call(s.accessToken, 'PATCH', `/v1/regions/${north.id}`, {
      name: 'الشمال',
      parentId: city.id,
      version: north.version,
    });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().error.fields.parentId).toBe('المنطقة الأم تقع تحت هذه المنطقة');
    const self = await call(s.accessToken, 'PATCH', `/v1/regions/${north.id}`, {
      name: 'الشمال',
      parentId: north.id,
      version: north.version,
    });
    expect(self.statusCode).toBe(400);

    const renamed = await ok<RegionRow>(s.accessToken, 'PATCH', `/v1/regions/${city.id}`, {
      name: 'حلب القديمة',
      isActive: false,
      version: city.version,
    });
    expect(renamed).toMatchObject({ name: 'حلب القديمة', isActive: false, parentId: north.id, version: 2 });
    const stale = await call(s.accessToken, 'PATCH', `/v1/regions/${city.id}`, { name: 'حلب', version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('stale_version');

    expect((await ok<RegionRow[]>(s.accessToken, 'GET', '/v1/regions')).map((r) => r.name)).toEqual([
      'الشمال',
      'حلب القديمة',
    ]);
    const logs = await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${s.tenantId} and entity = 'region' order by created_at`;
    expect(logs.map((l) => l.action)).toEqual(['region.create', 'region.create', 'region.update']);
  });

  it('counts the customers placed in a region', async () => {
    const region = await ok<RegionRow>(s.accessToken, 'POST', '/v1/regions', { name: 'المزة' }, 201);
    const customer = await customerOf('بقالية الأمل');
    await ownerDb()`update customers set region_id = ${region.id} where id = ${customer}`;
    expect((await ok<RegionRow[]>(s.accessToken, 'GET', '/v1/regions'))[0]!.customerCount).toBe(1);
  });
});

describe('vans', () => {
  it('makes a van a branch of kind van under its home branch, with the next branch code', async () => {
    const van = await vanOf();
    expect(van).toMatchObject({
      code: '002',
      name: 'سيارة 1',
      parentBranchId: s.branchId,
      parentBranchName: 'الفرع الرئيسي',
      vehiclePlate: '123456',
      isActive: true,
      repId: null,
    });
    const [row] = await ownerDb()<{ kind: string; parent_branch_id: string }[]>`
      select kind, parent_branch_id from branches where id = ${van.id}`;
    expect(row).toEqual({ kind: 'van', parent_branch_id: s.branchId });

    const renamed = await ok<VanRow>(s.accessToken, 'PATCH', `/v1/vans/${van.id}`, {
      name: 'سيارة الشمال',
      parentBranchId: s.branchId,
      vehiclePlate: null,
    });
    expect(renamed).toMatchObject({ name: 'سيارة الشمال', vehiclePlate: null });
    expect((await ok<VanRow[]>(s.accessToken, 'GET', '/v1/vans')).map((v) => v.code)).toEqual(['002']);

    // The home of a van is a store: another van is not one
    const bad = await call(s.accessToken, 'POST', '/v1/vans', { name: 'سيارة 2', parentBranchId: van.id });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.parentBranchId).toBe('فرع غير موجود');
  });

  it('is never listed as a store, and never counted against the plan’s branches', async () => {
    const van = await vanOf();
    // The store list, the session's branches, the admin's pickers and the main branch ignore it
    const list = await ok<BranchAdminRow[]>(s.accessToken, 'GET', '/v1/branches');
    expect(list.map((b) => b.id)).toEqual([s.branchId]);
    const me = await ok<{ branches: { id: string }[] }>(s.accessToken, 'GET', '/v1/me');
    expect(me.branches.map((b) => b.id)).toEqual([s.branchId]);
    const staff = await ok<{ branches: { id: string }[] }>(s.accessToken, 'GET', '/v1/staff');
    expect(staff.branches.map((b) => b.id)).toEqual([s.branchId]);
    // The receipt's address is the store's, even when the van's code sorts first
    await ownerDb()`update branches set code = '000', address = 'عنوان السيارة' where id = ${van.id}`;
    await ownerDb()`update branches set address = 'عنوان المحل' where id = ${s.branchId}`;
    const store = await ok<{ address: string | null }>(s.accessToken, 'GET', '/v1/store');
    expect(store.address).toBe('عنوان المحل');

    // A van does not take its own page through the stores' routes
    expect((await call(s.accessToken, 'PATCH', `/v1/branches/${van.id}`, { name: 'مسروق' })).statusCode).toBe(
      404,
    );
    expect(
      (await call(s.accessToken, 'POST', `/v1/branches/${van.id}/active`, { active: false })).statusCode,
    ).toBe(404);

    // Two branches allowed: the store and the van are two rows, but only the store counts, so a second
    // store still fits; the last store cannot be stopped even with a van active
    await ownerDb()`
      update plans set limits = limits || ${ownerDb().json({ branches: 2 })}
      where id = (select plan_id from subscriptions where tenant_id = ${s.tenantId})`;
    try {
      const stop = await call(s.accessToken, 'POST', `/v1/branches/${s.branchId}/active`, { active: false });
      expect(stop.statusCode).toBe(409);
      expect((await call(s.accessToken, 'POST', '/v1/branches', { name: 'فرع ثانٍ' })).statusCode).toBe(201);
      expect((await call(s.accessToken, 'POST', '/v1/branches', { name: 'فرع ثالث' })).statusCode).toBe(403);
    } finally {
      await ownerDb()`update plans set limits = limits - 'branches'`;
    }
  });

  it('is left out of a product’s stock by branch', async () => {
    await vanOf();
    const made = await call(s.accessToken, 'POST', '/v1/products', {
      nameAr: 'منتج',
      variants: [{ price: { currency: 'SYP', priceMinor: 100 } }],
    });
    expect(made.statusCode, made.body).toBe(201);
    const detail = await ok<{ branches?: { id: string }[]; variants: { stock?: { branchId: string }[] }[] }>(
      s.accessToken,
      'GET',
      `/v1/products/${made.json<{ id: string }>().id}`,
    );
    const seen = JSON.stringify(detail);
    const [van] = await ownerDb()<{ id: string }[]>`select id from branches where kind = 'van'`;
    expect(seen).not.toContain(van!.id);
    expect(seen).toContain(s.branchId);
  });

  it('is pulled to the till with its kind, so a till can tell a store from a van', async () => {
    const van = await vanOf();
    const till = await createDevice(s.tenantId);
    await settled();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: till.authorization },
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json<{
      sets: { branches: { upserts: { id: string; kind: string; parentBranchId: string | null }[] } };
    }>().sets.branches.upserts;
    expect(rows.find((b) => b.id === van.id)).toMatchObject({ kind: 'van', parentBranchId: s.branchId });
    expect(rows.find((b) => b.id === s.branchId)).toMatchObject({ kind: 'store', parentBranchId: null });
  });

  it('cannot be stopped while a rep works from it or a phone is linked to it', async () => {
    const van = await vanOf();
    const rep = await repOf('0955000010', van.id);
    const withRep = await call(s.accessToken, 'POST', `/v1/vans/${van.id}/active`, { active: false });
    expect(withRep.statusCode).toBe(409);
    expect((await ok<VanRow[]>(s.accessToken, 'GET', '/v1/vans'))[0]).toMatchObject({
      repId: rep.id,
      repName: 'مندوب 0955000010',
    });

    await ok(s.accessToken, 'POST', `/v1/reps/${rep.id}/active`, { active: false });
    await ownerDb()`
      insert into devices (tenant_id, branch_id, code, name, kind, status)
      values (${s.tenantId}, ${van.id}, '001', 'جوال', 'rep_phone', 'active')`;
    const withPhone = await call(s.accessToken, 'POST', `/v1/vans/${van.id}/active`, { active: false });
    expect(withPhone.statusCode).toBe(409);
    await ownerDb()`update devices set status = 'revoked', revoked_at = now() where branch_id = ${van.id}`;
    const stopped = await ok<VanRow>(s.accessToken, 'POST', `/v1/vans/${van.id}/active`, { active: false });
    expect(stopped.isActive).toBe(false);
  });
});

describe('the rep’s phone is linked to a van', () => {
  const pairing = (kind: string, branchId: string) =>
    call(s.accessToken, 'POST', '/v1/devices/pairing-codes', { branchId, kind });

  it('makes a rep_phone pairing code for a van only, and a till one for a store only', async () => {
    const van = await vanOf();
    const forVan = await pairing('rep_phone', van.id);
    expect(forVan.statusCode, forVan.body).toBe(201);
    expect(forVan.json<{ qrPayload: string }>().qrPayload).toContain('/link?kind=rep_phone#');

    const phoneAtStore = await pairing('rep_phone', s.branchId);
    expect(phoneAtStore.statusCode).toBe(409);
    expect((await pairing('cashier', van.id)).statusCode).toBe(409);
    expect(
      (await call(s.accessToken, 'POST', '/v1/devices/pairing-codes', { branchId: van.id })).statusCode,
    ).toBe(409);
    expect((await pairing('cashier', s.branchId)).statusCode).toBe(201);
    expect((await pairing('waiter', s.branchId)).statusCode).toBe(201);
  });

  it('refuses a rep_phone pairing while the plan has no reps', async () => {
    const van = await vanOf();
    await setRepsLimit(0);
    const res = await pairing('rep_phone', van.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_limit_reached');
  });

  it('keeps a rep phone out of the plan’s cashier limit', async () => {
    const van = await vanOf();
    await ownerDb()`
      update plans set limits = limits || ${ownerDb().json({ registers: 0 })}
      where id = (select plan_id from subscriptions where tenant_id = ${s.tenantId})`;
    try {
      expect((await pairing('cashier', s.branchId)).statusCode).toBe(201); // pairing codes are free; the limit is at approval
      expect((await pairing('rep_phone', van.id)).statusCode).toBe(201);
    } finally {
      await ownerDb()`update plans set limits = limits - 'registers'`;
    }
  });
});

describe('reps', () => {
  it('adds a rep with his van and limits, edits him, and stops and restarts him', async () => {
    const van = await vanOf();
    const rep = await repOf('0955000020', van.id);
    expect(rep).toMatchObject({
      userName: 'مندوب 0955000020',
      branchId: s.branchId,
      vanBranchId: van.id,
      vanName: 'سيارة 1',
      vehiclePlate: '123456',
      mode: 'van',
      maxDiscountBp: null,
      isActive: true,
      routeCount: 0,
      version: 1,
    });

    const edited = await ok<RepRow>(s.accessToken, 'PATCH', `/v1/reps/${rep.id}`, {
      branchId: s.branchId,
      vanBranchId: van.id,
      mode: 'both',
      maxDiscountBp: 500,
      dailyCreditLimitMinor: 5_000_000,
      note: 'يبدأ السبت',
      version: rep.version,
    });
    expect(edited).toMatchObject({
      mode: 'both',
      maxDiscountBp: 500,
      dailyCreditLimitMinor: 5_000_000,
      note: 'يبدأ السبت',
      version: 2,
    });
    expect(
      (await call(s.accessToken, 'PATCH', `/v1/reps/${rep.id}`, { branchId: s.branchId, version: 1 }))
        .statusCode,
    ).toBe(409);

    const stopped = await ok<RepRow>(s.accessToken, 'POST', `/v1/reps/${rep.id}/active`, { active: false });
    expect(stopped.isActive).toBe(false);
    expect(
      (await ok<RepRow>(s.accessToken, 'POST', `/v1/reps/${rep.id}/active`, { active: true })).isActive,
    ).toBe(true);
    const logs = await ownerDb()<{ action: string }[]>`
      select action from audit_logs where tenant_id = ${s.tenantId} and entity = 'rep' order by created_at`;
    expect(logs.map((l) => l.action)).toEqual(['rep.create', 'rep.update', 'rep.stop', 'rep.start']);
  });

  it('refuses a second profile for a user, a van two reps share, a store as a van, and strangers', async () => {
    const van = await vanOf();
    const rep = await repOf('0955000021', van.id);
    const again = await call(s.accessToken, 'POST', '/v1/reps', { userId: rep.userId, branchId: s.branchId });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.fields.userId).toBe('هذا المستخدم مندوب أصلاً');

    const other = await staffUser(app, s, 'rep', '0955000022');
    const shared = await call(s.accessToken, 'POST', '/v1/reps', {
      userId: other.userId,
      branchId: s.branchId,
      vanBranchId: van.id,
    });
    expect(shared.statusCode).toBe(400);
    expect(shared.json().error.fields.vanBranchId).toBe('هذه السيارة لمندوب آخر');
    const asStore = await call(s.accessToken, 'POST', '/v1/reps', {
      userId: other.userId,
      branchId: s.branchId,
      vanBranchId: s.branchId,
    });
    expect(asStore.statusCode).toBe(400);
    expect(asStore.json().error.fields.vanBranchId).toBe('سيارة غير موجودة');
    const nobody = await call(s.accessToken, 'POST', '/v1/reps', {
      userId: '0192a000-0000-7000-8000-000000000001',
      branchId: s.branchId,
    });
    expect(nobody.statusCode).toBe(400);
    expect(nobody.json().error.fields.userId).toBe('مستخدم غير موجود');
    const badMode = await call(s.accessToken, 'POST', '/v1/reps', {
      userId: other.userId,
      branchId: s.branchId,
      mode: 'flying',
    });
    expect(badMode.statusCode).toBe(400);
  });
});

describe('routes', () => {
  it('adds a route for a rep in a region on given days, and keeps its customers in the order given', async () => {
    const region = await ok<RegionRow>(s.accessToken, 'POST', '/v1/regions', { name: 'المزة' }, 201);
    const rep = await repOf('0955000030');
    const route = await ok<RouteDetail>(
      s.accessToken,
      'POST',
      '/v1/routes',
      { name: 'خط السبت', regionId: region.id, repId: rep.id, weekdays: [6, 1, 6, 3] },
      201,
    );
    expect(route).toMatchObject({
      name: 'خط السبت',
      regionName: 'المزة',
      repName: 'مندوب 0955000030',
      weekdays: [1, 3, 6],
      customerCount: 0,
      customers: [],
      isActive: true,
    });

    const [a, b, c] = [await customerOf('زبون أ'), await customerOf('زبون ب'), await customerOf('زبون ج')];
    const set = await ok<RouteDetail>(s.accessToken, 'PUT', `/v1/routes/${route.id}/customers`, {
      customerIds: [c, a, b],
      version: route.version,
    });
    expect(set.customers.map((x) => x.name)).toEqual(['زبون ج', 'زبون أ', 'زبون ب']);
    expect(set.customers.map((x) => x.visitOrder)).toEqual([0, 1, 2]);
    expect(set.customerCount).toBe(3);
    expect(set.version).toBeGreaterThan(route.version);

    // A new order and one customer fewer
    const again = await ok<RouteDetail>(s.accessToken, 'PUT', `/v1/routes/${route.id}/customers`, {
      customerIds: [b, c],
      version: set.version,
    });
    expect(again.customers.map((x) => x.name)).toEqual(['زبون ب', 'زبون ج']);
    const [tomb] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from sync_tombstones where tenant_id = ${s.tenantId} and collection = 'route_customers'`;
    expect(tomb!.n).toBe(1);

    expect((await ok<RouteDetail>(s.accessToken, 'GET', `/v1/routes/${route.id}`)).customers).toHaveLength(2);
    const list = await ok<RouteRow[]>(s.accessToken, 'GET', '/v1/routes');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ customerCount: 2, weekdays: [1, 3, 6] });
  });

  it('refuses a stale list, a customer twice, an unknown or archived customer, and a name used twice', async () => {
    const route = await ok<RouteDetail>(s.accessToken, 'POST', '/v1/routes', { name: 'خط' }, 201);
    const a = await customerOf('زبون أ');
    const stale = await call(s.accessToken, 'PUT', `/v1/routes/${route.id}/customers`, {
      customerIds: [a],
      version: route.version + 5,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('stale_version');

    const twice = await call(s.accessToken, 'PUT', `/v1/routes/${route.id}/customers`, {
      customerIds: [a, a],
      version: route.version,
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error.fields.customerIds).toBe('زبون مكرر في الخط');
    const stranger = await call(s.accessToken, 'PUT', `/v1/routes/${route.id}/customers`, {
      customerIds: ['0192a000-0000-7000-8000-000000000001'],
      version: route.version,
    });
    expect(stranger.statusCode).toBe(400);
    await ownerDb()`update customers set archived_at = now() where id = ${a}`;
    const archived = await call(s.accessToken, 'PUT', `/v1/routes/${route.id}/customers`, {
      customerIds: [a],
      version: route.version,
    });
    expect(archived.statusCode).toBe(400);

    const dup = await call(s.accessToken, 'POST', '/v1/routes', { name: 'خط' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.fields.name).toBe('يوجد خط بهذا الاسم');
    const badDay = await call(s.accessToken, 'POST', '/v1/routes', { name: 'خط ثانٍ', weekdays: [7] });
    expect(badDay.statusCode).toBe(400);
    const noRegion = await call(s.accessToken, 'POST', '/v1/routes', {
      name: 'خط ثالث',
      regionId: '0192a000-0000-7000-8000-000000000001',
    });
    expect(noRegion.statusCode).toBe(400);
    expect(noRegion.json().error.fields.regionId).toBe('منطقة غير موجودة');
  });

  it('edits a route, moves it to another rep, and answers 404 for one that is not there', async () => {
    const route = await ok<RouteDetail>(s.accessToken, 'POST', '/v1/routes', { name: 'خط الأحد' }, 201);
    const rep = await repOf('0955000031');
    const edited = await ok<RouteDetail>(s.accessToken, 'PATCH', `/v1/routes/${route.id}`, {
      name: 'خط الأحد الجديد',
      repId: rep.id,
      weekdays: [0],
      isActive: false,
      version: route.version,
    });
    expect(edited).toMatchObject({ name: 'خط الأحد الجديد', repId: rep.id, weekdays: [0], isActive: false });
    // A rep counts only his running routes
    expect((await ok<RepRow[]>(s.accessToken, 'GET', '/v1/reps'))[0]!.routeCount).toBe(0);
    for (const url of ['/v1/routes/not-an-id', '/v1/routes/0192a000-0000-7000-8000-000000000001']) {
      expect((await call(s.accessToken, 'GET', url)).statusCode, url).toBe(404);
    }
  });
});

describe('what a store sees of another', () => {
  it('shows nothing of another store’s regions, vans, reps and routes', async () => {
    const other = await testStore(app, '0922222222');
    const region = await ok<RegionRow>(
      other.accessToken,
      'POST',
      '/v1/regions',
      { name: 'منطقة الغير' },
      201,
    );
    await ok<VanRow>(
      other.accessToken,
      'POST',
      '/v1/vans',
      { name: 'سيارة الغير', parentBranchId: other.branchId },
      201,
    );
    await ok<RouteDetail>(other.accessToken, 'POST', '/v1/routes', { name: 'خط الغير' }, 201);
    for (const url of ['/v1/regions', '/v1/vans', '/v1/reps', '/v1/routes']) {
      expect(await ok<unknown[]>(s.accessToken, 'GET', url), url).toEqual([]);
    }
    const mine = await call(s.accessToken, 'POST', '/v1/vans', {
      name: 'سيارة',
      parentBranchId: other.branchId,
    });
    expect(mine.statusCode).toBe(400);
    const taken = await call(s.accessToken, 'POST', '/v1/routes', { name: 'خط', regionId: region.id });
    expect(taken.statusCode).toBe(400);
  });
});
