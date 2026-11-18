import { describe, expect, it } from 'vitest';
import type { OutboxEntry } from '@serva/sync';
import {
  arriving,
  customerOfDocument,
  dayList,
  daySummary,
  isEmptyVisit,
  leaving,
  localBalanceDelta,
  mergeServerVisits,
  resultOf,
  withResult,
  type LocalVisit,
} from './day';
import { salesOrderCart } from './orderCart';
import { PRODUCTS, posSets } from '../test/pos';
import { loadCatalog } from '../pos/catalog';

let n = 0;
const newId = () => `v-${++n}`;
const at = '2026-11-18T07:00:00.000Z';
const base = { routeId: 'r1', offRoute: false, at, newId };

describe('what a document means for a visit', () => {
  it('maps the documents a rep makes to a result, and ignores the rest', () => {
    expect(resultOf('sale')).toBe('sale');
    expect(resultOf('receipt')).toBe('collection');
    expect(resultOf('return')).toBe('return');
    expect(resultOf('sales_order')).toBe('order');
    expect(resultOf('cash_movement')).toBeNull();
    expect(resultOf('shift_open')).toBeNull();
  });

  it('reads the customer a document is about, never a new customer’s own document', () => {
    expect(customerOfDocument('sale', { customerId: 'c1' })).toBe('c1');
    expect(customerOfDocument('sale', { customerId: null })).toBeNull();
    expect(customerOfDocument('customer', { customerId: 'c1' })).toBeNull();
  });
});

describe('visits', () => {
  it('starts a visit at the first result and extends it with the next, once per document', () => {
    let visits: LocalVisit[] = [];
    visits = withResult(visits, { ...base, customerId: 'c1', result: 'sale', docId: 'd1' });
    visits = withResult(visits, { ...base, customerId: 'c1', result: 'collection', docId: 'd2' });
    visits = withResult(visits, { ...base, customerId: 'c1', result: 'sale', docId: 'd1' });
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ results: ['sale', 'collection'], docIds: ['d1', 'd2'], sent: false });
  });

  it('opens a new visit after he left, and keeps another customer’s visit apart', () => {
    let visits = withResult([], { ...base, customerId: 'c1', result: 'sale', docId: 'd1' });
    visits = leaving(visits, 'c1', '2026-11-18T07:10:00.000Z');
    expect(visits[0]).toMatchObject({ leftAt: '2026-11-18T07:10:00.000Z', sent: false });
    visits = withResult(visits, { ...base, customerId: 'c1', result: 'order', docId: null });
    visits = withResult(visits, {
      ...base,
      customerId: 'c2',
      result: 'no_sale',
      docId: null,
      noSaleReasonId: 'why',
    });
    expect(visits.map((v) => [v.customerId, v.results])).toEqual([
      ['c1', ['sale']],
      ['c1', ['order']],
      ['c2', ['no_sale']],
    ]);
    expect(visits[2]!.noSaleReasonId).toBe('why');
  });

  it('opens a visit on arrival once, and keeps the reason of an off-route one', () => {
    let visits = arriving([], { ...base, customerId: 'c1', offRoute: true, note: 'طلب زيارتي' });
    visits = arriving(visits, { ...base, customerId: 'c1', offRoute: true });
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({ offRoute: true, note: 'طلب زيارتي', results: [] });
    expect(isEmptyVisit(visits[0]!)).toBe(true);
    // A reason given on a second arrival while the visit is open is added to it
    visits = arriving(visits, { ...base, customerId: 'c1', note: 'سبب آخر' });
    expect(visits[0]!.note).toBe('سبب آخر');
  });

  it('brings back the visits the server holds without doubling the ones the phone has', () => {
    const local = withResult([], { ...base, customerId: 'c1', result: 'sale', docId: 'd1' });
    const server = [
      { ...local[0]!, sent: undefined } as never,
      {
        id: 'old',
        customerId: 'c2',
        routeId: null,
        offRoute: false,
        arrivedAt: at,
        leftAt: at,
        results: ['collection' as const],
        noSaleReasonId: null,
        docIds: [],
        note: null,
      },
    ];
    const merged = mergeServerVisits(local, server);
    expect(merged.map((v) => v.id)).toEqual([local[0]!.id, 'old']);
    expect(merged[1]!.sent).toBe(true);
  });
});

describe('today’s list', () => {
  const routes = [
    {
      id: 'r1',
      name: 'خط',
      regionId: null,
      weekdays: [3],
      repId: 'x',
      sortOrder: 1,
      isActive: true,
      version: 1,
    },
    {
      id: 'r2',
      name: 'خط آخر',
      regionId: null,
      weekdays: [4],
      repId: 'x',
      sortOrder: 2,
      isActive: true,
      version: 1,
    },
  ];
  const rcs = [
    { id: '1', routeId: 'r1', customerId: 'b', visitOrder: 2, version: 1 },
    { id: '2', routeId: 'r1', customerId: 'a', visitOrder: 1, version: 1 },
    { id: '3', routeId: 'r2', customerId: 'z', visitOrder: 1, version: 1 },
  ];
  it('takes the routes of the weekday of the business date and marks what the visits gave', () => {
    // 2026-11-18 is a Wednesday (3)
    const visits = withResult([], { ...base, customerId: 'a', result: 'sale', docId: 'd' });
    const list = dayList(routes, rcs, '2026-11-18', visits);
    expect(list.routes.map((r) => r.id)).toEqual(['r1']);
    expect(list.stops.map((s) => [s.customerId, s.status])).toEqual([
      ['a', 'sold'],
      ['b', 'todo'],
    ]);
  });
});

