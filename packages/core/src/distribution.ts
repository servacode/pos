import { z } from 'zod';
import { isoDateSchema, isoTimeSchema, nonNegativeMinorSchema, uuidSchema } from './contracts/common';
import type { DistributionSettings } from './contracts/distribution';

/**
 * «وضع المندوب»: the pure rules the rep's phone and the day sheet share (docs/specs/32-sales-reps.md).
 * Nothing here reads a clock or a database. The money is the engine's: a van sale, a receipt and a
 * return are ordinary documents; this file only decides which customer is next, what a visit
 * ended with, and what a customer may still be sold on credit.
 */

// ─── What GET /v1/device/rep/day answers ────────────────────────────────────

export interface RepDayRep {
  id: string;
  userId: string;
  /** van | presale | both */
  mode: 'van' | 'presale' | 'both';
  vanBranchId: string | null;
  vanName: string | null;
  vehiclePlate: string | null;
  /** Most discount he may give, basis points; null: his role's limit */
  maxDiscountBp: number | null;
  /** Most credit he may give in a day, base currency; null: no limit */
  dailyCreditLimitMinor: number | null;
}

export interface RepDayRoute {
  id: string;
  name: string;
  regionId: string | null;
  regionName: string | null;
  /** 0 = Sunday … 6 = Saturday */
  weekdays: number[];
  /** Customer ids in visiting order */
  customerIds: string[];
}

export interface RepDayCustomer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  regionId: string | null;
  /** approved | pending | rejected: a pending customer is sold to for cash only */
  approvalStatus: string;
  priceTier: 'retail' | 'wholesale';
  kind: string | null;
  creditLimitMinor: number | null;
  /** What he owes the store now, base currency (negative: the store owes him) */
  balanceMinor: number;
  /** The part of it older than 30 days */
  overdueMinor: number;
  lat: number | null;
  lng: number | null;
  /** The day of his latest sale, or null */
  lastSaleDate: string | null;
}

export interface RepDayContractPrice {
  customerId: string;
  variantId: string;
  currency: string;
  priceMinor: number;
}

export interface RepDayOrderLine {
  variantId: string;
  qty: number;
  deliveredQty: number;
  unitPriceMinor: number;
}

export interface RepDayOrder {
  id: string;
  number: string;
  status: string;
  customerId: string;
  currency: string;
  totalMinor: number;
  deliveryDate: string | null;
  lines: RepDayOrderLine[];
}

export interface RepDayInvoice {
  id: string;
  number: string;
  customerId: string | null;
  deviceTime: string;
  /** The sale document as sold (no cost: the server never puts it in a payload) */
  payload: Record<string, unknown>;
  returned: {
    saleLineNo: number;
    qty: number;
    grossExTaxMinor: number;
    discountExTaxMinor: number;
    taxMinor: number;
    totalMinor: number;
  }[];
}

export interface RepDayStock {
  variantId: string;
  /** Thousandths of the base unit */
  qty: number;
}

export interface RepDaySheet {
  businessDate: string;
  weekday: number;
  baseCurrency: string;
  rep: RepDayRep;
  settings: DistributionSettings;
  /** The routes of the rep; `todayRouteIds` are the ones whose weekdays include today */
  routes: RepDayRoute[];
  todayRouteIds: string[];
  customers: RepDayCustomer[];
  contractPrices: RepDayContractPrice[];
  openOrders: RepDayOrder[];
  returnable: RepDayInvoice[];
  vanStock: RepDayStock[];
  /** The visit rows the server already holds for today (a phone that lost its data gets them back) */
  visits: RepVisitRecord[];
}

// ─── Visits ─────────────────────────────────────────────────────────────────

/** What a visit produced; a visit may have several (a sale and a collection) */
export type VisitResult = 'sale' | 'order' | 'collection' | 'return' | 'no_sale';

