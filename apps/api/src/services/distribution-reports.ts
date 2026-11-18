import { sql, type SQL } from 'drizzle-orm';
import {
  ageDebt,
  commissionOf,
  weekdayOf,
  type BoardRep,
  type BoardStop,
  type BoardStopStatus,
  type CommissionPlanRow,
  type DistributionReport,
  type DistributionReportKind,
  type DistributionReportQuery,
  type RepTargetInput,
  type RepTargetRow,
  type TargetMetric,
  type TargetScope,
  type TodayBoard,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { inScope, requirePermission, type PermissionScope } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { staleVersion } from './catalog/common';
import { baseCurrencyOf, storeToday } from './contracts-common';
import { assertRepsEnabled } from './subscription-gate';

/**
 * The supervisor's views of the reps' work (packages/core › contracts/distribution-ops.ts): the day
 * board, the monthly targets, and the distribution reports (with the commissions, report only).
 * All of it reads what is already recorded; a target is the only thing written, and it posts
 * nothing. A rep's sales are the invoices he rang up (`cashier_id` = his user), his collections the
 * receipts he took, and every figure respects the branches the viewer's permission covers.
 */

const notFound = (what: string) => new AppError(404, 'not_found', `${what} غير موجود.`);
const bad = (field: string, message: string) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { [field]: message });
const num = (v: string | number | null | undefined) => Number(v ?? 0);

async function guard(
  tx: Transaction,
  auth: AccessClaims,
  permission: 'report.view' | 'rep.targets',
): Promise<PermissionScope> {
  const scope = await requirePermission(tx, auth.userId, permission);
  await assertRepsEnabled(tx);
  return scope;
}

