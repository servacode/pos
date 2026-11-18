import { describe, expect, it } from 'vitest';
import {
  CREDIT_REFUSAL_TEXT,
  cashOnly,
  committedByVariant,
  creditVerdict,
  dayProgress,
  dayStops,
  deliveryOf,
  lineRemaining,
  nextStop,
  primaryOutcome,
  repDayStartInput,
  repVisitReportInput,
  offRouteNeedsReason,
  routesForDay,
  routesOfDay,
  statusOfResults,
  weekdayOf,
  type RoutePullRow,
  type RouteStop,
} from './distribution';

describe('weekdayOf', () => {
  it('counts Sunday as 0, like Date.getUTCDay', () => {
    expect(weekdayOf('2026-11-15')).toBe(0);
    expect(weekdayOf('2026-11-18')).toBe(3);
    expect(weekdayOf('2026-11-21')).toBe(6);
  });
});

describe('routesForDay', () => {
  it('keeps the routes whose weekdays include the day', () => {
    const routes = [
      { id: 'a', weekdays: [1, 3] },
      { id: 'b', weekdays: [2] },
      { id: 'c', weekdays: [] },
    ];
    expect(routesForDay(routes, 3).map((r) => r.id)).toEqual(['a']);
  });
});

describe('statusOfResults', () => {
  it('puts a sale before an order, a collection, a return and a refusal', () => {
    expect(statusOfResults(['collection', 'sale'], true)).toBe('sold');
    expect(statusOfResults(['no_sale', 'order'], true)).toBe('order');
    expect(statusOfResults(['return', 'collection'], true)).toBe('collected');
    expect(statusOfResults(['return'], true)).toBe('returned');
    expect(statusOfResults(['no_sale'], true)).toBe('no_sale');
    expect(statusOfResults([], true)).toBe('visited');
    expect(statusOfResults([], false)).toBe('todo');
  });
});

describe('dayStops', () => {
  const routes = [
    { id: 'r1', customerIds: ['c1', 'c2', 'c3'] },
    { id: 'r2', customerIds: ['c3', 'c4'] },
  ];
  it('lists each customer once in route and visiting order, numbered from 1', () => {
    const stops = dayStops(routes, []);
    expect(stops.map((s) => [s.customerId, s.routeId, s.position, s.status])).toEqual([
      ['c1', 'r1', 1, 'todo'],
      ['c2', 'r1', 2, 'todo'],
      ['c3', 'r1', 3, 'todo'],
      ['c4', 'r2', 4, 'todo'],
    ]);
  });
  it('folds every visit of a customer into one status', () => {
    const stops = dayStops(routes, [
      { customerId: 'c1', results: ['no_sale'] },
      { customerId: 'c1', results: ['sale', 'collection'] },
      { customerId: 'c2', results: [] },
    ]);
    expect(stops[0]).toMatchObject({ status: 'sold', results: ['no_sale', 'sale', 'collection'] });
    expect(stops[1]).toMatchObject({ status: 'visited' });
    expect(stops[2]).toMatchObject({ status: 'todo', results: [] });
  });
  it('is empty for no routes', () => {
    expect(dayStops([], [])).toEqual([]);
  });
});

describe('dayProgress and nextStop', () => {
  const stop = (customerId: string, status: RouteStop['status']): RouteStop => ({
    customerId,
    routeId: 'r',
    position: 1,
    status,
    results: [],
  });
  it('counts the visited ones and rounds the percent', () => {
    const stops = [stop('a', 'sold'), stop('b', 'no_sale'), stop('c', 'todo')];
    expect(dayProgress(stops)).toEqual({ total: 3, done: 2, sold: 1, noSale: 1, percent: 67 });
    expect(dayProgress([])).toEqual({ total: 0, done: 0, sold: 0, noSale: 0, percent: 0 });
  });
  it('finds the next stop still to visit, after a given one, wrapping to the first', () => {
    const stops = [stop('a', 'todo'), stop('b', 'sold'), stop('c', 'todo'), stop('d', 'sold')];
    expect(nextStop(stops)?.customerId).toBe('a');
    expect(nextStop(stops, 'a')?.customerId).toBe('c');
    expect(nextStop(stops, 'c')?.customerId).toBe('a');
    expect(nextStop([stop('a', 'sold')])).toBeNull();
  });
});

