import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  RegionInput,
  RegionRow,
  RegionUpdateInput,
  RepInput,
  RepMode,
  RepRow,
  RepUpdateInput,
  RouteCustomer,
  RouteCustomersInput,
  RouteDetail,
  RouteInput,
  RouteRow,
  RouteUpdateInput,
  VanInput,
  VanRow,
} from '@serva/core';
import {
  branches,
  customers,
  regions,
  routeCustomers,
  routes,
  salesReps,
  users,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { nextBranchCode } from './branches';
import { fieldError, staleVersion } from './catalog/common';
import { assertRepsEnabled, assertWithinPlanLimit } from './subscription-gate';

/**
 * «المندوبون والتوزيع» (packages/core › contracts/distribution.ts), the setup side: regions, vans,
 * reps, routes and the customers on a route. All of it is the supervisor's desk (`routes.manage`)
 * and all of it sits behind the plan's `reps` limit (0 or missing: hidden). Nothing here posts
 * money or moves stock: a van is a branch of kind `van`, and what it holds moves through the
 * ordinary transfers and stocktakes.
 */

const notFound = (what: string) => new AppError(404, 'not_found', `${what} غير موجود.`);
const conflict = (message: string) => new AppError(409, 'conflict', message);

/** Every call: the permission first, then the plan (a store whose plan has no reps module sees none of it) */
async function guard(tx: Transaction, auth: AccessClaims): Promise<void> {
  await requirePermission(tx, auth.userId, 'routes.manage');
  await assertRepsEnabled(tx);
}

const text = (v: string | null | undefined): string | null => (v === undefined || v === '' ? null : v);

// ─── Regions ────────────────────────────────────────────────────────────────

type RegionDb = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  customers: number;
  version: number;
};

const regionRow = (r: RegionDb): RegionRow => ({
  id: r.id,
  name: r.name,
  parentId: r.parent_id,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  customerCount: r.customers,
  version: r.version,
});

const regionSelect = sql`
  select r.id, r.name, r.parent_id, r.sort_order, r.is_active, r.version,
         (select count(*)::int from customers c where c.region_id = r.id and c.archived_at is null) as customers
  from regions r`;

async function readRegion(tx: Transaction, id: string): Promise<RegionRow> {
  const [row] = await tx.execute<RegionDb>(sql`${regionSelect} where r.id = ${id}`);
  if (!row) throw notFound('هذه المنطقة');
  return regionRow(row);
}

/** The parent exists, and putting the region under it makes no loop */
async function checkParent(tx: Transaction, parentId: string | null | undefined, selfId: string | null) {
  if (!parentId) return;
  if (parentId === selfId) throw fieldError('parentId', 'المنطقة لا تكون تحت نفسها');
  const [parent] = await tx.select({ id: regions.id }).from(regions).where(eq(regions.id, parentId));
  if (!parent) throw fieldError('parentId', 'المنطقة الأم غير موجودة');
  if (selfId) {
    const [loop] = await tx.execute<{ id: string }>(sql`
      with recursive up as (
        select id, parent_id from regions where id = ${parentId}
        union all
        select r.id, r.parent_id from regions r join up on r.id = up.parent_id
      )
      select id from up where id = ${selfId} limit 1`);
    if (loop) throw fieldError('parentId', 'المنطقة الأم تقع تحت هذه المنطقة');
  }
}

export function listRegions(db: Database, auth: AccessClaims): Promise<RegionRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const rows = await tx.execute<RegionDb>(sql`${regionSelect} order by r.sort_order, r.name, r.id`);
    return rows.map(regionRow);
  });
}

export function createRegion(
  db: Database,
  auth: AccessClaims,
  input: RegionInput,
  meta: RequestMeta,
): Promise<RegionRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    await checkParent(tx, input.parentId, null);
    let id: string;
    try {
      const [made] = await tx
        .insert(regions)
        .values({
          tenantId: auth.tenantId,
          name: input.name,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        })
        .returning({ id: regions.id });
      id = made!.id;
    } catch (error) {
      if (isUniqueViolation(error, 'regions_name_unique')) throw fieldError('name', 'هذه المنطقة موجودة');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'region.create',
        entity: 'region',
        entityId: id,
        changes: { name: [null, input.name] },
      },
      meta,
    );
    return readRegion(tx, id);
  });
}