/** A condition on the branch column limited to what the permission covers */
function inBranchScope(scope: PermissionScope, column: SQL): SQL {
  if (scope.all) return sql`true`;
  if (scope.branchIds.size === 0) return sql`false`;
  return sql`${column} in (${sql.join(
    [...scope.branchIds].map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

interface Rep {
  id: string;
  userId: string;
  name: string;
  branchId: string;
  vanBranchId: string | null;
  vanName: string | null;
  commissionPlanId: string | null;
}

/** The reps the viewer may see (active or not, since a stopped rep's old figures still matter), optionally one */
async function repsOf(tx: Transaction, scope: PermissionScope, repId?: string): Promise<Rep[]> {
  const rows = await tx.execute<{
    id: string;
    user_id: string;
    name: string;
    branch_id: string;
    van_branch_id: string | null;
    van_name: string | null;
    commission_plan_id: string | null;
  }>(sql`
    select r.id, r.user_id, u.full_name as name, r.branch_id, r.van_branch_id, v.name as van_name,
           r.commission_plan_id
    from sales_reps r
    join users u on u.tenant_id = r.tenant_id and u.id = r.user_id
    left join branches v on v.tenant_id = r.tenant_id and v.id = r.van_branch_id
    where ${inBranchScope(scope, sql`r.branch_id`)} ${repId ? sql`and r.id = ${repId}` : sql``}
    order by u.full_name, r.id`);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    branchId: r.branch_id,
    vanBranchId: r.van_branch_id,
    vanName: r.van_name,
    commissionPlanId: r.commission_plan_id,
  }));
}

const uuids = (ids: readonly string[]) =>
  ids.length === 0
    ? sql`null::uuid`
    : sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      );

// ─── What a rep did, in a period ────────────────────────────────────────────

interface Figures {
  invoices: number;
  salesMinor: number;
  returnsMinor: number;
  returnsQty: number;
  receipts: number;
  collectedMinor: number;
}

/** Sales, returns and collections of these reps over a period, by rep (`userId` → figures); collections in the base currency only */
async function figuresOf(
  tx: Transaction,
  reps: readonly Rep[],
  from: string,
  to: string,
  base: string,
): Promise<Map<string, Figures>> {
  const out = new Map<string, Figures>();
  for (const r of reps)
    out.set(r.userId, {
      invoices: 0,
      salesMinor: 0,
      returnsMinor: 0,
      returnsQty: 0,
      receipts: 0,
      collectedMinor: 0,
    });
  if (reps.length === 0) return out;
  const users = uuids(reps.map((r) => r.userId));
  const sold = await tx.execute<{ id: string; n: string; total: string }>(sql`
    select cashier_id as id, count(*)::text as n, sum(total_minor)::text as total from invoices
    where cashier_id in (${users}) and business_date between ${from}::date and ${to}::date group by cashier_id`);
  for (const s of sold) {
    const f = out.get(s.id);
    if (f) {
      f.invoices = num(s.n);
      f.salesMinor = num(s.total);
    }
  }
  const back = await tx.execute<{ id: string; total: string }>(sql`
    select cashier_id as id, sum(total_minor)::text as total from sale_returns
    where cashier_id in (${users}) and business_date between ${from}::date and ${to}::date group by cashier_id`);
  for (const b of back) {
    const f = out.get(b.id);
    if (f) f.returnsMinor = num(b.total);
  }
  const paid = await tx.execute<{ id: string; n: string; total: string }>(sql`
    select cashier_id as id, count(*)::text as n,
           coalesce(sum(amount_minor) filter (where currency = ${base}), 0)::text as total
    from receipts
    where cashier_id in (${users}) and business_date between ${from}::date and ${to}::date group by cashier_id`);
  for (const p of paid) {
    const f = out.get(p.id);
    if (f) {
      f.receipts = num(p.n);
      f.collectedMinor = num(p.total);
    }
  }
  return out;
}

// ─── The day board ──────────────────────────────────────────────────────────

const OUTCOME_ORDER = ['sale', 'order', 'collection', 'return', 'no_sale', 'none'] as const;

/** GET /v1/distribution/today */
export function todayBoard(db: Database, auth: AccessClaims, date: string | undefined): Promise<TodayBoard> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await guard(tx, auth, 'report.view');
    const day = date ?? (await storeToday(tx, auth.tenantId));
    const weekday = weekdayOf(day);
    const base = await baseCurrencyOf(tx, auth.tenantId);
    const reps = (await repsOf(tx, scope)).filter(Boolean);
    const stopsRows = await tx.execute<{
      rep_id: string;
      route_name: string;
      customer_id: string;
      name: string;
    }>(sql`
      select rt.rep_id, rt.name as route_name, rc.customer_id, c.name
      from routes rt
      join route_customers rc on rc.tenant_id = rt.tenant_id and rc.route_id = rt.id
      join customers c on c.tenant_id = rc.tenant_id and c.id = rc.customer_id and c.archived_at is null
      where rt.is_active and rt.rep_id is not null and ${weekday}::int = any(rt.weekdays)
      order by rt.sort_order, rt.name, rc.visit_order, rc.created_at`);
    const visits = await tx.execute<{
      rep_id: string;
      customer_id: string;
      customer_name: string;
      arrived_at: string;
      left_at: string | null;
      outcome: string;
    }>(sql`
      select v.rep_id, v.customer_id, c.name as customer_name, v.arrived_at, v.left_at, v.outcome
      from rep_visits v
      join rep_days d on d.tenant_id = v.tenant_id and d.id = v.rep_day_id
      join customers c on c.tenant_id = v.tenant_id and c.id = v.customer_id
      where d.business_date = ${day}::date order by v.arrived_at`);
    const days = await tx.execute<{ rep_id: string; status: 'open' | 'closed' }>(
      sql`select rep_id, status from rep_days where business_date = ${day}::date`,
    );
    const figures = await figuresOf(tx, reps, day, day, base);
    const board: BoardRep[] = reps
      .filter((r) => r.vanBranchId !== null || visits.some((v) => v.rep_id === r.id))
      .map((rep) => {
        const mine = visits.filter((v) => v.rep_id === rep.id);
        const planned = stopsRows.filter((s) => s.rep_id === rep.id);
        const seen = new Set<string>();
        const stops: BoardStop[] = [];
        for (const s of planned) {
          if (seen.has(s.customer_id)) continue;
          seen.add(s.customer_id);
          stops.push(stopOf(s.customer_id, s.name, mine));
        }
        // A customer visited off his route still shows, after the planned ones
        for (const v of mine) {
          if (seen.has(v.customer_id)) continue;
          seen.add(v.customer_id);
          stops.push(stopOf(v.customer_id, v.customer_name, mine));
        }
        const here = mine.findLast((v) => v.left_at === null);
        const f = figures.get(rep.userId);
        const count = (o: string) => mine.filter((v) => v.outcome === o).length;
        return {
          repId: rep.id,
          name: rep.name,
          vanName: rep.vanName,
          day: days.find((d) => d.rep_id === rep.id)?.status ?? 'none',
          routeNames: [...new Set(planned.filter((s) => s.rep_id === rep.id).map((s) => s.route_name))],
          stops,
          planned: planned.length === 0 ? 0 : new Set(planned.map((s) => s.customer_id)).size,
          visited: new Set(mine.map((v) => v.customer_id)).size,
          currentCustomer: here ? here.customer_name : null,
          lastVisitAt: mine.length > 0 ? new Date(mine[mine.length - 1]!.arrived_at).toISOString() : null,
          sales: count('sale'),
          orders: count('order'),
          collections: count('collection'),
          returns: count('return'),
          noSales: count('no_sale'),
          salesTotalMinor: f?.salesMinor ?? 0,
          collectedMinor: f?.collectedMinor ?? 0,
        };
      });
    return { date: day, baseCurrency: base, reps: board };
  });
}

function stopOf(
  customerId: string,
  name: string,
  visits: { customer_id: string; arrived_at: string; left_at: string | null; outcome: string }[],
): BoardStop {
  const own = visits.filter((v) => v.customer_id === customerId);
  if (own.length === 0) return { customerId, name, status: 'todo', arrivedAt: null };
  const open = own.find((v) => v.left_at === null && v.outcome === 'none');
  const best = OUTCOME_ORDER.find((o) => own.some((v) => v.outcome === o)) ?? 'none';
  const status: BoardStopStatus = open && best === 'none' ? 'here' : best;
  return { customerId, name, status, arrivedAt: new Date(own[0]!.arrived_at).toISOString() };
}

// ─── Targets ────────────────────────────────────────────────────────────────

type TargetDb = {
  id: string;
  rep_id: string;
  period_start: string;
  period_end: string;
  metric: TargetMetric;
  scope: TargetScope;
  product_id: string | null;
  category_id: string | null;
  target_value: string;
  version: number;
  scope_name: string | null;
};

/** What the rep actually did against one target, in the target's own unit */
async function actualOf(tx: Transaction, rep: Rep, t: TargetDb, base: string): Promise<number> {
  const from = t.period_start;
  const to = t.period_end;
  if (t.metric === 'collections') {
    const [row] = await tx.execute<{ total: string }>(sql`
      select coalesce(sum(amount_minor), 0)::text as total from receipts
      where cashier_id = ${rep.userId} and currency = ${base} and business_date between ${from}::date and ${to}::date`);
    return num(row?.total);
  }
  if (t.metric === 'new_customers') {
    if (!rep.vanBranchId) return 0;
    const [row] = await tx.execute<{ n: string }>(sql`
      select count(distinct c.id)::text as n from customers c
      join sync_inbox x on x.tenant_id = c.tenant_id and x.doc_id = c.created_by_doc
      join devices d on d.tenant_id = x.tenant_id and d.id = x.device_id
      where d.branch_id = ${rep.vanBranchId} and x.business_date between ${from}::date and ${to}::date`);
    return num(row?.n);
  }
  const money = t.metric === 'net_sales';
  const scoped =
    t.scope === 'product'
      ? sql`and l.product_id = ${t.product_id}`
      : t.scope === 'category'
        ? sql`and l.product_id in (select id from products where category_id = ${t.category_id})`
        : sql``;
  const column = money ? sql`l.total_minor` : sql`l.base_qty`;
  const [sold] = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(${column}), 0)::text as total
    from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
    where i.cashier_id = ${rep.userId} and i.business_date between ${from}::date and ${to}::date ${scoped}`);
  const returnColumn = money ? sql`l.total_minor` : sql`l.base_qty`;
  const [back] = await tx.execute<{ total: string }>(sql`
    select coalesce(sum(${returnColumn}), 0)::text as total
    from sale_return_lines l join sale_returns r on r.tenant_id = l.tenant_id and r.id = l.return_id
    where r.cashier_id = ${rep.userId} and r.business_date between ${from}::date and ${to}::date ${scoped}`);
  return Math.max(0, num(sold?.total) - num(back?.total));
}

