import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { priceSale, type SaleCartLine, type SalePayload, type SaleTender } from '@serva/core';
import { cashMovementLines, saleLines, shiftCloseLines, type DraftLine } from '../src/services/posting';
import { cartLine, movement, newId, sale, shiftClose, USD_130 } from './accounting-fixtures';

/**
 * Properties of the entries themselves, without a database (10 › قواعد الضمان 1: every posted
 * document makes a balanced entry). Arrival order and replays are checked against the database in
 * integrity.test.ts.
 */

const TAX_ID = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a99';
const store = { userId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a98' };
const key = (l: DraftLine) =>
  'code' in l.account ? l.account.code : `${l.account.cash}${l.account.currency}`;
const sum = (lines: DraftLine[], pick: (l: DraftLine) => number) =>
  lines.reduce((acc, l) => acc + pick(l), 0);

const lineArb = fc.record({
  priceMinor: fc.integer({ min: 0, max: 3_000_000 }),
  qty: fc.integer({ min: 1, max: 9_000 }),
  usd: fc.boolean(),
  taxBp: fc.constantFrom(0, 0, 500, 1500),
  discountBp: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
});

const saleArb = fc.record({
  lines: fc.array(lineArb, { minLength: 1, maxLength: 6 }),
  taxInclusive: fc.boolean(),
  invoiceDiscountBp: fc.option(fc.integer({ min: 0, max: 5_000 }), { nil: null }),
  tipMinor: fc.constantFrom(0, 0, 500, 2_500),
  cardPercent: fc.integer({ min: 0, max: 100 }),
  creditPercent: fc.integer({ min: 0, max: 100 }),
  usdCashMinor: fc.integer({ min: 0, max: 20_000 }),
  sypOverMinor: fc.integer({ min: 0, max: 500_000 }),
  changeInUsd: fc.boolean(),
  steps: fc.boolean(),
});

/** A sale the cashier could really close, or null when these payments would not cover it. */
type SaleCase = typeof saleArb extends fc.Arbitrary<infer T> ? T : never;
function makeSale(c: SaleCase): SalePayload | null {
  const lines: SaleCartLine[] = c.lines.map((l, i) =>
    cartLine(i + 1, l.usd ? Math.ceil(l.priceMinor / 130) : l.priceMinor, {
      qty: l.qty,
      priceCurrency: l.usd ? 'USD' : 'SYP',
      taxRateBp: l.taxBp,
      taxRateId: l.taxBp ? TAX_ID : null,
      discount:
        l.discountBp === null
          ? null
          : { type: 'percent', bp: l.discountBp, source: 'manual', reason: null, approval: null },
    }),
  );
  const invoiceDiscount =
    c.invoiceDiscountBp === null
      ? null
      : ({
          type: 'percent',
          bp: c.invoiceDiscountBp,
          source: 'manual',
          reason: null,
          approval: null,
        } as const);
  const total = priceSale({
    currency: 'SYP',
    taxInclusive: c.taxInclusive,
    exchangeRates: [USD_130],
    lines,
    invoiceDiscount,
  }).priced.totals.totalMinor;
  const due = total + c.tipMinor;
  const card = Math.floor((due * c.cardPercent) / 100);
  const credit = Math.floor(((due - card) * c.creditPercent) / 100);
  const left = due - card - credit - c.usdCashMinor * 130;
  const payments: SaleTender[] = [];
  if (card > 0) payments.push({ method: 'card', currency: 'SYP', amountMinor: card, reference: 'A1' });
  if (credit > 0) payments.push({ method: 'credit', currency: 'SYP', amountMinor: credit });
  if (c.usdCashMinor > 0) payments.push({ method: 'cash', currency: 'USD', amountMinor: c.usdCashMinor });
  const syp = Math.max(left, 0) + c.sypOverMinor + 1_000;
  if (!c.changeInUsd || left > 0) payments.push({ method: 'cash', currency: 'SYP', amountMinor: syp });
  try {
    return sale(store, newId(), {
      lines,
      invoiceDiscount,
      taxInclusive: c.taxInclusive,
      tipMinor: c.tipMinor,
      customerId: credit > 0 ? newId() : null,
      payments,
      changeCurrency: c.changeInUsd && c.usdCashMinor > 0 && left <= 0 ? 'USD' : 'SYP',
      cashSteps: c.steps ? { SYP: 1000, USD: 25 } : {},
    });
  } catch {
    return null;
  }
}

describe('every sale makes a balanced entry (property)', () => {
  it('debits equal credits in the base currency, sales are the gross, cash is what stayed in each drawer', () => {
    let built = 0;
    fc.assert(
      fc.property(saleArb, (c) => {
        const payload = makeSale(c);
        if (!payload) return;
        built += 1;
        const lines = saleLines(payload, () => '2200');
        expect(sum(lines, (l) => l.baseMinor) + 0).toBe(0);
        // No «device totals» line for a sale the engine made.
        expect(lines.filter((l) => l.memo === 'فرق مجاميع الجهاز')).toEqual([]);
        const gross = payload.lines.reduce((acc, l) => acc + l.priced.grossExTaxMinor, 0);
        const discount = payload.lines.reduce((acc, l) => acc + l.priced.discountExTaxMinor, 0);
        const byKey = (k: string) => lines.filter((l) => key(l) === k);
        expect(sum(byKey('4100'), (l) => l.baseMinor) + gross).toBe(0);
        expect(sum(byKey('4200'), (l) => l.baseMinor)).toBe(discount);
        expect(sum(byKey('2200'), (l) => l.baseMinor) + payload.totals.taxMinor).toBe(0);
        expect(sum(byKey('2550'), (l) => l.baseMinor) + payload.tipMinor).toBe(0);
        for (const currency of ['SYP', 'USD'] as const) {
          const tendered = payload.payments
            .filter((p) => p.method === 'cash' && p.currency === currency)
            .reduce((acc, p) => acc + p.amountMinor, 0);
          const change = payload.change?.currency === currency ? payload.change.amountMinor : 0;
          expect(sum(byKey(`1110${currency}`), (l) => l.amountMinor) - (tendered - change)).toBe(0);
        }
        // Each line keeps one side: its own amount never has the other sign of its base.
        for (const l of lines) expect(l.baseMinor * l.amountMinor).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 400 },
    );
    expect(built).toBeGreaterThan(100);
  });
});

describe('every drawer movement and every close make a balanced entry (property)', () => {
  it('cash movements', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pay_in', 'pay_out', 'expense', 'safe_drop' as const),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.constantFrom('SYP', 'USD' as const),
        (kind, amount, currency) => {
          const m = movement(store.userId, newId(), kind, amount, { currency });
          const lines = cashMovementLines(m, '6102');
          expect(lines).toHaveLength(2);
          expect(sum(lines, (l) => l.baseMinor) + 0).toBe(0);
          const drawer = lines.find((l) => key(l) === `1110${currency}`)!;
          expect(Math.abs(drawer.amountMinor)).toBe(amount);
          expect(drawer.amountMinor > 0).toBe(kind === 'pay_in');
        },
      ),
    );
  });

  it('shift closes, any difference in either currency, either treatment', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.boolean(),
        (opening, counted, usdOpening, usdCounted, charge) => {
          const close = shiftClose(
            store.userId,
            newId(),
            [
              { currency: 'SYP', opening, counted },
              { currency: 'USD', opening: usdOpening, counted: usdCounted },
            ],
            charge
              ? {
                  shortageTreatment: 'cashier_receivable',
                  approval: {
                    userId: store.userId,
                    method: 'pin',
                    at: '2026-10-30T20:00:00.000Z',
                    offline: false,
                  },
                }
              : {},
          );
          const lines = shiftCloseLines(close);
          expect(sum(lines, (l) => l.baseMinor) + 0).toBe(0);
          expect(sum(lines, (l) => (key(l) === '1110SYP' ? l.amountMinor : 0)) - (counted - opening)).toBe(0);
          expect(
            sum(lines, (l) => (key(l) === '1110USD' ? l.amountMinor : 0)) - (usdCounted - usdOpening),
          ).toBe(0);
          // A surplus is never charged to the cashier.
          for (const l of lines) if (key(l) === '1250') expect(l.baseMinor).toBeGreaterThan(0);
        },
      ),
    );
  });
});