describe('offRouteNeedsReason', () => {
  const stops = [{ customerId: 'a', routeId: 'r', position: 1, status: 'todo' as const, results: [] }];
  it('asks a reason only for someone off today’s list, when the store wants it', () => {
    expect(offRouteNeedsReason('z', stops, { offRouteNeedsReason: true })).toBe(true);
    expect(offRouteNeedsReason('a', stops, { offRouteNeedsReason: true })).toBe(false);
    expect(offRouteNeedsReason('z', stops, { offRouteNeedsReason: false })).toBe(false);
  });
});

describe('credit', () => {
  const base = {
    amountMinor: 1000,
    approvalStatus: 'approved',
    balanceMinor: 0,
    creditLimitMinor: null,
    repDailyLimitMinor: null,
    givenTodayMinor: 0,
  };
  it('treats a pending or rejected customer as cash only', () => {
    expect(cashOnly('pending')).toBe(true);
    expect(cashOnly('rejected')).toBe(true);
    expect(cashOnly('approved')).toBe(false);
    expect(cashOnly(null)).toBe(false);
    expect(creditVerdict({ ...base, approvalStatus: 'pending' })).toEqual({
      ok: false,
      reason: 'cash_only',
      headroomMinor: 0,
    });
  });
  it('has no limit when both limits are empty', () => {
    expect(creditVerdict(base)).toEqual({ ok: true, headroomMinor: null });
  });
  it('refuses above the customer’s limit less what he owes', () => {
    expect(creditVerdict({ ...base, creditLimitMinor: 5000, balanceMinor: 4500 })).toEqual({
      ok: false,
      reason: 'customer_limit',
      headroomMinor: 500,
    });
    expect(creditVerdict({ ...base, creditLimitMinor: 5000, balanceMinor: 9000 })).toMatchObject({
      ok: false,
      headroomMinor: 0,
    });
    expect(creditVerdict({ ...base, creditLimitMinor: 5000, balanceMinor: 1000 })).toEqual({
      ok: true,
      headroomMinor: 4000,
    });
  });
  it('refuses above the rep’s credit for the day, and answers the narrower room', () => {
    expect(creditVerdict({ ...base, repDailyLimitMinor: 3000, givenTodayMinor: 2500 })).toEqual({
      ok: false,
      reason: 'rep_daily_limit',
      headroomMinor: 500,
    });
    expect(
      creditVerdict({ ...base, repDailyLimitMinor: 3000, givenTodayMinor: 500, creditLimitMinor: 1500 }),
    ).toEqual({ ok: true, headroomMinor: 1500 });
  });
  it('has a sentence for every refusal', () => {
    expect(Object.keys(CREDIT_REFUSAL_TEXT)).toEqual(['cash_only', 'customer_limit', 'rep_daily_limit']);
  });
});

describe('orders', () => {
  const order = (status: string, lines: { variantId: string; qty: number; deliveredQty: number }[]) => ({
    status,
    lines,
  });
  it('knows what is left on a line', () => {
    expect(lineRemaining({ qty: 5000, deliveredQty: 2000 })).toBe(3000);
    expect(lineRemaining({ qty: 5000, deliveredQty: 9000 })).toBe(0);
  });
  it('adds what open and partial orders still promise, per variant', () => {
    const map = committedByVariant([
      order('open', [{ variantId: 'v1', qty: 5000, deliveredQty: 0 }]),
      order('partial', [
        { variantId: 'v1', qty: 4000, deliveredQty: 1000 },
        { variantId: 'v2', qty: 1000, deliveredQty: 1000 },
      ]),
      order('delivered', [{ variantId: 'v1', qty: 9000, deliveredQty: 0 }]),
      order('cancelled', [{ variantId: 'v3', qty: 1000, deliveredQty: 0 }]),
    ]);
    expect(Object.fromEntries(map)).toEqual({ v1: 8000 });
  });
  it('covers an order only up to what is left and what was sold', () => {
    const o = {
      lines: [
        { variantId: 'v1', qty: 5000, deliveredQty: 2000 },
        { variantId: 'v2', qty: 1000, deliveredQty: 0 },
        { variantId: 'v3', qty: 1000, deliveredQty: 0 },
      ],
    };
    expect(
      deliveryOf(
        o,
        new Map([
          ['v1', 9000],
          ['v2', 400],
        ]),
      ),
    ).toEqual([
      { variantId: 'v1', qty: 3000 },
      { variantId: 'v2', qty: 400 },
    ]);
  });
});