export function updateRegion(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: RegionUpdateInput,
  meta: RequestMeta,
): Promise<RegionRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readRegion(tx, id);
    if (before.version !== input.version) throw staleVersion();
    const parentId = input.parentId === undefined ? before.parentId : input.parentId;
    await checkParent(tx, parentId, id);
    try {
      await tx
        .update(regions)
        .set({
          name: input.name,
          parentId,
          sortOrder: input.sortOrder ?? before.sortOrder,
          isActive: input.isActive ?? before.isActive,
        })
        .where(eq(regions.id, id));
    } catch (error) {
      if (isUniqueViolation(error, 'regions_name_unique')) throw fieldError('name', 'هذه المنطقة موجودة');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'region.update',
        entity: 'region',
        entityId: id,
        changes: { name: [before.name, input.name] },
      },
      meta,
    );
    return readRegion(tx, id);
  });
}

// ─── Vans (branches of kind van) ────────────────────────────────────────────

type VanDb = {
  id: string;
  code: string;
  name: string;
  parent_branch_id: string;
  parent_name: string;
  vehicle_plate: string | null;
  is_active: boolean;
  rep_id: string | null;
  rep_name: string | null;
};

const vanRow = (r: VanDb): VanRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  parentBranchId: r.parent_branch_id,
  parentBranchName: r.parent_name,
  vehiclePlate: r.vehicle_plate,
  isActive: r.is_active,
  repId: r.rep_id,
  repName: r.rep_name,
});

const vanSelect = sql`
  select b.id, b.code, b.name, b.parent_branch_id, p.name as parent_name, b.vehicle_plate, b.is_active,
         sr.id as rep_id, u.full_name as rep_name
  from branches b
  join branches p on p.tenant_id = b.tenant_id and p.id = b.parent_branch_id
  left join sales_reps sr on sr.tenant_id = b.tenant_id and sr.van_branch_id = b.id and sr.status = 'active'
  left join users u on u.tenant_id = sr.tenant_id and u.id = sr.user_id`;

async function readVan(tx: Transaction, id: string): Promise<VanRow> {
  const [row] = await tx.execute<VanDb>(sql`${vanSelect} where b.kind = 'van' and b.id = ${id}`);
  if (!row) throw notFound('هذه السيارة');
  return vanRow(row);
}

/** The branch a van is loaded from: an active store of this shop */
async function checkHome(tx: Transaction, branchId: string, field: string): Promise<void> {
  const [home] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.kind, 'store'), eq(branches.isActive, true)));
  if (!home) throw fieldError(field, 'فرع غير موجود');
}

export function listVans(db: Database, auth: AccessClaims): Promise<VanRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const rows = await tx.execute<VanDb>(sql`${vanSelect} where b.kind = 'van' order by b.code`);
    return rows.map(vanRow);
  });
}

export function createVan(
  db: Database,
  auth: AccessClaims,
  input: VanInput,
  meta: RequestMeta,
): Promise<VanRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    await checkHome(tx, input.parentBranchId, 'parentBranchId');
    const code = await nextBranchCode(tx);
    const [made] = await tx
      .insert(branches)
      .values({
        tenantId: auth.tenantId,
        code,
        name: input.name,
        kind: 'van',
        parentBranchId: input.parentBranchId,
        vehiclePlate: text(input.vehiclePlate),
      })
      .returning({ id: branches.id });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'van.create',
        entity: 'van',
        entityId: made!.id,
        changes: { name: [null, input.name], code: [null, code] },
      },
      meta,
    );
    return readVan(tx, made!.id);
  });
}

