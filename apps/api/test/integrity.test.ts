import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CashMovementPayload, SalePayload, SaleTender, ShiftReport, TrialBalance } from '@serva/core';
import type { SyncDocument } from '@serva/sync';
import {
  cartLine,
  documents,
  makeProduct,
  movement,
  openStore,
  push,
  sale,
  shiftClose,
  shiftOpen,
  type DrawerTerms,
  type Store,
} from './accounting-fixtures';
import { createDevice, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, resetDatabase } from './helpers';

/**
 * «فحص السلامة» (23 › شرط العبور; 10 › قواعد الضمان): after any day of two devices, sent in any
 * order, in any batches, with lost answers replayed:
 * - every entry balances, and so does the trial balance;
 * - each drawer's account holds exactly what the shift report expects, and after the close
 *   exactly what was counted;
 * - stock equals the stock movements;
 * - and the ledger is the same as the same documents sent in their natural order.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

const PRICES = [125_000, 37_500, 2_250_000];

const saleArb = fc.record({
  lines: fc.array(
    fc.record({
      product: fc.integer({ min: 0, max: 2 }),
      qty: fc.integer({ min: 1, max: 4 }),
      discountBp: fc.option(fc.integer({ min: 0, max: 3_000 }), { nil: null }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  way: fc.constantFrom('syp', 'usd_and_syp', 'card_and_cash', 'wallet', 'usd_change'),
  overMinor: fc.integer({ min: 0, max: 50_000 }),
  tipMinor: fc.constantFrom(0, 0, 0, 2_500),
});

const deviceDayArb = fc.record({
  sales: fc.array(saleArb, { minLength: 1, maxLength: 6 }),
  movements: fc.array(
    fc.record({
      kind: fc.constantFrom('pay_in', 'pay_out', 'expense', 'safe_drop' as const),
      amount: fc.integer({ min: 1, max: 30_000 }),
      usd: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  sypDifference: fc.integer({ min: -2_000, max: 2_000 }),
  usdDifference: fc.integer({ min: -100, max: 100 }),
  closed: fc.boolean(),
});

const caseArb = fc.record({
  devices: fc.tuple(deviceDayArb, deviceDayArb),
  order: fc.array(fc.nat(), { minLength: 40, maxLength: 40 }),
  batch: fc.integer({ min: 1, max: 5 }),
  replays: fc.array(fc.nat({ max: 20 }), { maxLength: 4 }),
});
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;
type DeviceDay = Case['devices'][0];

interface Products {
  variants: { productId: string; variantId: string; name: string }[];
}

function payments(way: string, due: number, over: number): { payments: SaleTender[]; change?: 'USD' } {
  const syp = (amount: number): SaleTender => ({ method: 'cash', currency: 'SYP', amountMinor: amount });
  switch (way) {
    case 'usd_and_syp': {
      const dollars = Math.floor(due / 130 / 2);
      if (dollars === 0) return { payments: [syp(due + over)] };
      return {
        payments: [
          { method: 'cash', currency: 'USD', amountMinor: dollars },
          syp(due - dollars * 130 + 1_000 + over),
        ],
      };
    }
    case 'card_and_cash': {
      const card = Math.floor(due / 2);
      return {
        payments: [
          ...(card > 0
            ? [{ method: 'card', currency: 'SYP', amountMinor: card, reference: 'C1' } as SaleTender]
            : []),
          syp(due - card + over),
        ],
      };
    }
    case 'wallet':
      return due > 0
        ? { payments: [{ method: 'wallet', currency: 'SYP', amountMinor: due, reference: 'W1' }] }
        : { payments: [] };
    case 'usd_change':
      return {
        payments: [{ method: 'cash', currency: 'USD', amountMinor: Math.ceil(due / 130) + 100 }],
        change: 'USD',
      };
    default:
      return { payments: [syp(due + over)] };
  }
}

/** One device's day as documents in its own order, and the drawer terms its close counted. */
function deviceDocuments(
  store: Store,
  device: TestDevice,
  products: Products,
  day: DeviceDay,
): SyncDocument[] {
  const doc = documents(device);
  const open = doc(
    'shift_open',
    shiftOpen(store.userId, [
      { currency: 'SYP', amountMinor: 200_000 },
      { currency: 'USD', amountMinor: 5_000 },
    ]),
  );
  const docs: SyncDocument[] = [open];
  const terms: Record<'SYP' | 'USD', DrawerTerms> = {
    SYP: {
      currency: 'SYP',
      opening: 200_000,
      cashIn: 0,
      changeOut: 0,
      payIn: 0,
      payOut: 0,
      drops: 0,
      counted: 0,
    },
    USD: {
      currency: 'USD',
      opening: 5_000,
      cashIn: 0,
      changeOut: 0,
      payIn: 0,
      payOut: 0,
      drops: 0,
      counted: 0,
    },
  };
  for (const s of day.sales) {
    const lines = s.lines.map((l, i) =>
      cartLine(i + 1, PRICES[l.product]!, {
        ...products.variants[l.product]!,
        qty: l.qty * 1000,
        discount:
          l.discountBp === null
            ? null
            : { type: 'percent', bp: l.discountBp, source: 'manual', reason: null, approval: null },
      }),
    );
    const gross = s.lines.reduce((acc, l) => acc + PRICES[l.product]! * l.qty, 0);
    const paid = payments(s.way, gross + s.tipMinor, s.overMinor);
    let payload: SalePayload;
    try {
      payload = sale(store, open.id, {
        lines,
        tipMinor: s.tipMinor,
        payments: paid.payments,
        changeCurrency: paid.change ?? 'SYP',
        cashSteps: { SYP: 1000, USD: 25 },
      });
    } catch {
      continue; // these payments do not cover this cart: the cashier would not have closed it
    }
    for (const p of payload.payments) if (p.method === 'cash') terms[p.currency].cashIn! += p.amountMinor;
    if (payload.change) terms[payload.change.currency].changeOut! += payload.change.amountMinor;
    docs.push(doc('sale', payload));
  }
  for (const m of day.movements) {
    const currency = m.usd ? 'USD' : 'SYP';
    const payload: CashMovementPayload = movement(store.userId, open.id, m.kind, m.amount, { currency });
    const t = terms[currency];
    if (m.kind === 'pay_in') t.payIn! += m.amount;
    else if (m.kind === 'safe_drop') t.drops! += m.amount;
    else t.payOut! += m.amount;
    docs.push(doc('cash_movement', payload));
  }
  if (day.closed) {
    const drawers = (['SYP', 'USD'] as const).map((c) => {
      const t = terms[c];
      const expected = t.opening! + t.cashIn! - t.changeOut! + t.payIn! - t.payOut! - t.drops!;
      const difference = c === 'SYP' ? day.sypDifference : day.usdDifference;
      return { ...t, counted: Math.max(0, expected + difference) };
    });
    docs.push(doc('shift_close', shiftClose(store.userId, open.id, drawers, { shiftNumber: open.number! })));
  }
  return docs;
}

