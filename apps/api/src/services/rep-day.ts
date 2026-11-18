import { sql } from 'drizzle-orm';
import {
  ageDebt,
  distributionSettingsOf,
  type RepDayStart,
  type RepVisitReport,
  weekdayOf,
  type RepDayContractPrice,
  type RepDayCustomer,
  type RepDayInvoice,
  type RepDayOrder,
  type RepDayRep,
  type RepDayRoute,
  type RepDaySheet,
  type RepVisitRecord,
  type VisitResult,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError } from '../errors';
import { baseCurrencyOf, storeToday } from './contracts-common';
import { assertRepsEnabled } from './subscription-gate';

/**
 * The rep's phone asks for its day (docs/specs/32-sales-reps.md §وضع المندوب). Everything comes from
 * the device record: the store, the branch (his van) and so the rep. Nothing in the request names
 * a rep, a customer or a van, so a phone can only ever read its own routes. Read-only except the
 * two small writes at the bottom (the day's start and a visit), which post nothing. No cost, ever.
 */

const forbidden = (message: string) => new AppError(403, 'forbidden', message);

interface RepRecord {
  rep: RepDayRep;
  repId: string;
}

/** The rep of this phone: the active rep whose van is the device's branch (one rep per van) */
async function repOfDevice(tx: Transaction, device: DeviceClaims): Promise<RepRecord> {
  await assertRepsEnabled(tx);
  const [d] = await tx.execute<{ kind: string }>(sql`select kind from devices where id = ${device.deviceId}`);
  if (d?.kind !== 'rep_phone') throw forbidden('هذا الجهاز ليس هاتف مندوب.');
  const [r] = await tx.execute<{
    id: string;
    user_id: string;
    mode: string;
    van_branch_id: string | null;
    van_name: string | null;
    vehicle_plate: string | null;
    max_discount_bp: number | null;
    daily_credit_limit_minor: string | null;
  }>(sql`
    select r.id, r.user_id, r.mode, r.van_branch_id, v.name as van_name, v.vehicle_plate,
           r.max_discount_bp, r.daily_credit_limit_minor::text
    from sales_reps r left join branches v on v.tenant_id = r.tenant_id and v.id = r.van_branch_id
    where r.van_branch_id = ${device.branchId} and r.status = 'active'`);
  if (!r) throw forbidden('لا مندوب فعّال على سيارة هذا الجهاز.');
  return {
    repId: r.id,
    rep: {
      id: r.id,
      userId: r.user_id,
      mode: r.mode as RepDayRep['mode'],
      vanBranchId: r.van_branch_id,
      vanName: r.van_name,
      vehiclePlate: r.vehicle_plate,
      maxDiscountBp: r.max_discount_bp,
      dailyCreditLimitMinor: r.daily_credit_limit_minor === null ? null : Number(r.daily_credit_limit_minor),
    },
  };
}

/** The most customers one sheet carries (a route holds at most 2000 each) */
const CUSTOMER_CAP = 3000;
const INVOICE_CAP = 300;
const RETURN_DAYS = 60;

async function routesOf(tx: Transaction, repId: string): Promise<RepDayRoute[]> {
  const routes = await tx.execute<{
    id: string;
    name: string;
    region_id: string | null;
    region_name: string | null;
    weekdays: number[];
  }>(sql`
    select r.id, r.name, r.region_id, g.name as region_name, r.weekdays
    from routes r left join regions g on g.tenant_id = r.tenant_id and g.id = r.region_id
    where r.rep_id = ${repId} and r.is_active
    order by r.sort_order, r.name`);
  if (routes.length === 0) return [];
  const members = await tx.execute<{ route_id: string; customer_id: string }>(sql`
    select rc.route_id, rc.customer_id
    from route_customers rc
    join customers c on c.tenant_id = rc.tenant_id and c.id = rc.customer_id and c.archived_at is null
    where rc.route_id in (select id from routes where rep_id = ${repId} and is_active)
    order by rc.route_id, rc.visit_order, rc.created_at`);
  return routes.map((r) => ({
    id: r.id,
    name: r.name,
    regionId: r.region_id,
    regionName: r.region_name,
    weekdays: [...r.weekdays],
    customerIds: members.filter((m) => m.route_id === r.id).map((m) => m.customer_id),
  }));
}

