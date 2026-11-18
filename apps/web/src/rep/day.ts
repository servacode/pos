import type {
  RepVisitRecord,
  RouteCustomerPullRow,
  RoutePullRow,
  VisitResult,
} from '@serva/core/distribution';
import { dayStops, routesOfDay, weekdayOf, type RouteStop } from '@serva/core/distribution';
import type { OutboxEntry } from '@serva/sync';

/**
 * The rep's day on his phone, as plain data: which visits happened, what a document did to one,
 * and what the customer owes after what this phone has sent but the server has not counted yet.
 * No React, no clock: the screens and the tests feed it.
 */

/** A visit as the phone keeps it; `sent` says the server has the latest of it */
export interface LocalVisit extends RepVisitRecord {
  sent: boolean;
  /** Set when the visit was recorded with a place (the store's gps setting) */
  lat?: number | null;
  lng?: number | null;
}

export const visitsKey = (businessDate: string) => `rep:visits:${businessDate}`;
export const SHEET_KEY = 'rep:sheet';
export const ORDER_QUEUE_KEY = 'rep:order-queue';
export const NEW_CUSTOMERS_KEY = 'rep:new-customers';
export const VAN_COUNT_KEY = 'rep:van-count';
export const DAY_STARTED_KEY = 'rep:day-started';

/** What a document the phone saved means for the visit to its customer; null: it is not part of a visit */
export function resultOf(type: string): VisitResult | null {
  switch (type) {
    case 'sale':
      return 'sale';
    case 'receipt':
      return 'collection';
    case 'return':
      return 'return';
    case 'sales_order':
      return 'order';
    default:
      return null;
  }
}

/** The customer a document is about, when it names one */
export function customerOfDocument(type: string, payload: Record<string, unknown>): string | null {
  if (type === 'customer') return null;
  const id = payload.customerId;
  return typeof id === 'string' ? id : null;
}

/**
 * Adds a result (and the document) to today's visit to the customer; a visit that is open is
 * extended, otherwise a new one starts at `at`. Pure: returns the new list.
 */
export function withResult(
  visits: readonly LocalVisit[],
  input: {
    customerId: string;
    result: VisitResult;
    docId: string | null;
    at: string;
    newId: () => string;
    routeId: string | null;
    offRoute: boolean;
    noSaleReasonId?: string | null;
    note?: string | null;
  },
): LocalVisit[] {
  const open = visits.findLast((v) => v.customerId === input.customerId && v.leftAt === null);
  const base: LocalVisit = open ?? {
    id: input.newId(),
    customerId: input.customerId,
    routeId: input.routeId,
    offRoute: input.offRoute,
    arrivedAt: input.at,
    leftAt: null,
    results: [],
    noSaleReasonId: null,
    docIds: [],
    note: null,
    sent: false,
  };
  const next: LocalVisit = {
    ...base,
    results: base.results.includes(input.result) ? base.results : [...base.results, input.result],
    docIds: input.docId && !base.docIds.includes(input.docId) ? [...base.docIds, input.docId] : base.docIds,
    noSaleReasonId: input.noSaleReasonId ?? base.noSaleReasonId,
    note: input.note ?? base.note,
    sent: false,
  };
  return open ? visits.map((v) => (v === open ? next : v)) : [...visits, next];
}

/** The rep arrives at a customer: a visit opens (the one already open is kept), with the reason for an off-route one */
export function arriving(
  visits: readonly LocalVisit[],
  input: {
    customerId: string;
    at: string;
    newId: () => string;
    routeId: string | null;
    offRoute: boolean;
    note?: string | null;
  },
): LocalVisit[] {
  const open = visits.find((v) => v.customerId === input.customerId && v.leftAt === null);
  if (open) {
    return input.note
      ? visits.map((v) => (v === open ? { ...v, note: input.note ?? v.note, sent: false } : v))
      : [...visits];
  }
  return [
    ...visits,
    {
      id: input.newId(),
      customerId: input.customerId,
      routeId: input.routeId,
      offRoute: input.offRoute,
      arrivedAt: input.at,
      leftAt: null,
      results: [],
      noSaleReasonId: null,
      docIds: [],
      note: input.note ?? null,
      sent: false,
    },
  ];
}