/** Every entry by its source document, its lines in order: what the order of arrival must not change. */
async function ledgerOf(tenantId: string) {
  const rows = await ownerDb()<{ source_id: string; line: string }[]>`
    select e.source_id, string_agg(a.code || ':' || l.debit_minor || ':' || l.credit_minor || ':' || l.currency
             || ':' || l.amount_minor, ' ' order by l.line_no) as line
    from journal_entries e
    join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
    join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where e.tenant_id = ${tenantId}
    group by e.source_id`;
  return Object.fromEntries(rows.map((r) => [r.source_id, r.line]));
}

async function integrityCheck(store: Store, shiftIds: string[]) {
  // 1. Every entry balances and equals its total, with two lines at least.
  const unbalanced = await ownerDb()`
    select e.number from journal_entries e join journal_lines l on l.tenant_id = e.tenant_id and l.entry_id = e.id
    where e.tenant_id = ${store.tenantId}
    group by e.id, e.number, e.total_minor
    having sum(l.debit_minor) <> sum(l.credit_minor) or sum(l.debit_minor) <> e.total_minor or count(*) < 2`;
  expect(unbalanced).toEqual([]);
  // Numbers have no gaps.
  const [gaps] = await ownerDb()<{ n: number; max: number }[]>`
    select count(*)::int as n, coalesce(max(seq), 0)::int as max from journal_entries where tenant_id = ${store.tenantId}`;
  expect(gaps!.n).toBe(gaps!.max);

  // 2. The trial balance balances.
  const tb = await app.inject({
    method: 'GET',
    url: '/v1/reports/trial-balance?from=2026-10-30&to=2026-10-30',
    headers: { authorization: `Bearer ${store.accessToken}` },
  });
  const trial = tb.json<TrialBalance>();
  expect(trial.balanced).toBe(true);

  // 3. Each drawer's account against the shift report.
  for (const shiftId of shiftIds) {
    const report = (
      await app.inject({
        method: 'GET',
        url: `/v1/shifts/${shiftId}`,
        headers: { authorization: `Bearer ${store.accessToken}` },
      })
    ).json<ShiftReport>();
    const drawers = await ownerDb()<{ currency: string; flows: string; close: string }[]>`
      select l.currency,
             coalesce(sum(l.amount_minor) filter (where e.source_type <> 'shift_close'), 0)::text as flows,
             coalesce(sum(l.amount_minor) filter (where e.source_type = 'shift_close'), 0)::text as close
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.tenant_id = ${store.tenantId} and l.shift_id = ${shiftId} and a.parent_code = '1110'
      group by l.currency`;
    for (const c of report.byCurrency) {
      const d = drawers.find((x) => x.currency === c.currency);
      const flows = Number(d?.flows ?? 0);
      const close = Number(d?.close ?? 0);
      // The drawer's float is not on the books until the opening balances (see posting.ts).
      expect(c.openingMinor + flows, `${shiftId} ${c.currency} expected`).toBe(c.expectedMinor);
      if (c.countedMinor !== null) {
        expect(c.openingMinor + flows + close, `${shiftId} ${c.currency} counted`).toBe(c.countedMinor);
      }
    }
  }

  // 4. Stock equals its movements.
  const stock = await ownerDb()`
    select l.variant_id from stock_levels l
    where l.tenant_id = ${store.tenantId}
      and l.qty <> 1000000 + coalesce((select sum(m.qty) from stock_movements m
                                       where m.tenant_id = l.tenant_id and m.variant_id = l.variant_id
                                         and m.branch_id = l.branch_id), 0)`;
  expect(stock).toEqual([]);
  return trial;
}

