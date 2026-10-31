/**
 * The edges of the sale engine that mutation testing found unguarded (M0-2, part 3).
 *
 * sale.ts scored 92.01, over the 85 threshold, but passing the threshold is not the bar:
 * among the survivors were a flipped sign on a posted rounding amount, a business-day
 * cutoff whose minutes were dropped, and an exchange-rate lookup that would accept a rate
 * for the wrong pair. Each is a wrong number on a real receipt, so each gets a test.
 *
 * Every test names the mutant it kills.
 */
import { describe, expect, it } from 'vitest';
import type { TradeRate } from './contracts/common';
import { businessDateOf, rateFor, settleSale } from './sale';

/**
 * A rate naming a currency the store cannot trade in. The type system rules this out, but
 * a device sends JSON that is parsed at runtime, so the lookup still has to refuse it.
 */
const foreignRate = (unit: string, quote: string): TradeRate =>
  ({ unit, quote, rate: '1' }) as unknown as TradeRate;

const STEPS = { SYP: 1000, USD: 25 } as const;

describe('the rounding kept when nothing is handed over', () => {
  // Kills `roundingMinor: -exactS` → `+exactS` in the no-cash branch. The suite reached
  // this branch but asserted exactMinor and roundingBaseMinor only, never the sign of the
  // rounding itself — and that sign decides whether the rounding account is credited or
  // debited. A sale that ends with 4.00 ل.س left and no cash forgives those 4.00: the
  // rounding is -400, not +400.
  it('is a loss to the store, not a gain', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [],
      totalMinor: 100_400,
      payments: [{ method: 'card', currency: 'SYP', amountMinor: 100_000, reference: '1' }],
      cashSteps: STEPS,
    });
    expect(settled.cashRounding).toEqual({
      currency: 'SYP',
      stepMinor: 1000,
      exactMinor: 400,
      dueMinor: 0,
      roundingMinor: -400,
      roundingBaseMinor: -400,
    });
    // The books only balance if the rounding cancels what was left unpaid.
    expect(settled.cashRounding!.roundingMinor).toBe(-settled.cashRounding!.exactMinor);
    expect(settled.covered).toBe(true);
  });

  // With cash in hand the whole amount due is rounded to the step, and the rounding is
  // the difference between what is collected and what was owed. The sign follows the
  // direction of the rounding, so both directions are pinned.
  it('is the difference between what is collected and what was owed, either way', () => {
    const rounding = (totalMinor: number) =>
      settleSale({
        currency: 'SYP',
        exchangeRates: [],
        totalMinor,
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 200_000 }],
        cashSteps: STEPS,
      }).cashRounding!;

    // 1,004.00 rounds down to 1,000.00: the store forgives 4.00.
    expect(rounding(100_400)).toMatchObject({ exactMinor: 100_400, dueMinor: 100_000, roundingMinor: -400 });
    // 1,006.00 rounds up to 1,010.00: the store keeps 4.00.
    expect(rounding(100_600)).toMatchObject({ exactMinor: 100_600, dueMinor: 101_000, roundingMinor: 400 });
    for (const total of [100_400, 100_600]) {
      const r = rounding(total);
      expect(r.roundingMinor).toBe(r.dueMinor - r.exactMinor);
    }
  });

  // Kills `hasCash ? changeS >= 0 : …` → `false`, which would judge a cash sale by the
  // rule meant for one with no cash. A sale paid with a larger note is covered and gives
  // change; under the mutant it would read as still owing money.
  it('counts a sale paid with a larger note as covered, with change', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [],
      totalMinor: 100_600,
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 200_000 }],
      cashSteps: STEPS,
    });
    expect(settled.covered).toBe(true);
    expect(settled.change).toMatchObject({ currency: 'SYP', amountMinor: 99_000 });
    expect(settled.remainingMinor).toBe(0);
  });
});