export function updateVan(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: VanInput,
  meta: RequestMeta,
): Promise<VanRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readVan(tx, id);
    await checkHome(tx, input.parentBranchId, 'parentBranchId');
    await tx
      .update(branches)
      .set({ name: input.name, parentBranchId: input.parentBranchId, vehiclePlate: text(input.vehiclePlate) })
      .where(eq(branches.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'van.update',
        entity: 'van',
        entityId: id,
        changes: { name: [before.name, input.name] },
      },
      meta,
    );
    return readVan(tx, id);
  });
}

/** Stops or restarts a van. One with a working phone linked, or a working rep, is emptied of them first. */
export function setVanActive(
  db: Database,
  auth: AccessClaims,
  id: string,
  active: boolean,
  meta: RequestMeta,
): Promise<VanRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readVan(tx, id);
    if (before.isActive === active) return before;
    if (!active) {
      if (before.repId) throw conflict('أوقف المندوب أو انقله إلى سيارة أخرى أولاً، ثم أوقف السيارة.');
      const [live] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from devices
        where branch_id = ${id} and status = 'active' and revoked_at is null`);
      if ((live?.n ?? 0) > 0) throw conflict('أوقف جوال المندوب من صفحة الأجهزة أولاً، ثم أوقف السيارة.');
    }
    await tx.update(branches).set({ isActive: active }).where(eq(branches.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: active ? 'van.start' : 'van.stop',
        entity: 'van',
        entityId: id,
        changes: { isActive: [before.isActive, active] },
      },
      meta,
    );
    return readVan(tx, id);
  });
}

// ─── Reps ───────────────────────────────────────────────────────────────────

type RepDb = {
  id: string;
  user_id: string;
  user_name: string;
  branch_id: string;
  branch_name: string;
  van_branch_id: string | null;
  van_name: string | null;
  vehicle_plate: string | null;
  device_id: string | null;
  device_name: string | null;
  mode: string;
  max_discount_bp: number | null;
  daily_credit_limit_minor: string | null;
  commission_plan_id: string | null;
  status: string;
  note: string | null;
  routes: number;
  version: number;
};

const repRow = (r: RepDb): RepRow => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  branchId: r.branch_id,
  branchName: r.branch_name,
  vanBranchId: r.van_branch_id,
  vanName: r.van_name,
  vehiclePlate: r.vehicle_plate,
  deviceId: r.device_id,
  deviceName: r.device_name,
  mode: r.mode as RepMode,
  maxDiscountBp: r.max_discount_bp,
  dailyCreditLimitMinor: r.daily_credit_limit_minor === null ? null : Number(r.daily_credit_limit_minor),
  commissionPlanId: r.commission_plan_id,
  isActive: r.status === 'active',
  note: r.note,
  routeCount: r.routes,
  version: r.version,
});

const repSelect = sql`
  select r.id, r.user_id, u.full_name as user_name, r.branch_id, b.name as branch_name,
         r.van_branch_id, v.name as van_name, v.vehicle_plate, r.device_id, d.name as device_name,
         r.mode, r.max_discount_bp, r.daily_credit_limit_minor::text as daily_credit_limit_minor,
         r.commission_plan_id, r.status, r.note, r.version,
         (select count(*)::int from routes x where x.rep_id = r.id and x.is_active) as routes
  from sales_reps r
  join users u on u.tenant_id = r.tenant_id and u.id = r.user_id
  join branches b on b.tenant_id = r.tenant_id and b.id = r.branch_id
  left join branches v on v.tenant_id = r.tenant_id and v.id = r.van_branch_id
  left join devices d on d.tenant_id = r.tenant_id and d.id = r.device_id`;

async function readRep(tx: Transaction, id: string): Promise<RepRow> {
  const [row] = await tx.execute<RepDb>(sql`${repSelect} where r.id = ${id}`);
  if (!row) throw notFound('هذا المندوب');
  return repRow(row);
}

/** The branch he settles in is a store; his van, when given, is a working van */
async function checkRepPlaces(
  tx: Transaction,
  input: { branchId: string; vanBranchId?: string | null; commissionPlanId?: string | null },
): Promise<void> {
  await checkHome(tx, input.branchId, 'branchId');
  if (input.vanBranchId) {
    const [van] = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, input.vanBranchId), eq(branches.kind, 'van'), eq(branches.isActive, true)));
    if (!van) throw fieldError('vanBranchId', 'سيارة غير موجودة');
  }
  if (input.commissionPlanId) {
    const [plan] = await tx.execute<{ id: string }>(
      sql`select id from commission_plans where id = ${input.commissionPlanId} and is_active`,
    );
    if (!plan) throw fieldError('commissionPlanId', 'خطة العمولة غير موجودة');
  }
}

const isVanTaken = (error: unknown) => isUniqueViolation(error, 'sales_reps_van_unique');

export function listReps(db: Database, auth: AccessClaims): Promise<RepRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const rows = await tx.execute<RepDb>(sql`${repSelect} order by u.full_name, r.id`);
    return rows.map(repRow);
  });
}

export function createRep(
  db: Database,
  auth: AccessClaims,
  input: RepInput,
  meta: RequestMeta,
): Promise<RepRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    await assertWithinPlanLimit(tx, 'reps');
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), eq(users.status, 'active')));
    if (!user) throw fieldError('userId', 'مستخدم غير موجود');
    await checkRepPlaces(tx, input);
    let id: string;
    try {
      const [made] = await tx
        .insert(salesReps)
        .values({
          tenantId: auth.tenantId,
          userId: input.userId,
          branchId: input.branchId,
          vanBranchId: input.vanBranchId ?? null,
          mode: input.mode ?? 'van',
          maxDiscountBp: input.maxDiscountBp ?? null,
          dailyCreditLimitMinor: input.dailyCreditLimitMinor ?? null,
          commissionPlanId: input.commissionPlanId ?? null,
          note: text(input.note),
        })
        .returning({ id: salesReps.id });
      id = made!.id;
    } catch (error) {
      if (isUniqueViolation(error, 'sales_reps_user_unique'))
        throw fieldError('userId', 'هذا المستخدم مندوب أصلاً');
      if (isVanTaken(error)) throw fieldError('vanBranchId', 'هذه السيارة لمندوب آخر');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep.create',
        entity: 'rep',
        entityId: id,
        changes: { userId: [null, input.userId], vanBranchId: [null, input.vanBranchId ?? null] },
      },
      meta,
    );
    return readRep(tx, id);
  });
}

export function updateRep(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: RepUpdateInput,
  meta: RequestMeta,
): Promise<RepRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readRep(tx, id);
    if (before.version !== input.version) throw staleVersion();
    const vanBranchId = input.vanBranchId === undefined ? before.vanBranchId : input.vanBranchId;
    const commissionPlanId =
      input.commissionPlanId === undefined ? before.commissionPlanId : input.commissionPlanId;
    await checkRepPlaces(tx, { branchId: input.branchId, vanBranchId, commissionPlanId });
    try {
      await tx
        .update(salesReps)
        .set({
          branchId: input.branchId,
          vanBranchId,
          mode: input.mode ?? before.mode,
          maxDiscountBp: input.maxDiscountBp === undefined ? before.maxDiscountBp : input.maxDiscountBp,
          dailyCreditLimitMinor:
            input.dailyCreditLimitMinor === undefined
              ? before.dailyCreditLimitMinor
              : input.dailyCreditLimitMinor,
          commissionPlanId,
          note: input.note === undefined ? before.note : text(input.note),
        })
        .where(eq(salesReps.id, id));
    } catch (error) {
      if (isVanTaken(error)) throw fieldError('vanBranchId', 'هذه السيارة لمندوب آخر');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep.update',
        entity: 'rep',
        entityId: id,
        changes: {
          vanBranchId: [before.vanBranchId, vanBranchId],
          branchId: [before.branchId, input.branchId],
          mode: [before.mode, input.mode ?? before.mode],
        },
      },
      meta,
    );
    return readRep(tx, id);
  });
}

/** Stops a rep (his routes stay with his name until the supervisor moves them) or takes him back, within the plan */
export function setRepActive(
  db: Database,
  auth: AccessClaims,
  id: string,
  active: boolean,
  meta: RequestMeta,
): Promise<RepRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readRep(tx, id);
    if (before.isActive === active) return before;
    if (active) await assertWithinPlanLimit(tx, 'reps');
    await tx
      .update(salesReps)
      .set({ status: active ? 'active' : 'stopped' })
      .where(eq(salesReps.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: active ? 'rep.start' : 'rep.stop',
        entity: 'rep',
        entityId: id,
        changes: { isActive: [before.isActive, active] },
      },
      meta,
    );
    return readRep(tx, id);
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

type RouteDb = {
  id: string;
  name: string;
  region_id: string | null;
  region_name: string | null;
  weekdays: number[];
  rep_id: string | null;
  rep_name: string | null;
  sort_order: number;
  is_active: boolean;
  customers: number;
  version: number;
};

const routeRow = (r: RouteDb): RouteRow => ({
  id: r.id,
  name: r.name,
  regionId: r.region_id,
  regionName: r.region_name,
  weekdays: r.weekdays,
  repId: r.rep_id,
  repName: r.rep_name,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  customerCount: r.customers,
  version: r.version,
});

const routeSelect = sql`
  select r.id, r.name, r.region_id, g.name as region_name, r.weekdays, r.rep_id, u.full_name as rep_name,
         r.sort_order, r.is_active, r.version,
         (select count(*)::int from route_customers rc where rc.route_id = r.id) as customers
  from routes r
  left join regions g on g.tenant_id = r.tenant_id and g.id = r.region_id
  left join sales_reps sr on sr.tenant_id = r.tenant_id and sr.id = r.rep_id
  left join users u on u.tenant_id = sr.tenant_id and u.id = sr.user_id`;

async function readRouteRow(tx: Transaction, id: string): Promise<RouteRow> {
  const [row] = await tx.execute<RouteDb>(sql`${routeSelect} where r.id = ${id}`);
  if (!row) throw notFound('خط السير هذا');
  return routeRow(row);
}

async function readRoute(tx: Transaction, id: string): Promise<RouteDetail> {
  const base = await readRouteRow(tx, id);
  const rows = await tx.execute<{
    customer_id: string;
    name: string;
    phone: string | null;
    region_id: string | null;
    visit_order: number;
  }>(sql`
    select rc.customer_id, c.name, c.phone, c.region_id, rc.visit_order
    from route_customers rc
    join customers c on c.tenant_id = rc.tenant_id and c.id = rc.customer_id
    where rc.route_id = ${id}
    order by rc.visit_order, c.name, rc.id`);
  const list: RouteCustomer[] = rows.map((c) => ({
    customerId: c.customer_id,
    name: c.name,
    phone: c.phone,
    regionId: c.region_id,
    visitOrder: c.visit_order,
  }));
  return { ...base, customers: list };
}

async function checkRoutePlaces(
  tx: Transaction,
  input: { regionId?: string | null; repId?: string | null },
): Promise<void> {
  if (input.regionId) {
    const [region] = await tx.select({ id: regions.id }).from(regions).where(eq(regions.id, input.regionId));
    if (!region) throw fieldError('regionId', 'منطقة غير موجودة');
  }
  if (input.repId) {
    const [rep] = await tx.select({ id: salesReps.id }).from(salesReps).where(eq(salesReps.id, input.repId));
    if (!rep) throw fieldError('repId', 'مندوب غير موجود');
  }
}

const days = (list: number[] | undefined, fallback: number[] = []): number[] =>
  list === undefined ? fallback : [...new Set(list)].sort((a, b) => a - b);

export function listRoutes(db: Database, auth: AccessClaims): Promise<RouteRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const rows = await tx.execute<RouteDb>(sql`${routeSelect} order by r.sort_order, r.name, r.id`);
    return rows.map(routeRow);
  });
}

export function getRoute(db: Database, auth: AccessClaims, id: string): Promise<RouteDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    return readRoute(tx, id);
  });
}

export function createRoute(
  db: Database,
  auth: AccessClaims,
  input: RouteInput,
  meta: RequestMeta,
): Promise<RouteDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    await checkRoutePlaces(tx, input);
    let id: string;
    try {
      const [made] = await tx
        .insert(routes)
        .values({
          tenantId: auth.tenantId,
          name: input.name,
          regionId: input.regionId ?? null,
          weekdays: days(input.weekdays),
          repId: input.repId ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        })
        .returning({ id: routes.id });
      id = made!.id;
    } catch (error) {
      if (isUniqueViolation(error, 'routes_name_unique')) throw fieldError('name', 'يوجد خط بهذا الاسم');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'route.create',
        entity: 'route',
        entityId: id,
        changes: { name: [null, input.name] },
      },
      meta,
    );
    return readRoute(tx, id);
  });
}

export function updateRoute(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: RouteUpdateInput,
  meta: RequestMeta,
): Promise<RouteDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readRouteRow(tx, id);
    if (before.version !== input.version) throw staleVersion();
    const regionId = input.regionId === undefined ? before.regionId : input.regionId;
    const repId = input.repId === undefined ? before.repId : input.repId;
    await checkRoutePlaces(tx, { regionId, repId });
    try {
      await tx
        .update(routes)
        .set({
          name: input.name,
          regionId,
          repId,
          weekdays: days(input.weekdays, before.weekdays),
          sortOrder: input.sortOrder ?? before.sortOrder,
          isActive: input.isActive ?? before.isActive,
        })
        .where(eq(routes.id, id));
    } catch (error) {
      if (isUniqueViolation(error, 'routes_name_unique')) throw fieldError('name', 'يوجد خط بهذا الاسم');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'route.update',
        entity: 'route',
        entityId: id,
        changes: { name: [before.name, input.name], repId: [before.repId, repId] },
      },
      meta,
    );
    return readRoute(tx, id);
  });
}

/** Replaces the customers of a route and their order with this list (one customer once) */
export function setRouteCustomers(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: RouteCustomersInput,
  meta: RequestMeta,
): Promise<RouteDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth);
    const before = await readRouteRow(tx, id);
    if (before.version !== input.version) throw staleVersion();
    const ids = input.customerIds;
    if (new Set(ids).size !== ids.length) throw fieldError('customerIds', 'زبون مكرر في الخط');
    if (ids.length > 0) {
      const found = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(inArray(customers.id, ids), isNull(customers.archivedAt)));
      if (found.length !== ids.length) throw fieldError('customerIds', 'زبون غير موجود أو مؤرشف');
    }
    const kept = await tx
      .select({ customerId: routeCustomers.customerId })
      .from(routeCustomers)
      .where(eq(routeCustomers.routeId, id));
    const gone = kept.map((k) => k.customerId).filter((c) => !ids.includes(c));
    if (gone.length > 0) {
      await tx
        .delete(routeCustomers)
        .where(and(eq(routeCustomers.routeId, id), inArray(routeCustomers.customerId, gone)));
    }
    for (let from = 0; from < ids.length; from += 500) {
      await tx
        .insert(routeCustomers)
        .values(
          ids.slice(from, from + 500).map((customerId, i) => ({
            tenantId: auth.tenantId,
            routeId: id,
            customerId,
            visitOrder: from + i,
          })),
        )
        .onConflictDoUpdate({
          target: [routeCustomers.tenantId, routeCustomers.routeId, routeCustomers.customerId],
          set: { visitOrder: sql`excluded.visit_order` },
          setWhere: sql`${routeCustomers.visitOrder} <> excluded.visit_order`,
        });
    }
    // The route itself moves on, so a phone that pulled it knows its customers changed
    await tx
      .update(routes)
      .set({ updatedAt: sql`now()` })
      .where(eq(routes.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'route.customers',
        entity: 'route',
        entityId: id,
        changes: { customers: [before.customerCount, ids.length] },
      },
      meta,
    );
    return readRoute(tx, id);
  });
}