async function customersOf(
  tx: Transaction,
  ids: string[],
  today: string,
  repId: string,
): Promise<RepDayCustomer[]> {
  if (ids.length === 0) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute<{
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    region_id: string | null;
    approval_status: string;
    price_tier: string;
    kind: string | null;
    credit_limit_minor: string | null;
    lat: number | null;
    lng: number | null;
    last_sale: string | null;
  }>(sql`
    select c.id, c.name, c.phone, c.address, c.region_id, c.approval_status, c.price_tier, c.kind,
           c.credit_limit_minor::text, c.lat, c.lng,
           (select max(i.business_date)::text from invoices i
             where i.tenant_id = c.tenant_id and i.customer_id = c.id) as last_sale
    from customers c where c.id in (${list}) and c.archived_at is null
    order by c.name`);
  const lines = await tx.execute<{ customer_id: string; date: string; debit: string; credit: string }>(sql`
    select l.party_id as customer_id, e.entry_date::text as date, l.debit_minor::text as debit,
           l.credit_minor::text as credit
    from journal_lines l
    join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where a.code = '1200' and l.party_type = 'customer' and l.party_id in (${list})
    order by l.party_id, e.entry_date`);
  const byCustomer = new Map<string, { date: string; debitMinor: number; creditMinor: number }[]>();
  for (const l of lines) {
    const list2 = byCustomer.get(l.customer_id) ?? [];
    list2.push({ date: l.date, debitMinor: Number(l.debit), creditMinor: Number(l.credit) });
    byCustomer.set(l.customer_id, list2);
  }
  void repId;
  return rows.map((c) => {
    const own = byCustomer.get(c.id) ?? [];
    const balanceMinor = own.reduce((n, l) => n + l.debitMinor - l.creditMinor, 0);
    const age = ageDebt(own, today);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      regionId: c.region_id,
      approvalStatus: c.approval_status,
      priceTier: c.price_tier === 'wholesale' ? 'wholesale' : 'retail',
      kind: c.kind,
      creditLimitMinor: c.credit_limit_minor === null ? null : Number(c.credit_limit_minor),
      balanceMinor,
      overdueMinor: age.d31_60 + age.d61_90 + age.d90_plus,
      lat: c.lat,
      lng: c.lng,
      lastSaleDate: c.last_sale,
    };
  });
}

async function contractPricesOf(
  tx: Transaction,
  ids: string[],
  today: string,
): Promise<RepDayContractPrice[]> {
  if (ids.length === 0) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // Same rule as the till's: the customer's own price over the one for his kind, the later start first
  const rows = await tx.execute<{
    customer_id: string;
    variant_id: string;
    currency: string;
    price_minor: string;
  }>(
    sql`
    select distinct on (c.id, cp.variant_id) c.id as customer_id, cp.variant_id, cp.currency, cp.price_minor::text
    from customers c
    join contract_prices cp on cp.tenant_id = c.tenant_id
      and (cp.customer_id = c.id or (cp.customer_id is null and cp.customer_kind = c.kind))
    where c.id in (${list})
      and cp.valid_from <= ${today}::date and (cp.valid_to is null or cp.valid_to >= ${today}::date)
    order by c.id, cp.variant_id, (cp.customer_id is not null) desc, cp.valid_from desc, cp.created_at desc`,
  );
  return rows.map((r) => ({
    customerId: r.customer_id,
    variantId: r.variant_id,
    currency: r.currency,
    priceMinor: Number(r.price_minor),
  }));
}

/** Orders that still hold goods and are taken in, or filled from, his van */
async function openOrdersOf(tx: Transaction, device: DeviceClaims): Promise<RepDayOrder[]> {
  const rows = await tx.execute<{
    id: string;
    number: string;
    status: string;
    customer_id: string;
    currency: string;
    total_minor: string;
    delivery_date: string | null;
    lines: RepDayOrder['lines'];
  }>(sql`
    select id, number, status, customer_id, currency, total_minor::text, delivery_date::text, lines
    from sales_orders
    where status in ('open', 'partial')
      and (branch_id = ${device.branchId} or warehouse_branch_id = ${device.branchId})
    order by delivery_date nulls last, number
    limit 500`);
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    customerId: o.customer_id,
    currency: o.currency,
    totalMinor: Number(o.total_minor),
    deliveryDate: o.delivery_date,
    lines: (o.lines ?? []).map((l) => ({
      variantId: l.variantId,
      qty: Number(l.qty),
      deliveredQty: Number(l.deliveredQty ?? 0),
      unitPriceMinor: Number(l.unitPriceMinor ?? 0),
    })),
  }));
}

