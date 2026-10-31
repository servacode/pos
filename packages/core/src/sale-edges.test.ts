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
import { buildSalePayload, businessDateOf, rateFor, settleSale, verifySalePayload } from './sale';

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
    // Quote matches the currency asked for, unit belongs to neither: still the wrong pair.
    expect(() => rateFor([foreignRate('SYP_OLD', 'USD')], 'USD', 'SYP')).toThrow(/exchange rate/);
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

describe('what counts as cash in the settlement currency', () => {
  const usdSyp: TradeRate = { unit: 'USD', quote: 'SYP', rate: '130' };

  // Kills `p.currency === settlement` → `true` in the settlement-tender filter. Under the
  // mutant a pound note counts as if it were a dollar note, so the change owed is worked
  // out from the wrong pile.
  it('leaves out cash in another currency', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [usdSyp],
      changeCurrency: 'USD',
      totalMinor: 130_000,
      payments: [
        { method: 'cash', currency: 'SYP', amountMinor: 65_000 },
        { method: 'cash', currency: 'USD', amountMinor: 600, rate: usdSyp },
      ],
      cashSteps: STEPS,
    });
    // 1,300 ل.س due, 650 ل.س in notes and 6.00 $ (780 ل.س): 5.00 $ settles the rest and
    // 1.00 $ comes back. Only the dollars count towards the dollar change.
    expect(settled.cashRounding).toMatchObject({ currency: 'USD', exactMinor: 500, dueMinor: 500 });
    expect(settled.change).toMatchObject({ currency: 'USD', amountMinor: 100 });
    expect(settled.covered).toBe(true);
  });

  // Kills `p.method === 'cash'` → `true` in the settlement-tender filter. A card paid in
  // the settlement currency is not cash in the drawer: counted as such, the sale would
  // round it to a cash step and hand back change for money never received.
  it('leaves out a card paid in the settlement currency', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [usdSyp],
      changeCurrency: 'USD',
      totalMinor: 130_000,
      payments: [{ method: 'card', currency: 'USD', amountMinor: 1000, rate: usdSyp, reference: '1' }],
      cashSteps: STEPS,
    });
    // 10.00 $ on the card covers 1,300 ل.س exactly: no drawer, so no rounding and no change.
    expect(settled.covered).toBe(true);
    expect(settled.cashRounding).toBe(null);
    expect(settled.change).toBe(null);
  });

  // Kills `p.method === 'cash'` → `true` the other way round: the "one rate" rule covers
  // the drawer, not the card machine. A card taken at yesterday's rate beside cash at
  // today's is ordinary; counting the card as drawer cash would refuse that sale outright.
  it('lets a card and the drawer carry different rates', () => {
    expect(() =>
      settleSale({
        currency: 'SYP',
        exchangeRates: [usdSyp],
        changeCurrency: 'USD',
        totalMinor: 260_000,
        payments: [
          {
            method: 'card',
            currency: 'USD',
            amountMinor: 1000,
            rate: { ...usdSyp, rate: '128' },
            reference: '1',
          },
          { method: 'cash', currency: 'USD', amountMinor: 1000, rate: usdSyp },
        ],
        cashSteps: STEPS,
      }),
    ).not.toThrow();
  });

  // Kills `p.currency === base` → `false` in the rate lookup. A note already in the base
  // currency needs no rate; under the mutant a rate sent with it would be kept and the
  // note valued through it.
  it('records no rate against a note already in the base currency', () => {
    const settled = settleSale({
      currency: 'SYP',
      exchangeRates: [usdSyp],
      totalMinor: 100_000,
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 100_000, rate: usdSyp }],
      cashSteps: STEPS,
    });
    expect(settled.payments[0]!.rate).toBe(null);
    expect(settled.payments[0]!.baseAmountMinor).toBe(100_000);
  });
});

describe('the device and engine comparison refuses anything but a true match', () => {
  // verifySalePayload is how the server catches a till that sent different numbers from
  // the ones its own engine computes. Its deep comparison had several mutants alive, each
  // making the comparison more forgiving — and a forgiving comparison is a tampered sale
  // accepted without a flag.
  const sale = () =>
    buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [{ unit: 'USD', quote: 'SYP', rate: '130' }],
      lines: [
        {
          lineNo: 1,
          productId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a11',
          variantId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a12',
          name: 'صنف',
          qty: 1000,
          priceCurrency: 'SYP',
          priceMinor: 32_500,
          taxRateBp: 0,
        },
      ],
      shiftId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01',
      cashierId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02',
      payments: [{ method: 'cash', currency: 'SYP', amountMinor: 33_000 }],
      cashSteps: STEPS,
    });

  it('agrees with an untouched payload', () => {
    expect(verifySalePayload(sale())).toEqual([]);
  });

  // Kills `ka.length === kb.length` → `true`: an object missing a key, or carrying an
  // extra one, would compare equal as long as the keys they share agree.
  it('notices a key dropped from a nested object, and one added', () => {
    const short = sale();
    delete (short.totals as unknown as Record<string, unknown>).taxMinor;
    expect(verifySalePayload(short).map((m) => m.path)).toContain('totals');

    const long = sale();
    (long.totals as unknown as Record<string, unknown>).extraMinor = 0;
    expect(verifySalePayload(long).map((m) => m.path)).toContain('totals');
  });

  // The `Array.isArray(a) !== Array.isArray(b)` guard has no test here on purpose: every
  // value this function compares is an object or a number, never an array, so no payload
  // can reach that line through verifySalePayload. It stays as a guard for future fields.

  // Kills the `typeof a !== 'object'` / `a === null` guards: null against an object, and a
  // number against an object, must never compare equal.
  it('tells null and a plain value apart from an object', () => {
    const nulled = sale();
    (nulled as unknown as Record<string, unknown>).totals = null;
    expect(verifySalePayload(nulled).map((m) => m.path)).toContain('totals');

    const numbered = sale();
    (numbered as unknown as Record<string, unknown>).totals = 0;
    expect(verifySalePayload(numbered).map((m) => m.path)).toContain('totals');

    const fromNull = sale();
    (fromNull as unknown as Record<string, unknown>).change = { currency: 'SYP' };
    expect(verifySalePayload(fromNull).map((m) => m.path)).toContain('change');
  });

  it('notices a number changed deep inside a line', () => {
    const tampered = sale();
    tampered.lines[0]!.priced.totalMinor -= 100;
    expect(verifySalePayload(tampered).map((m) => m.path)).toContain('lines.0.priced');
  });
});