const targetSelect = sql`
  select t.id, t.rep_id, t.period_start::text as period_start, t.period_end::text as period_end, t.metric, t.scope,
         t.product_id, t.category_id, t.target_value::text as target_value, t.version,
         coalesce(p.name_ar, c.name) as scope_name
  from rep_targets t
  left join products p on p.tenant_id = t.tenant_id and p.id = t.product_id
  left join categories c on c.tenant_id = t.tenant_id and c.id = t.category_id`;

async function targetRows(
  tx: Transaction,
  tenantId: string,
  rows: TargetDb[],
  reps: Rep[],
): Promise<RepTargetRow[]> {
  const base = await baseCurrencyOf(tx, tenantId);
  const out: RepTargetRow[] = [];
  for (const t of rows) {
    const rep = reps.find((r) => r.id === t.rep_id);
    if (!rep) continue;
    const target = num(t.target_value);
    const actual = await actualOf(tx, rep, t, base);
    out.push({
      id: t.id,
      repId: t.rep_id,
      repName: rep.name,
      periodStart: t.period_start,
      periodEnd: t.period_end,
      metric: t.metric,
      scope: t.scope,
      productId: t.product_id,
      categoryId: t.category_id,
      scopeName: t.scope_name,
      targetValue: target,
      actualValue: actual,
      percent: target === 0 ? null : Math.round((actual / target) * 100),
      version: t.version,
    });
  }
  return out;
}

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
};