export interface RepVisitRecord {
  id: string;
  customerId: string;
  routeId: string | null;
  offRoute: boolean;
  arrivedAt: string;
  leftAt: string | null;
  results: VisitResult[];
  noSaleReasonId: string | null;
  docIds: string[];
  note: string | null;
}

/** The one outcome a visit is filed under on the server: money first, then the rest */
export function primaryOutcome(
  results: readonly VisitResult[],
): 'sale' | 'order' | 'collection' | 'return' | 'no_sale' | 'none' {
  for (const r of ['sale', 'order', 'collection', 'return', 'no_sale'] as const) {
    if (results.includes(r)) return r;
  }
  return 'none';
}

/** POST /v1/device/rep/visits: a visit as the phone recorded it (its id is the phone's, so a resend is one row) */
export const repVisitReportInput = z
  .object({
    id: uuidSchema,
    businessDate: isoDateSchema,
    customerId: uuidSchema,
    routeId: uuidSchema.nullable().default(null),
    offRoute: z.boolean().default(false),
    arrivedAt: isoTimeSchema,
    leftAt: isoTimeSchema.nullable().default(null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    outcome: z.enum(['sale', 'order', 'collection', 'return', 'no_sale', 'none']).default('none'),
    noSaleReasonId: uuidSchema.nullable().default(null),
    docIds: z.array(uuidSchema).max(50).default([]),
    note: z.string().trim().max(300).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === 'no_sale' && !v.noSaleReasonId) {
      ctx.addIssue({ code: 'custom', path: ['noSaleReasonId'], message: 'اختر سبب عدم البيع' });
    }
    if ((v.lat === null) !== (v.lng === null)) {
      ctx.addIssue({ code: 'custom', path: ['lng'], message: 'الموقع خط عرض وخط طول معاً' });
    }
  });
export type RepVisitReport = z.output<typeof repVisitReportInput>;

/** POST /v1/device/rep/day: the day starts, with his cash float per currency and whether he confirmed the load */
export const repDayStartInput = z.object({
  businessDate: isoDateSchema,
  openingCash: z.record(z.string().regex(/^[A-Z]{3}$/), nonNegativeMinorSchema).default({}),
  loadConfirmed: z.boolean().default(false),
});
export type RepDayStart = z.output<typeof repDayStartInput>;

export type StopStatus = 'todo' | 'sold' | 'order' | 'collected' | 'returned' | 'no_sale' | 'visited';

export interface RouteStop {
  customerId: string;
  routeId: string;
  /** Place in the day's list, from 1 */
  position: number;
  status: StopStatus;
  /** Every result the visits to him gave today */
  results: VisitResult[];
}