async function returnableOf(tx: Transaction, customerIds: string[]): Promise<RepDayInvoice[]> {
  if (customerIds.length === 0) return [];
  const list = sql.join(
    customerIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute<{
    id: string;
    number: string;
    customer_id: string | null;
    device_time: string;
    payload: Record<string, unknown>;
  }>(sql`
    select id, number, customer_id, device_time, payload from invoices
    where customer_id in (${list}) and device_time >= now() - (${RETURN_DAYS}::int * interval '1 day')
    order by device_time desc limit ${INVOICE_CAP}`);
  if (rows.length === 0) return [];
  const ids = sql.join(
    rows.map((r) => sql`${r.id}::uuid`),
    sql`, `,
  );
  const returned = await tx.execute<{
    sale_id: string;
    sale_line_no: number;
    qty: string;
    gross: string;
    discount: string;
    tax: string;
    total: string;
  }>(sql`
    select r.sale_id, rl.sale_line_no, sum(rl.qty)::text as qty, sum(rl.gross_ex_tax_minor)::text as gross,
           sum(rl.discount_ex_tax_minor)::text as discount, sum(rl.tax_minor)::text as tax,
           sum(rl.total_minor)::text as total
    from sale_return_lines rl
    join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
    where r.sale_id in (${ids})
    group by r.sale_id, rl.sale_line_no`);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    customerId: r.customer_id,
    deviceTime: new Date(r.device_time).toISOString(),
    payload: r.payload,
    returned: returned
      .filter((l) => l.sale_id === r.id)
      .map((l) => ({
        saleLineNo: Number(l.sale_line_no),
        qty: Number(l.qty),
        grossExTaxMinor: Number(l.gross),
        discountExTaxMinor: Number(l.discount),
        taxMinor: Number(l.tax),
        totalMinor: Number(l.total),
      })),
  }));
}

async function visitsOf(tx: Transaction, repId: string, today: string): Promise<RepVisitRecord[]> {
  const rows = await tx.execute<{
    id: string;
    customer_id: string;
    route_id: string | null;
    off_route: boolean;
    arrived_at: string;
    left_at: string | null;
    outcome: string;
    no_sale_reason_id: string | null;
    doc_ids: string[];
    note: string | null;
  }>(sql`
    select v.id, v.customer_id, v.route_id, v.off_route, v.arrived_at, v.left_at, v.outcome,
           v.no_sale_reason_id, v.doc_ids, v.note
    from rep_visits v join rep_days d on d.tenant_id = v.tenant_id and d.id = v.rep_day_id
    where v.rep_id = ${repId} and d.business_date = ${today}::date
    order by v.arrived_at`);
  return rows.map((v) => ({
    id: v.id,
    customerId: v.customer_id,
    routeId: v.route_id,
    offRoute: v.off_route,
    arrivedAt: new Date(v.arrived_at).toISOString(),
    leftAt: v.left_at ? new Date(v.left_at).toISOString() : null,
    results: v.outcome === 'none' ? [] : [v.outcome as VisitResult],
    noSaleReasonId: v.no_sale_reason_id,
    docIds: [...(v.doc_ids ?? [])],
    note: v.note,
  }));
}

/** GET /v1/device/rep/day */
export function repDaySheet(db: Database, device: DeviceClaims): Promise<RepDaySheet> {
  return withTenant(db, device.tenantId, async (tx) => {
    const { rep, repId } = await repOfDevice(tx, device);
    const businessDate = await storeToday(tx, device.tenantId);
    const weekday = weekdayOf(businessDate);
    const routes = await routesOf(tx, repId);
    const todayRouteIds = routes.filter((r) => r.weekdays.includes(weekday)).map((r) => r.id);
    const everyone = [...new Set(routes.flatMap((r) => r.customerIds))].slice(0, CUSTOMER_CAP);
    const todays = [
      ...new Set(routes.filter((r) => todayRouteIds.includes(r.id)).flatMap((r) => r.customerIds)),
    ];
    const [settingsRow] = await tx.execute<{ distribution: Record<string, unknown> | null }>(
      sql`select distribution from tenant_settings where tenant_id = ${device.tenantId}`,
    );
    const stock = await tx.execute<{ variant_id: string; qty: string }>(sql`
      select variant_id, qty::text from stock_levels where branch_id = ${device.branchId} and qty <> 0`);
    return {
      businessDate,
      weekday,
      baseCurrency: await baseCurrencyOf(tx, device.tenantId),
      rep,
      settings: distributionSettingsOf(settingsRow?.distribution),
      routes,
      todayRouteIds,
      customers: await customersOf(tx, everyone, businessDate, repId),
      contractPrices: await contractPricesOf(tx, everyone, businessDate),
      openOrders: await openOrdersOf(tx, device),
      returnable: await returnableOf(tx, todays),
      vanStock: stock.map((s) => ({ variantId: s.variant_id, qty: Number(s.qty) })),
      visits: await visitsOf(tx, repId, businessDate),
    };
  });
}