/** GET /v1/rep-targets */
export function listTargets(
  db: Database,
  auth: AccessClaims,
  query: { repId?: string | undefined; month?: string | undefined },
): Promise<RepTargetRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await guard(tx, auth, 'rep.targets');
    const reps = await repsOf(tx, scope, query.repId);
    if (reps.length === 0) return [];
    const range = query.month ? monthRange(query.month) : null;
    const rows = await tx.execute<TargetDb>(sql`${targetSelect}
      where t.rep_id in (${uuids(reps.map((r) => r.id))})
        ${range ? sql`and t.period_start <= ${range.end}::date and t.period_end >= ${range.start}::date` : sql``}
      order by t.period_start desc, t.created_at desc limit 500`);
    return targetRows(tx, auth.tenantId, rows, reps);
  });
}

async function checkTarget(tx: Transaction, auth: AccessClaims, input: RepTargetInput): Promise<Rep> {
  const scope = await guard(tx, auth, 'rep.targets');
  const [rep] = await repsOf(tx, scope, input.repId);
  if (!rep) throw notFound('هذا المندوب');
  if (input.scope === 'product') {
    const [p] = await tx.execute<{ id: string }>(sql`select id from products where id = ${input.productId}`);
    if (!p) throw bad('productId', 'المنتج غير موجود');
  }
  if (input.scope === 'category') {
    const [c] = await tx.execute<{ id: string }>(
      sql`select id from categories where id = ${input.categoryId}`,
    );
    if (!c) throw bad('categoryId', 'التصنيف غير موجود');
  }
  if (input.scope !== 'all' && input.metric !== 'net_sales' && input.metric !== 'qty') {
    throw bad('scope', 'التحصيل والزبائن الجدد لا يُحسبان لمنتج أو تصنيف');
  }
  return rep;
}

/** POST /v1/rep-targets */
export function createTarget(
  db: Database,
  auth: AccessClaims,
  input: RepTargetInput,
  meta: RequestMeta,
): Promise<RepTargetRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const rep = await checkTarget(tx, auth, input);
    const [made] = await tx.execute<{ id: string }>(sql`
      insert into rep_targets (tenant_id, rep_id, period_start, period_end, metric, scope, product_id, category_id, target_value)
      values (${auth.tenantId}, ${input.repId}, ${input.periodStart}::date, ${input.periodEnd}::date, ${input.metric},
              ${input.scope}, ${input.scope === 'product' ? input.productId : null},
              ${input.scope === 'category' ? input.categoryId : null}, ${input.targetValue})
      returning id`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep_target.create',
        entity: 'rep_target',
        entityId: made!.id,
        changes: { targetValue: [null, input.targetValue], metric: [null, input.metric] },
      },
      meta,
    );
    const [row] = await tx.execute<TargetDb>(sql`${targetSelect} where t.id = ${made!.id}`);
    return (await targetRows(tx, auth.tenantId, [row!], [rep]))[0]!;
  });
}

/** PUT /v1/rep-targets/{id}: only the figure changes (a different metric or period is a new target) */
export function updateTarget(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: { targetValue: number; version: number },
  meta: RequestMeta,
): Promise<RepTargetRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await guard(tx, auth, 'rep.targets');
    const [row] = await tx.execute<TargetDb>(sql`${targetSelect} where t.id = ${id}`);
    const [rep] = row ? await repsOf(tx, scope, row.rep_id) : [];
    if (!row || !rep) throw notFound('هذا الهدف');
    if (row.version !== input.version) throw staleVersion();
    await tx.execute(sql`
      update rep_targets set target_value = ${input.targetValue}, version = version + 1, updated_at = now() where id = ${id}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep_target.update',
        entity: 'rep_target',
        entityId: id,
        changes: { targetValue: [num(row.target_value), input.targetValue] },
      },
      meta,
    );
    const [fresh] = await tx.execute<TargetDb>(sql`${targetSelect} where t.id = ${id}`);
    return (await targetRows(tx, auth.tenantId, [fresh!], [rep]))[0]!;
  });
}

/** DELETE /v1/rep-targets/{id} */
export function deleteTarget(db: Database, auth: AccessClaims, id: string, meta: RequestMeta): Promise<void> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await guard(tx, auth, 'rep.targets');
    const [row] = await tx.execute<{ rep_id: string; branch_id: string }>(sql`
      select t.rep_id, r.branch_id from rep_targets t join sales_reps r on r.tenant_id = t.tenant_id and r.id = t.rep_id
      where t.id = ${id}`);
    if (!row || !inScope(scope, row.branch_id)) throw notFound('هذا الهدف');
    await tx.execute(sql`delete from rep_targets where id = ${id}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep_target.delete',
        entity: 'rep_target',
        entityId: id,
      },
      meta,
    );
  });
}