describe('an exchange rate is matched on both of its currencies', () => {
  const usdSyp: TradeRate = { unit: 'USD', quote: 'SYP', rate: '130' };
  const wrongPair = foreignRate('USD', 'SYP_OLD');

  // Kills the `&&` → `||` and the `ConditionalExpression` → `true` mutants on both halves
  // of the lookup. Under them a rate that shares only one of the two currencies is
  // accepted, so a sale would be converted at a rate that belongs to another pair.
  it('refuses a rate that shares only one currency with the pair asked for', () => {
    expect(rateFor([usdSyp], 'USD', 'SYP')).toBe(usdSyp);
    expect(() => rateFor([wrongPair], 'USD', 'SYP')).toThrow(/exchange rate/);
    expect(() => rateFor([foreignRate('SYP_OLD', 'SYP')], 'USD', 'SYP')).toThrow(/exchange rate/);
    // The mirror of the case above, for the other half of the lookup: the unit is the
    // invoice currency but the quote is a third one.
    expect(() => rateFor([foreignRate('SYP', 'SYP_OLD')], 'USD', 'SYP')).toThrow(/exchange rate/);
    expect(() => rateFor([], 'USD', 'SYP')).toThrow(/exchange rate/);
  });

  it('takes a rate stored either way round, and none when both sides are the same', () => {
    const sypUsd: TradeRate = { unit: 'SYP', quote: 'USD', rate: '0.0077' };
    expect(rateFor([sypUsd], 'USD', 'SYP')).toBe(sypUsd);
    expect(rateFor([usdSyp], 'SYP', 'USD')).toBe(usdSyp);
    expect(rateFor([usdSyp], 'SYP', 'SYP')).toBeUndefined();
  });

  // Kills `rate?.rate !== sRate?.rate || rate?.unit !== sRate?.unit` → `false`, which
  // drops the "all cash in the settlement currency at one rate" check. Two notes of the
  // same currency taken at different rates would value one drawer two ways.
  it('refuses cash in the settlement currency taken at two different rates', () => {
    const settle = (second: string) =>
      settleSale({
        currency: 'SYP',
        exchangeRates: [usdSyp],
        changeCurrency: 'USD',
        totalMinor: 260_000,
        payments: [
          { method: 'cash', currency: 'USD', amountMinor: 1000, rate: usdSyp },
          { method: 'cash', currency: 'USD', amountMinor: 1000, rate: { ...usdSyp, rate: second } },
        ],
        cashSteps: STEPS,
      });
    expect(() => settle('128')).toThrow(/one rate/);
    expect(() => settle('130')).not.toThrow();

    // Same number, opposite direction: only the unit tells these two apart, so this is
    // what kills the mutant that drops the unit half of the check.
    expect(() =>
      settleSale({
        currency: 'SYP',
        exchangeRates: [usdSyp],
        changeCurrency: 'USD',
        totalMinor: 260_000,
        payments: [
          { method: 'cash', currency: 'USD', amountMinor: 1000, rate: usdSyp },
          {
            method: 'cash',
            currency: 'USD',
            amountMinor: 1000,
            rate: { unit: 'SYP', quote: 'USD', rate: '130' },
          },
        ],
        cashSteps: STEPS,
      }),
    ).toThrow(/one rate/);
  });
});

describe('the business day ends at the cutoff, to the minute', () => {
  // 01:30 on the 31st in Damascus (UTC+3).
  const lateNight = Date.parse('2026-10-30T22:30:00Z');

  // Kills `(h * 60 + m) * 60_000` → `h * 60 - m`. With the minutes dropped the shift is
  // wrong by hours, so a late sale lands on the wrong business day and so in the wrong
  // day's takings.
  it('counts the minutes of the cutoff, not only its hours', () => {
    // 01:30 local. A 01:00 cutoff has passed, so the sale belongs to the new day.
    expect(businessDateOf(lateNight, 'Asia/Damascus', '01:00')).toBe('2026-10-31');
    // A 01:45 cutoff has not: the sale still belongs to the evening before.
    expect(businessDateOf(lateNight, 'Asia/Damascus', '01:45')).toBe('2026-10-30');
    // The two differ only by the minutes, which is what the mutant throws away.
    expect(businessDateOf(lateNight, 'Asia/Damascus', '01:00')).not.toBe(
      businessDateOf(lateNight, 'Asia/Damascus', '01:45'),
    );
  });

  // Kills both anchor mutants and the negated-class mutant of the HH:MM pattern. Without
  // an anchor a cutoff with text around it is read as a time, and the day would start
  // somewhere nobody chose.
  it.each(['x04:00', '04:00x', ' 04:00', '04:00 ', '4:00', '24:00', '04:60', '0400', ''])(
    'refuses the cutoff %j',
    (cutoff) => {
      expect(() => businessDateOf(lateNight, 'Asia/Damascus', cutoff)).toThrow(/HH:MM/);
    },
  );

  it.each(['00:00', '04:00', '23:59', '20:00'])('accepts the cutoff %j', (cutoff) => {
    expect(businessDateOf(lateNight, 'Asia/Damascus', cutoff)).toMatch(/^2026-10-(30|31)$/);
  });

  // Kills `typeof instant === 'number' ? instant : instant.getTime()` → `instant`, which
  // would read a Date as a number and shift every date by the epoch.
  it('takes a Date and a number alike', () => {
    expect(businessDateOf(new Date(lateNight), 'Asia/Damascus', '04:00')).toBe(
      businessDateOf(lateNight, 'Asia/Damascus', '04:00'),
    );
    expect(businessDateOf(new Date(lateNight), 'Asia/Damascus', '04:00')).toBe('2026-10-30');
    expect(() => businessDateOf(new Date(Number.NaN), 'Asia/Damascus')).toThrow(/instant/);
  });
});