const entry = (
  type: string,
  payload: Record<string, unknown>,
  deviceTime: string,
  businessDate = '2026-11-18',
) =>
  ({
    seq: 1,
    id: type,
    type,
    status: 'pending',
    doc: { id: type, type, deviceTime, businessDate, number: null, payload },
  }) as unknown as OutboxEntry;

describe('the balance since the morning’s sheet', () => {
  const sheetAt = Date.parse('2026-11-18T06:00:00.000Z');
  const entries = [
    entry(
      'sale',
      {
        customerId: 'c1',
        payments: [
          { method: 'cash', currency: 'SYP', amountMinor: 1000 },
          { method: 'credit', currency: 'SYP', amountMinor: 5000 },
          { method: 'credit', currency: 'USD', amountMinor: 99 },
        ],
      },
      '2026-11-18T07:00:00.000Z',
    ),
    entry('receipt', { customerId: 'c1', currency: 'SYP', amountMinor: 2000 }, '2026-11-18T08:00:00.000Z'),
    entry('receipt', { customerId: 'c1', currency: 'USD', amountMinor: 50 }, '2026-11-18T08:00:00.000Z'),
    entry(
      'sale',
      { customerId: 'c2', payments: [{ method: 'credit', currency: 'SYP', amountMinor: 700 }] },
      '2026-11-18T09:00:00.000Z',
    ),
    entry(
      'sale',
      { customerId: 'c1', payments: [{ method: 'credit', currency: 'SYP', amountMinor: 300 }] },
      '2026-11-17T09:00:00.000Z',
    ),
  ];
  it('adds this phone’s credit sales and takes off its receipts, in the base currency, after the sheet', () => {
    expect(localBalanceDelta(entries, 'c1', sheetAt, 'SYP')).toBe(3000);
    expect(localBalanceDelta(entries, 'c2', sheetAt, 'SYP')).toBe(700);
    expect(localBalanceDelta(entries, 'c3', sheetAt, 'SYP')).toBe(0);
  });
});

describe('the day’s summary', () => {
  it('adds sales, credit, collections and returns of the business day, per currency', () => {
    const summary = daySummary(
      [
        entry(
          'sale',
          {
            currency: 'SYP',
            totals: { totalMinor: 10_000 },
            payments: [
              { method: 'credit', currency: 'SYP', amountMinor: 4000 },
              { method: 'cash', currency: 'SYP', amountMinor: 6000 },
            ],
          },
          at,
        ),
        entry('sale', { currency: 'USD', totals: { totalMinor: 500 }, payments: [] }, at),
        entry('receipt', { currency: 'SYP', amountMinor: 2500 }, at),
        entry('return', { currency: 'SYP', totals: { totalMinor: 1000 } }, at),
        entry('sale', { currency: 'SYP', totals: { totalMinor: 99 }, payments: [] }, at, '2026-11-17'),
        entry('cash_movement', { currency: 'SYP' }, at),
      ],
      '2026-11-18',
    );
    expect(summary).toEqual({
      sales: { count: 2, byCurrency: { SYP: 10_000, USD: 500 } },
      credit: { SYP: 4000 },
      collections: { count: 1, byCurrency: { SYP: 2500 } },
      returns: { count: 1, byCurrency: { SYP: 1000 } },
    });
  });
  it('is empty for an empty day', () => {
    expect(daySummary([], '2026-11-18').sales.count).toBe(0);
  });
});

describe('an order opened as the cart', () => {
  it('holds what is left of each line at the order’s price, and names what the device lacks', async () => {
    const catalog = await loadCatalog(
      {
        readSet: async (set: string) => (posSets() as unknown as Record<string, never[]>)[set] ?? [],
      } as never,
      Date.now(),
    );
    const milk = PRODUCTS.milk.variant.id;
    const { cart, missing } = salesOrderCart(
      {
        id: 'o1',
        number: 'SO-1',
        currency: 'SYP',
        lines: [
          { variantId: milk, qty: 3000, deliveredQty: 1000, unitPriceMinor: 42_000 },
          { variantId: PRODUCTS.sugar.variant.id, qty: 1000, deliveredQty: 1000, unitPriceMinor: 1 },
          { variantId: 'gone', qty: 1000, deliveredQty: 0, unitPriceMinor: 5 },
        ],
      },
      { id: 'c1', name: 'زبون' },
      catalog,
    );
    expect(cart.salesOrder).toEqual({ id: 'o1', number: 'SO-1' });
    expect(cart.customer).toEqual({ id: 'c1', name: 'زبون' });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ variantId: milk, qty: 2000, priceMinor: 42_000, priceTyped: true });
    expect(missing).toEqual(['gone']);
  });
});