/** Closes the open visit to a customer (he leaves) */
export function leaving(visits: readonly LocalVisit[], customerId: string, at: string): LocalVisit[] {
  return visits.map((v) =>
    v.customerId === customerId && v.leftAt === null ? { ...v, leftAt: at, sent: false } : v,
  );
}

/** A visit with no outcome that ended at once is only a visit: kept, shown «زيارة» */
export const isEmptyVisit = (v: Pick<LocalVisit, 'results'>) => v.results.length === 0;

/** Merges the visits the server holds for today (a phone that lost its data) under the ones it has */
export function mergeServerVisits(
  local: readonly LocalVisit[],
  server: readonly RepVisitRecord[],
): LocalVisit[] {
  const known = new Set(local.map((v) => v.id));
  return [...local, ...server.filter((v) => !known.has(v.id)).map((v) => ({ ...v, sent: true }))];
}

export interface DayList {
  stops: RouteStop[];
  /** The routes running today, for the header */
  routes: { id: string; name: string; customerIds: string[] }[];
}

/** Today's list from the pulled routes (works offline) and today's visits */
export function dayList(
  routes: readonly RoutePullRow[],
  routeCustomers: readonly RouteCustomerPullRow[],
  businessDate: string,
  visits: readonly LocalVisit[],
): DayList {
  const running = routesOfDay(routes, routeCustomers, weekdayOf(businessDate));
  return { routes: running, stops: dayStops(running, visits) };
}

/**
 * What this phone changed in a customer's account that the server's balance (taken when the day
 * was fetched) does not include: his credit sales add and his receipts take off (base currency only).
 * Only documents saved after `since` count, and only until the server has counted them.
 */
export function localBalanceDelta(
  entries: readonly OutboxEntry[],
  customerId: string,
  sinceMs: number,
  baseCurrency: string,
): number {
  let delta = 0;
  for (const e of entries) {
    if (Date.parse(e.doc.deviceTime) < sinceMs) continue;
    const p = e.doc.payload as Record<string, unknown>;
    if (p.customerId !== customerId) continue;
    if (e.doc.type === 'sale') {
      const payments = (p.payments as { method: string; currency: string; amountMinor: number }[]) ?? [];
      for (const pay of payments) {
        if (pay.method === 'credit' && pay.currency === baseCurrency) delta += pay.amountMinor;
      }
    } else if (e.doc.type === 'receipt' && p.currency === baseCurrency) {
      delta -= (p.amountMinor as number | undefined) ?? 0;
    }
  }
  return delta;
}

export interface DaySummary {
  sales: { count: number; byCurrency: Record<string, number> };
  /** What was sold on account (not paid at the time) */
  credit: Record<string, number>;
  collections: { count: number; byCurrency: Record<string, number> };
  returns: { count: number; byCurrency: Record<string, number> };
}

const add = (into: Record<string, number>, currency: string, minor: number) => {
  into[currency] = (into[currency] ?? 0) + minor;
};

/** What this phone did on a business day, from the documents it saved (sent or not): the rep's own summary */
export function daySummary(entries: readonly OutboxEntry[], businessDate: string): DaySummary {
  const out: DaySummary = {
    sales: { count: 0, byCurrency: {} },
    credit: {},
    collections: { count: 0, byCurrency: {} },
    returns: { count: 0, byCurrency: {} },
  };
  for (const e of entries) {
    if (e.doc.businessDate !== businessDate) continue;
    const p = e.doc.payload as Record<string, unknown>;
    const currency = String(p.currency ?? '');
    if (e.doc.type === 'sale') {
      out.sales.count += 1;
      add(out.sales.byCurrency, currency, (p.totals as { totalMinor?: number } | undefined)?.totalMinor ?? 0);
      for (const pay of (p.payments as { method: string; currency: string; amountMinor: number }[]) ?? []) {
        if (pay.method === 'credit') add(out.credit, pay.currency, pay.amountMinor);
      }
    } else if (e.doc.type === 'receipt') {
      out.collections.count += 1;
      add(out.collections.byCurrency, currency, (p.amountMinor as number | undefined) ?? 0);
    } else if (e.doc.type === 'return') {
      out.returns.count += 1;
      add(
        out.returns.byCurrency,
        currency,
        (p.totals as { totalMinor?: number } | undefined)?.totalMinor ?? 0,
      );
    }
  }
  return out;
}