// ─── The two small writes: starting the day and recording a visit ───────────

async function dayRowOf(
  tx: Transaction,
  device: DeviceClaims,
  repId: string,
  businessDate: string,
): Promise<string> {
  const [made] = await tx.execute<{ id: string }>(sql`
    insert into rep_days (tenant_id, rep_id, business_date, status, started_at)
    values (${device.tenantId}, ${repId}, ${businessDate}::date, 'open', now())
    on conflict (tenant_id, rep_id, business_date) do update set updated_at = now()
    returning id`);
  return made!.id;
}

/** POST /v1/device/rep/day: the day starts (his float per currency, and that he confirmed the load) */
export function startRepDay(db: Database, device: DeviceClaims, input: RepDayStart): Promise<{ id: string }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const { repId } = await repOfDevice(tx, device);
    const id = await dayRowOf(tx, device, repId, input.businessDate);
    await tx.execute(sql`
      update rep_days set opening_cash = ${JSON.stringify(input.openingCash)}::jsonb,
        load_confirmed_at = case when ${input.loadConfirmed} then coalesce(load_confirmed_at, now())
                                 else load_confirmed_at end,
        updated_at = now()
      where id = ${id} and status = 'open'`);
    return { id };
  });
}

/**
 * POST /v1/device/rep/visits: one visit as the phone recorded it. The id is the phone's, so the
 * same visit sent twice (a retry) is one row; the customer, route and reason must be the store's.
 */
export function recordRepVisit(
  db: Database,
  device: DeviceClaims,
  input: RepVisitReport,
): Promise<{ id: string }> {
  return withTenant(db, device.tenantId, async (tx) => {
    const { repId } = await repOfDevice(tx, device);
    const [customer] = await tx.execute<{ id: string }>(
      sql`select id from customers where id = ${input.customerId}`,
    );
    if (!customer)
      throw new AppError(400, 'validation_failed', 'هذا الزبون غير موجود.', { customerId: 'غير موجود' });
    if (input.routeId) {
      // Only a route of his own: a phone cannot file a visit under someone else's route
      const [route] = await tx.execute<{ id: string }>(
        sql`select id from routes where id = ${input.routeId} and rep_id = ${repId}`,
      );
      if (!route) throw new AppError(400, 'validation_failed', 'هذا الخط ليس خطك.', { routeId: 'ليس خطك' });
    }
    if (input.noSaleReasonId) {
      const [reason] = await tx.execute<{ id: string }>(
        sql`select id from no_sale_reasons where id = ${input.noSaleReasonId}`,
      );
      if (!reason)
        throw new AppError(400, 'validation_failed', 'سبب عدم البيع غير موجود.', {
          noSaleReasonId: 'غير موجود',
        });
    }
    const dayId = await dayRowOf(tx, device, repId, input.businessDate);
    // The visit's id belongs to one rep: another rep's visit with the same id is not touched
    const [mine] = await tx.execute<{ rep_id: string }>(
      sql`select rep_id from rep_visits where id = ${input.id}`,
    );
    if (mine && mine.rep_id !== repId) throw forbidden('هذه الزيارة ليست لك.');
    const docIds = sql`${`{${input.docIds.join(',')}}`}::uuid[]`;
    await tx.execute(sql`
      insert into rep_visits (id, tenant_id, rep_day_id, rep_id, customer_id, route_id, off_route, arrived_at,
                              left_at, lat, lng, outcome, no_sale_reason_id, doc_ids, note)
      values (${input.id}, ${device.tenantId}, ${dayId}, ${repId}, ${input.customerId}, ${input.routeId},
              ${input.offRoute}, ${input.arrivedAt}::timestamptz, ${input.leftAt}::timestamptz, ${input.lat},
              ${input.lng}, ${input.outcome}, ${input.noSaleReasonId}, ${docIds}, ${input.note})
      on conflict (tenant_id, id) do update set left_at = excluded.left_at, outcome = excluded.outcome,
        no_sale_reason_id = excluded.no_sale_reason_id, doc_ids = excluded.doc_ids, note = excluded.note`);
    return { id: input.id };
  });
}