async function storeWithProducts(phone: string) {
  const store = await openStore(app, phone);
  const second = await createDevice(store.tenantId);
  const variants = [];
  for (const [i, price] of PRICES.entries()) variants.push(await makeProduct(app, store, `صنف ${i}`, price));
  for (const v of variants) {
    await ownerDb()`insert into stock_levels (tenant_id, branch_id, variant_id, qty)
      values (${store.tenantId}, ${store.device.branchId}, ${v.variantId}, 1000000)`;
  }
  return { store, second, products: { variants } };
}

describe('فحص السلامة', () => {
  it('a day sent backwards, one document at a time (the close first, the opening last), gives the same ledger', async () => {
    await resetDatabase();
    const a = await storeWithProducts('0911111111');
    const b = await storeWithProducts('0922222222');
    const [day] = fc.sample(
      deviceDayArb.map((d) => ({ ...d, closed: true })),
      { numRuns: 1, seed: 7 },
    );
    const docs = deviceDocuments(a.store, a.store.device, a.products, day!);
    expect(docs.at(-1)!.type).toBe('shift_close');
    for (const doc of [...docs].reverse()) await push(app, a.store.device, [doc]);
    await push(app, b.store.device, docs);
    await integrityCheck(a.store, [docs[0]!.id]);
    expect(await ledgerOf(a.store.tenantId)).toEqual(await ledgerOf(b.store.tenantId));
  });
});

describe('فحص السلامة (property)', () => {
  it('any day of two devices, in any order and batches, with replays: balanced, matching drawers and stock, same ledger', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        await resetDatabase();
        const a = await storeWithProducts('0911111111');
        const b = await storeWithProducts('0922222222');
        const perDevice = [
          deviceDocuments(a.store, a.store.device, a.products, c.devices[0]),
          deviceDocuments(a.store, a.second, a.products, c.devices[1]),
        ];
        const shiftIds = perDevice.map((docs) => docs[0]!.id);

        // Store B gets the same documents in their natural order, device by device.
        await push(app, b.store.device, perDevice[0]!);
        await push(app, b.second, perDevice[1]!);

        // Store A gets them shuffled across devices and batches; a close may come before its sales.
        const tagged = perDevice.flatMap((docs, d) =>
          docs.map((doc) => ({ doc, device: d === 0 ? a.store.device : a.second })),
        );
        const shuffled = tagged
          .map((t, i) => ({ t, k: c.order[i % c.order.length]! * 1000 + i }))
          .sort((x, y) => x.k - y.k)
          .map((x) => x.t);
        const batches: (typeof tagged)[] = [];
        for (let i = 0; i < shuffled.length; i += c.batch) batches.push(shuffled.slice(i, i + c.batch));
        for (const [i, batch] of batches.entries()) {
          for (const device of [a.store.device, a.second]) {
            const docs = batch.filter((t) => t.device === device).map((t) => t.doc);
            if (docs.length === 0) continue;
            await push(app, device, docs);
            // A lost answer: the same batch again.
            if (c.replays.includes(i)) await push(app, device, docs);
          }
        }
        // Everything once more at the end, as a device that lost every answer would.
        await push(app, a.store.device, perDevice[0]!);
        await push(app, a.second, perDevice[1]!);

        const trialA = await integrityCheck(a.store, shiftIds);
        const trialB = await integrityCheck(b.store, shiftIds);
        expect(await ledgerOf(a.store.tenantId)).toEqual(await ledgerOf(b.store.tenantId));
        expect(trialA.rows).toEqual(trialB.rows);
        // Every sale has its entry, once.
        const [counts] = await ownerDb()<{ sales: number; entries: number }[]>`
          select (select count(*)::int from invoices where tenant_id = ${a.store.tenantId} and total_minor + tip_minor > 0) as sales,
                 (select count(*)::int from journal_entries where tenant_id = ${a.store.tenantId} and source_type = 'sale') as entries`;
        expect(counts!.entries).toBe(counts!.sales);
      }),
      { numRuns: 15 },
    );
  }, 600_000);
});