describe('routesOfDay', () => {
  const route = (id: string, weekdays: number[], sortOrder: number, isActive = true): RoutePullRow => ({
    id,
    name: id,
    regionId: null,
    weekdays,
    repId: 'rep',
    sortOrder,
    isActive,
    version: 1,
  });
  it('picks the active routes of the weekday and orders customers by visiting order', () => {
    const routes = [route('b', [3], 2), route('a', [3], 1), route('off', [3], 0, false), route('x', [4], 0)];
    const rcs = [
      { id: '1', routeId: 'a', customerId: 'c2', visitOrder: 2, version: 1 },
      { id: '2', routeId: 'a', customerId: 'c1', visitOrder: 1, version: 1 },
      { id: '3', routeId: 'b', customerId: 'c9', visitOrder: 1, version: 1 },
    ];
    expect(routesOfDay(routes, rcs, 3)).toEqual([
      { id: 'a', name: 'a', customerIds: ['c1', 'c2'] },
      { id: 'b', name: 'b', customerIds: ['c9'] },
    ]);
  });
  it('breaks a tie of order by name', () => {
    const routes = [route('ب', [1], 1), route('أ', [1], 1)];
    expect(routesOfDay(routes, [], 1).map((r) => r.id)).toEqual(['أ', 'ب']);
  });
});

describe('primaryOutcome', () => {
  it('files a visit under its money result first, then the rest, or none', () => {
    expect(primaryOutcome(['collection', 'sale'])).toBe('sale');
    expect(primaryOutcome(['no_sale', 'order'])).toBe('order');
    expect(primaryOutcome(['return', 'collection'])).toBe('collection');
    expect(primaryOutcome(['return'])).toBe('return');
    expect(primaryOutcome(['no_sale'])).toBe('no_sale');
    expect(primaryOutcome([])).toBe('none');
  });
});

describe('what the phone sends', () => {
  const visit = {
    id: '0192a000-0000-7000-8000-000000000001',
    businessDate: '2026-11-18',
    customerId: '0192a000-0000-7000-8000-000000000002',
    arrivedAt: '2026-11-18T07:00:00.000Z',
  };
  it('takes a visit with defaults for what it leaves out', () => {
    const parsed = repVisitReportInput.parse(visit);
    expect(parsed).toMatchObject({ outcome: 'none', offRoute: false, docIds: [], routeId: null, lat: null });
  });
  it('asks a reason for a no-sale visit and both coordinates or neither', () => {
    expect(repVisitReportInput.safeParse({ ...visit, outcome: 'no_sale' }).success).toBe(false);
    expect(
      repVisitReportInput.safeParse({
        ...visit,
        outcome: 'no_sale',
        noSaleReasonId: '0192a000-0000-7000-8000-000000000003',
      }).success,
    ).toBe(true);
    expect(repVisitReportInput.safeParse({ ...visit, lat: 33.5 }).success).toBe(false);
    expect(repVisitReportInput.safeParse({ ...visit, lat: 33.5, lng: 36.3 }).success).toBe(true);
  });
  it('takes the day’s start with a float per currency, and rejects a lower-case one', () => {
    expect(repDayStartInput.parse({ businessDate: '2026-11-18' })).toEqual({
      businessDate: '2026-11-18',
      openingCash: {},
      loadConfirmed: false,
    });
    expect(repDayStartInput.safeParse({ businessDate: '2026-11-18', openingCash: { syp: 1 } }).success).toBe(
      false,
    );
  });
});