// ─── Reports ────────────────────────────────────────────────────────────────

type Cell = string | number | null;
type Col = DistributionReport['columns'][number];
const col = (key: string, label: string, kind: Col['kind'] = 'text'): Col => ({ key, label, kind });

const sum = (rows: Record<string, Cell>[], key: string) =>
  rows.reduce((n, r) => n + num(r[key] as number), 0);

/** GET /v1/distribution/reports/{kind} */
export function distributionReport(
  db: Database,
  auth: AccessClaims,
  kind: DistributionReportKind,
  query: DistributionReportQuery,
): Promise<DistributionReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await guard(tx, auth, 'report.view');
    const base = await baseCurrencyOf(tx, auth.tenantId);
    const reps = await repsOf(tx, scope, query.repId);
    const { from, to } = query;
    const made = (
      columns: Col[],
      rows: Record<string, Cell>[],
      totalKeys: string[] = [],
      note: string | null = null,
    ): DistributionReport => ({
      kind,
      from,
      to,
      baseCurrency: base,
      columns,
      rows,
      totals:
        totalKeys.length > 0 && rows.length > 0
          ? { [columns[0]!.key]: 'المجموع', ...Object.fromEntries(totalKeys.map((k) => [k, sum(rows, k)])) }
          : null,
      note,
    });
    if (query.repId && reps.length === 0) throw notFound('هذا المندوب');
    const users = uuids(reps.map((r) => r.userId));
    const repName = new Map(reps.map((r) => [r.userId, r.name]));
    const days = sql`between ${from}::date and ${to}::date`;

    switch (kind) {
      case 'sales_by_rep': {
        const f = await figuresOf(tx, reps, from, to, base);
        const rows = reps.map((r) => {
          const x = f.get(r.userId)!;
          return {
            rep: r.name,
            invoices: x.invoices,
            sales: x.salesMinor,
            returns: x.returnsMinor,
            net: x.salesMinor - x.returnsMinor,
          };
        });
        return made(
          [
            col('rep', 'المندوب'),
            col('invoices', 'الفواتير', 'int'),
            col('sales', 'المبيعات', 'money'),
            col('returns', 'المرتجع', 'money'),
            col('net', 'الصافي', 'money'),
          ],
          rows,
          ['invoices', 'sales', 'returns', 'net'],
        );
      }
      case 'sales_by_route': {
        const rows = await tx.execute<{
          route: string;
          rep: string | null;
          customers: string;
          buyers: string;
          invoices: string;
          sales: string;
        }>(sql`
          select rt.name as route, u.full_name as rep,
                 (select count(*) from route_customers rc where rc.route_id = rt.id)::text as customers,
                 count(distinct i.customer_id)::text as buyers, count(i.id)::text as invoices,
                 coalesce(sum(i.total_minor), 0)::text as sales
          from routes rt
          join sales_reps r on r.tenant_id = rt.tenant_id and r.id = rt.rep_id
          join users u on u.tenant_id = r.tenant_id and u.id = r.user_id
          left join route_customers rc on rc.tenant_id = rt.tenant_id and rc.route_id = rt.id
          left join invoices i on i.tenant_id = rt.tenant_id and i.customer_id = rc.customer_id
            and i.cashier_id = r.user_id and i.business_date ${days}
          where r.id in (${uuids(reps.map((r) => r.id))})
          group by rt.id, rt.name, u.full_name order by sum(i.total_minor) desc nulls last, rt.name`);
        return made(
          [
            col('route', 'الخط'),
            col('rep', 'المندوب'),
            col('customers', 'زبائن الخط', 'int'),
            col('buyers', 'اشترى منهم', 'int'),
            col('invoices', 'الفواتير', 'int'),
            col('sales', 'المبيعات', 'money'),
          ],
          rows.map((r) => ({
            route: r.route,
            rep: r.rep,
            customers: num(r.customers),
            buyers: num(r.buyers),
            invoices: num(r.invoices),
            sales: num(r.sales),
          })),
          ['invoices', 'sales'],
          'مبيعات المندوب لزبائن الخط وحدهم.',
        );
      }
      case 'sales_by_customer': {
        const rows = await tx.execute<{
          customer: string | null;
          reps: string;
          invoices: string;
          sales: string;
          last_sale: string;
        }>(sql`
          select coalesce(c.name, i.customer_name, 'بيع بلا زبون') as customer,
                 string_agg(distinct u.full_name, '، ') as reps, count(*)::text as invoices,
                 sum(i.total_minor)::text as sales, max(i.business_date)::text as last_sale
          from invoices i
          left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
          left join users u on u.tenant_id = i.tenant_id and u.id = i.cashier_id
          where i.cashier_id in (${users}) and i.business_date ${days}
          group by i.customer_id, coalesce(c.name, i.customer_name, 'بيع بلا زبون')
          order by sum(i.total_minor) desc limit 500`);
        return made(
          [
            col('customer', 'الزبون'),
            col('reps', 'المندوب'),
            col('invoices', 'الفواتير', 'int'),
            col('sales', 'المبيعات', 'money'),
            col('lastSale', 'آخر بيع', 'date'),
          ],
          rows.map((r) => ({
            customer: r.customer,
            reps: r.reps,
            invoices: num(r.invoices),
            sales: num(r.sales),
            lastSale: r.last_sale,
          })),
          ['invoices', 'sales'],
          'أكبر 500 زبون.',
        );
      }
      case 'sales_by_product': {
        const rows = await tx.execute<{ product: string; qty: string; sales: string }>(sql`
          select l.name as product, sum(l.base_qty)::text as qty, sum(l.total_minor)::text as sales
          from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
          where i.cashier_id in (${users}) and i.business_date ${days}
          group by l.product_id, l.name order by sum(l.total_minor) desc limit 500`);
        return made(
          [col('product', 'المنتج'), col('qty', 'الكمية', 'qty'), col('sales', 'المبيعات', 'money')],
          rows.map((r) => ({ product: r.product, qty: num(r.qty), sales: num(r.sales) })),
          ['sales'],
          'أكبر 500 منتج، قبل المرتجع.',
        );
      }
      case 'collections': {
        const rows = await tx.execute<{
          user_id: string;
          currency: string;
          n: string;
          cash: string;
          cheque: string;
          other: string;
          total: string;
        }>(sql`
          select cashier_id as user_id, currency, count(*)::text as n,
                 coalesce(sum(amount_minor) filter (where method = 'cash'), 0)::text as cash,
                 coalesce(sum(amount_minor) filter (where method = 'cheque'), 0)::text as cheque,
                 coalesce(sum(amount_minor) filter (where method not in ('cash', 'cheque')), 0)::text as other,
                 sum(amount_minor)::text as total
          from receipts where cashier_id in (${users}) and business_date ${days}
          group by cashier_id, currency order by currency, sum(amount_minor) desc`);
        return made(
          [
            col('rep', 'المندوب'),
            col('currency', 'العملة'),
            col('receipts', 'الإيصالات', 'int'),
            col('cash', 'نقداً', 'money'),
            col('cheque', 'شيكات', 'money'),
            col('other', 'أخرى', 'money'),
            col('total', 'الإجمالي', 'money'),
          ],
          rows.map((r) => ({
            rep: repName.get(r.user_id) ?? '',
            currency: r.currency,
            receipts: num(r.n),
            cash: num(r.cash),
            cheque: num(r.cheque),
            other: num(r.other),
            total: num(r.total),
          })),
          [],
          'سندات القبض التي أخذها المندوب، لكل عملة على حدة.',
        );
      }
      case 'overdue_by_rep': {
        const lines = await tx.execute<{
          rep_id: string;
          customer_id: string;
          date: string;
          debit: string;
          credit: string;
        }>(sql`
          select m.rep_id, l.party_id as customer_id, e.entry_date::text as date, l.debit_minor::text as debit,
                 l.credit_minor::text as credit
          from (select distinct rt.rep_id, rc.customer_id from route_customers rc
                join routes rt on rt.tenant_id = rc.tenant_id and rt.id = rc.route_id
                where rt.rep_id in (${uuids(reps.map((r) => r.id))})) m
          join journal_lines l on l.party_id = m.customer_id and l.party_type = 'customer'
          join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id and e.entry_date <= ${to}::date
          join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id and a.code = '1200'`);
        const rows = reps.map((rep) => {
          const own = new Map<string, { date: string; debitMinor: number; creditMinor: number }[]>();
          for (const l of lines.filter((x) => x.rep_id === rep.id)) {
            const list = own.get(l.customer_id) ?? [];
            list.push({ date: l.date, debitMinor: num(l.debit), creditMinor: num(l.credit) });
            own.set(l.customer_id, list);
          }
          let debtors = 0;
          let debt = 0;
          let overdue = 0;
          let old = 0;
          for (const list of own.values()) {
            const age = ageDebt(list, to);
            const total = age.d0_30 + age.d31_60 + age.d61_90 + age.d90_plus;
            if (total > 0) debtors += 1;
            debt += total;
            overdue += age.d31_60 + age.d61_90 + age.d90_plus;
            old += age.d90_plus;
          }
          return { rep: rep.name, debtors, debt, overdue, old };
        });
        return made(
          [
            col('rep', 'المندوب'),
            col('debtors', 'زبائن عليهم دين', 'int'),
            col('debt', 'الذمم', 'money'),
            col('overdue', 'متأخر أكثر من 30 يوماً', 'money'),
            col('old', 'أكثر من 90 يوماً', 'money'),
          ],
          rows,
          ['debtors', 'debt', 'overdue', 'old'],
          `زبائن خطوط المندوب، حتى ${to}.`,
        );
      }
      case 'van_stock': {
        const vans = reps.filter((r) => r.vanBranchId);
        const stock = await tx.execute<{ branch_id: string; items: string; qty: string }>(sql`
          select branch_id, count(*) filter (where qty <> 0)::text as items, coalesce(sum(qty), 0)::text as qty
          from stock_levels where branch_id in (${uuids(vans.map((r) => r.vanBranchId!))}) group by branch_id`);
        const orders = await tx.execute<{ branch_id: string; n: string }>(sql`
          select warehouse_branch_id as branch_id, count(*)::text as n from sales_orders
          where status in ('open', 'partial') and warehouse_branch_id in (${uuids(vans.map((r) => r.vanBranchId!))})
          group by warehouse_branch_id`);
        return made(
          [
            col('rep', 'المندوب'),
            col('van', 'السيارة'),
            col('items', 'الأصناف', 'int'),
            col('qty', 'مجموع الكميات', 'qty'),
            col('orders', 'طلبيات مفتوحة عليها', 'int'),
          ],
          vans.map((r) => ({
            rep: r.name,
            van: r.vanName,
            items: num(stock.find((s) => s.branch_id === r.vanBranchId)?.items),
            qty: num(stock.find((s) => s.branch_id === r.vanBranchId)?.qty),
            orders: num(orders.find((o) => o.branch_id === r.vanBranchId)?.n),
          })),
          ['items'],
          'ما في السيارة الآن بحسب الدفتر (بلا كلفة).',
        );
      }
      case 'returns_rate': {
        const f = await figuresOf(tx, reps, from, to, base);
        return made(
          [
            col('rep', 'المندوب'),
            col('sales', 'المبيعات', 'money'),
            col('returns', 'المرتجع', 'money'),
            col('rate', 'نسبة المرتجع', 'percent'),
          ],
          reps.map((r) => {
            const x = f.get(r.userId)!;
            return {
              rep: r.name,
              sales: x.salesMinor,
              returns: x.returnsMinor,
              rate: x.salesMinor > 0 ? Math.round((x.returnsMinor / x.salesMinor) * 1000) / 10 : null,
            };
          }),
          ['sales', 'returns'],
        );
      }
      case 'visits': {
        const rows = await tx.execute<Record<string, string>>(sql`
          select v.rep_id, count(*)::text as visits,
                 count(*) filter (where v.outcome = 'sale')::text as sale,
                 count(*) filter (where v.outcome = 'order')::text as "order",
                 count(*) filter (where v.outcome = 'collection')::text as collection,
                 count(*) filter (where v.outcome = 'return')::text as "return",
                 count(*) filter (where v.outcome = 'no_sale')::text as no_sale,
                 count(*) filter (where v.outcome = 'none')::text as none,
                 count(*) filter (where v.off_route)::text as off_route
          from rep_visits v join rep_days d on d.tenant_id = v.tenant_id and d.id = v.rep_day_id
          where v.rep_id in (${uuids(reps.map((r) => r.id))}) and d.business_date ${days} group by v.rep_id`);
        return made(
          [
            col('rep', 'المندوب'),
            col('visits', 'الزيارات', 'int'),
            col('sale', 'بيع', 'int'),
            col('order', 'طلبية', 'int'),
            col('collection', 'تحصيل', 'int'),
            col('return', 'مرتجع', 'int'),
            col('noSale', 'بلا بيع', 'int'),
            col('none', 'زيارة فقط', 'int'),
            col('offRoute', 'خارج الخط', 'int'),
          ],
          reps.map((r) => {
            const v = rows.find((x) => x.rep_id === r.id);
            return {
              rep: r.name,
              visits: num(v?.visits),
              sale: num(v?.sale),
              order: num(v?.order),
              collection: num(v?.collection),
              return: num(v?.return),
              noSale: num(v?.no_sale),
              none: num(v?.none),
              offRoute: num(v?.off_route),
            };
          }),
          ['visits', 'sale', 'order', 'collection', 'return', 'noSale', 'none', 'offRoute'],
        );
      }
      case 'no_sale_reasons': {
        const rows = await tx.execute<{ reason: string | null; n: string }>(sql`
          select coalesce(nr.name, 'بلا سبب مسجّل') as reason, count(*)::text as n
          from rep_visits v
          join rep_days d on d.tenant_id = v.tenant_id and d.id = v.rep_day_id
          left join no_sale_reasons nr on nr.tenant_id = v.tenant_id and nr.id = v.no_sale_reason_id
          where v.outcome = 'no_sale' and v.rep_id in (${uuids(reps.map((r) => r.id))}) and d.business_date ${days}
          group by coalesce(nr.name, 'بلا سبب مسجّل') order by count(*) desc`);
        const total = rows.reduce((n, r) => n + num(r.n), 0);
        return made(
          [col('reason', 'السبب'), col('visits', 'الزيارات', 'int'), col('share', 'النسبة', 'percent')],
          rows.map((r) => ({
            reason: r.reason,
            visits: num(r.n),
            share: total > 0 ? Math.round((num(r.n) / total) * 1000) / 10 : null,
          })),
          ['visits'],
        );
      }
      case 'targets': {
        const rows = reps.length
          ? await tx.execute<TargetDb>(sql`${targetSelect}
              where t.rep_id in (${uuids(reps.map((r) => r.id))}) and t.period_start <= ${to}::date and t.period_end >= ${from}::date
              order by t.period_start desc, t.created_at desc limit 500`)
          : [];
        const list = await targetRows(tx, auth.tenantId, rows, reps);
        return made(
          [
            col('rep', 'المندوب'),
            col('metric', 'المقياس'),
            col('scope', 'النطاق'),
            col('period', 'الفترة'),
            col('target', 'الهدف', 'metric'),
            col('actual', 'المحقق', 'metric'),
            col('percent', 'النسبة', 'percent'),
          ],
          list.map((t) => ({
            rep: t.repName,
            metric: t.metric,
            scope: t.scopeName,
            period: `${t.periodStart} إلى ${t.periodEnd}`,
            target: t.targetValue,
            actual: t.actualValue,
            percent: t.percent,
          })),
          [],
          'الأهداف التي تتقاطع فترتها مع الفترة المختارة.',
        );
      }
      case 'commissions': {
        const plans = await tx.execute<{
          id: string;
          name: string;
          basis: 'sales' | 'collections';
          mode: 'flat' | 'tiered';
          rate_bp: number | null;
          tiers: CommissionPlanRow['tiers'];
          returns_effect: 'deduct' | 'ignore';
        }>(sql`select id, name, basis, mode, rate_bp, tiers, returns_effect from commission_plans`);
        const f = await figuresOf(tx, reps, from, to, base);
        return made(
          [
            col('rep', 'المندوب'),
            col('plan', 'الخطة'),
            col('basis', 'الأساس'),
            col('base', 'المبلغ', 'money'),
            col('returns', 'المرتجع', 'money'),
            col('net', 'الصافي', 'money'),
            col('rate', 'النسبة', 'percent'),
            col('commission', 'العمولة', 'money'),
          ],
          reps.map((r) => {
            const x = f.get(r.userId)!;
            const plan = plans.find((p) => p.id === r.commissionPlanId);
            if (!plan) {
              return {
                rep: r.name,
                plan: null,
                basis: null,
                base: null,
                returns: null,
                net: null,
                rate: null,
                commission: null,
              };
            }
            const baseMinor = plan.basis === 'sales' ? x.salesMinor : x.collectedMinor;
            const c = commissionOf(
              {
                mode: plan.mode,
                rateBp: plan.rate_bp,
                tiers: plan.tiers,
                returnsEffect: plan.returns_effect,
              },
              baseMinor,
              x.returnsMinor,
            );
            return {
              rep: r.name,
              plan: plan.name,
              basis: plan.basis === 'sales' ? 'المبيعات' : 'التحصيل',
              base: baseMinor,
              returns: x.returnsMinor,
              net: c.netMinor,
              rate: c.rateBp / 100,
              commission: c.commissionMinor,
            };
          }),
          ['commission'],
          'تقرير فقط: لا يُرحَّل قيد. النسبة الشرائحية تُطبَّق على المبلغ كله بحسب أعلى شريحة بلغها.',
        );
      }
    }
  });
}