/** 0 = Sunday … 6 = Saturday of a «2026-11-18» date, as the routes count them */
export function weekdayOf(businessDate: string): number {
  const [y, m, d] = businessDate.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** The routes that run today: active, with today's weekday */
export function routesForDay<T extends { weekdays: readonly number[] }>(
  routes: readonly T[],
  weekday: number,
) {
  return routes.filter((r) => r.weekdays.includes(weekday));
}

/** The single status a stop shows: money first (a sale), then an order, a collection, a return */
export function statusOfResults(results: readonly VisitResult[], visited: boolean): StopStatus {
  if (results.includes('sale')) return 'sold';
  if (results.includes('order')) return 'order';
  if (results.includes('collection')) return 'collected';
  if (results.includes('return')) return 'returned';
  if (results.includes('no_sale')) return 'no_sale';
  return visited ? 'visited' : 'todo';
}

/**
 * Today's stops: the customers of the routes that run today, in route order then visiting order,
 * each once (a customer on two routes keeps his first place), with what today's visits gave.
 */
export function dayStops(
  routes: readonly { id: string; customerIds: readonly string[] }[],
  visits: readonly Pick<RepVisitRecord, 'customerId' | 'results'>[],
): RouteStop[] {
  const byCustomer = new Map<string, { results: Set<VisitResult>; visited: boolean }>();
  for (const v of visits) {
    const entry = byCustomer.get(v.customerId) ?? { results: new Set<VisitResult>(), visited: false };
    for (const r of v.results) entry.results.add(r);
    entry.visited = true;
    byCustomer.set(v.customerId, entry);
  }
  const seen = new Set<string>();
  const stops: RouteStop[] = [];
  for (const route of routes) {
    for (const customerId of route.customerIds) {
      if (seen.has(customerId)) continue;
      seen.add(customerId);
      const got = byCustomer.get(customerId);
      const results = got ? [...got.results] : [];
      stops.push({
        customerId,
        routeId: route.id,
        position: stops.length + 1,
        status: statusOfResults(results, got?.visited ?? false),
        results,
      });
    }
  }
  return stops;
}

export interface DayProgress {
  total: number;
  done: number;
  sold: number;
  noSale: number;
  /** Whole percent of the stops that have been visited */
  percent: number;
}

export function dayProgress(stops: readonly RouteStop[]): DayProgress {
  const done = stops.filter((s) => s.status !== 'todo').length;
  const total = stops.length;
  return {
    total,
    done,
    sold: stops.filter((s) => s.status === 'sold').length,
    noSale: stops.filter((s) => s.status === 'no_sale').length,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/** The first stop not yet visited, after the one the rep is at (or from the top) */
export function nextStop(
  stops: readonly RouteStop[],
  afterCustomerId: string | null = null,
): RouteStop | null {
  const from = afterCustomerId ? stops.findIndex((s) => s.customerId === afterCustomerId) + 1 : 0;
  return stops.slice(from).find((s) => s.status === 'todo') ?? stops.find((s) => s.status === 'todo') ?? null;
}

/** Whether a customer who is not on today's list needs a reason first (the store's rule) */
export function offRouteNeedsReason(
  customerId: string,
  stops: readonly RouteStop[],
  settings: Pick<DistributionSettings, 'offRouteNeedsReason'>,
): boolean {
  return settings.offRouteNeedsReason && !stops.some((s) => s.customerId === customerId);
}

// ─── Credit ─────────────────────────────────────────────────────────────────

/** A customer the supervisor has not approved yet is sold to for cash only */
export const cashOnly = (approvalStatus: string | null | undefined): boolean =>
  approvalStatus === 'pending' || approvalStatus === 'rejected';

export type CreditVerdict =
  | { ok: true; headroomMinor: number | null }
  | { ok: false; reason: 'cash_only' | 'customer_limit' | 'rep_daily_limit'; headroomMinor: number };

/**
 * May `amountMinor` more go on the customer's account? Three limits, the narrowest wins: a customer
 * who is not approved has none; his own credit limit against what he owes; and the rep's credit for
 * the day against what he already gave today. A null limit is no limit. The till still asks a
 * manager when it refuses; this only says why.
 */
export function creditVerdict(input: {
  amountMinor: number;
  approvalStatus: string | null | undefined;
  balanceMinor: number;
  creditLimitMinor: number | null;
  repDailyLimitMinor: number | null;
  givenTodayMinor: number;
}): CreditVerdict {
  if (cashOnly(input.approvalStatus)) return { ok: false, reason: 'cash_only', headroomMinor: 0 };
  const customerRoom =
    input.creditLimitMinor === null ? null : Math.max(0, input.creditLimitMinor - input.balanceMinor);
  const repRoom =
    input.repDailyLimitMinor === null ? null : Math.max(0, input.repDailyLimitMinor - input.givenTodayMinor);
  if (customerRoom !== null && input.amountMinor > customerRoom)
    return { ok: false, reason: 'customer_limit', headroomMinor: customerRoom };
  if (repRoom !== null && input.amountMinor > repRoom)
    return { ok: false, reason: 'rep_daily_limit', headroomMinor: repRoom };
  const rooms = [customerRoom, repRoom].filter((n): n is number => n !== null);
  return { ok: true, headroomMinor: rooms.length === 0 ? null : Math.min(...rooms) };
}

export const CREDIT_REFUSAL_TEXT: Record<'cash_only' | 'customer_limit' | 'rep_daily_limit', string> = {
  cash_only: 'هذا الزبون بانتظار موافقة المشرف: البيع له نقداً فقط.',
  customer_limit: 'المبلغ يتجاوز حد الدين للزبون.',
  rep_daily_limit: 'المبلغ يتجاوز ائتمانك لليوم.',
};

// ─── Pre-sale orders ────────────────────────────────────────────────────────

/** What is still to deliver of an order line, thousandths */
export const lineRemaining = (line: { qty: number; deliveredQty: number }): number =>
  Math.max(0, line.qty - line.deliveredQty);

/** What the open orders promise per variant: the stock that is spoken for, never taken off the shelf */
export function committedByVariant(
  orders: readonly {
    status: string;
    lines: readonly { variantId: string; qty: number; deliveredQty: number }[];
  }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const order of orders) {
    if (order.status !== 'open' && order.status !== 'partial') continue;
    for (const line of order.lines) {
      const left = lineRemaining(line);
      if (left > 0) out.set(line.variantId, (out.get(line.variantId) ?? 0) + left);
    }
  }
  return out;
}

/** A sale cart's quantities against an order: how much of each ordered variant this delivery covers */
export function deliveryOf(
  order: { lines: readonly { variantId: string; qty: number; deliveredQty: number }[] },
  sold: ReadonlyMap<string, number>,
): { variantId: string; qty: number }[] {
  return order.lines
    .map((l) => ({ variantId: l.variantId, qty: Math.min(lineRemaining(l), sold.get(l.variantId) ?? 0) }))
    .filter((l) => l.qty > 0);
}

// ─── Pull sets of the rep's device (apps/api › sync-pull.ts) ────────────────

/** `regions` */
export interface RegionPullRow {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}
/** `routes` */
export interface RoutePullRow {
  id: string;
  name: string;
  regionId: string | null;
  weekdays: number[];
  repId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}
/** `route_customers` */
export interface RouteCustomerPullRow {
  id: string;
  routeId: string;
  customerId: string;
  visitOrder: number;
  version: number;
}
/** `no_sale_reasons` */
export interface NoSaleReasonPullRow {
  id: string;
  key: string | null;
  name: string;
  sortOrder: number;
  isActive: boolean;
  version: number;
}
/** `sales_orders` (no cost: the lines hold the price the customer was given) */
export interface SalesOrderPullRow {
  id: string;
  number: string;
  status: string;
  customerId: string;
  branchId: string;
  warehouseBranchId: string;
  repId: string | null;
  businessDate: string;
  currency: string;
  totalMinor: number;
  depositMinor: number;
  deliveryDate: string | null;
  lines: RepDayOrderLine[];
  version: number;
}

export interface RepPullSetRows {
  regions: RegionPullRow;
  routes: RoutePullRow;
  route_customers: RouteCustomerPullRow;
  no_sale_reasons: NoSaleReasonPullRow;
  sales_orders: SalesOrderPullRow;
}

/** The sets only a rep's phone pulls, besides the ones every device has */
export const REP_PULL_SETS = [
  'regions',
  'routes',
  'route_customers',
  'no_sale_reasons',
  'sales_orders',
] as const;
export type RepPullSet = (typeof REP_PULL_SETS)[number];

/** The routes of a rep's phone that run on a weekday, in order, from the pulled sets */
export function routesOfDay(
  routes: readonly RoutePullRow[],
  routeCustomers: readonly RouteCustomerPullRow[],
  weekday: number,
): { id: string; name: string; customerIds: string[] }[] {
  return routes
    .filter((r) => r.isActive && r.weekdays.includes(weekday))
    .toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ar'))
    .map((r) => ({
      id: r.id,
      name: r.name,
      customerIds: routeCustomers
        .filter((rc) => rc.routeId === r.id)
        .toSorted((a, b) => a.visitOrder - b.visitOrder)
        .map((rc) => rc.customerId),
    }));
}
