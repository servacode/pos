import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBasisPoints,
  convert,
  fixedRate,
  formatMoney,
  lineGross,
  parseDecimal,
  parseRate,
  roundDiv,
  roundToStep,
  sumMinor,
  toMinor,
  type ExchangeRate,
} from './money';
import type { CurrencyId } from './currencies';
import { stripBidiControls, toLatinDigits } from './text';

describe('roundDiv', () => {
  it('rounds half away from zero', () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(7n, 3n)).toBe(2n);
    expect(roundDiv(-7n, 3n)).toBe(-2n);
    expect(roundDiv(8n, 3n)).toBe(3n);
    expect(roundDiv(-8n, 3n)).toBe(-3n);
    expect(roundDiv(149n, 100n)).toBe(1n);
    expect(roundDiv(150n, 100n)).toBe(2n);
    expect(roundDiv(-150n, 100n)).toBe(-2n);
    expect(roundDiv(0n, 7n)).toBe(0n);
    expect(roundDiv(12n, 4n)).toBe(3n);
  });

  it('rejects a non-positive denominator', () => {
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
    expect(() => roundDiv(1n, -2n)).toThrow(RangeError);
  });
});

describe('applyBasisPoints', () => {
  it('takes a rounded percentage', () => {
    expect(applyBasisPoints(231, 1500)).toBe(35); // 34.65
    expect(applyBasisPoints(208, 1500)).toBe(31); // 31.2
    expect(applyBasisPoints(5, 5000)).toBe(3); // 2.5 → 3
    expect(applyBasisPoints(-5, 5000)).toBe(-3);
    expect(applyBasisPoints(1999, 10000)).toBe(1999);
    expect(applyBasisPoints(1999, 0)).toBe(0);
  });

  it('stays exact beyond 2^53 intermediate products', () => {
    expect(applyBasisPoints(Number.MAX_SAFE_INTEGER, 10000)).toBe(Number.MAX_SAFE_INTEGER);
    expect(applyBasisPoints(9_000_000_000_000_000 - 1, 5000)).toBe(4_500_000_000_000_000);
  });

  it('rejects non-integers and overflow', () => {
    expect(() => applyBasisPoints(1.5, 100)).toThrow(RangeError);
    expect(() => applyBasisPoints(100, 0.5)).toThrow(RangeError);
    expect(() => applyBasisPoints(Number.MAX_SAFE_INTEGER, 20000)).toThrow(RangeError);
  });
});

describe('lineGross', () => {
  it('multiplies price by quantity in thousandths', () => {
    expect(lineGross(125, 2000)).toBe(250); // 2 × 1.25
    expect(lineGross(1200, 250)).toBe(300); // 0.250 kg × 12.00
    expect(lineGross(999, 333)).toBe(333); // 332.667
    expect(lineGross(1, 500)).toBe(1); // 0.5 → 1
    expect(lineGross(0, 5000)).toBe(0);
  });

  it('rejects non-integer inputs', () => {
    expect(() => lineGross(1.25, 2000)).toThrow(RangeError);
    expect(() => lineGross(125, 0.25)).toThrow(RangeError);
    expect(() => lineGross(Number.MAX_SAFE_INTEGER, 2000)).toThrow(RangeError);
  });
});

describe('roundToStep', () => {
  it('rounds to the nearest multiple, half away from zero', () => {
    expect(roundToStep(1409, 5)).toBe(1410);
    expect(roundToStep(1407, 5)).toBe(1405);
    expect(roundToStep(1405, 10)).toBe(1410);
    expect(roundToStep(-1405, 10)).toBe(-1410);
    expect(roundToStep(1_234_567, 5000)).toBe(1_235_000);
    expect(roundToStep(2500, 5000)).toBe(5000);
    expect(roundToStep(2499, 5000)).toBe(0);
  });

  it('rejects a non-positive step', () => {
    expect(() => roundToStep(100, 0)).toThrow(RangeError);
    expect(() => roundToStep(100, -5)).toThrow(RangeError);
  });
});

describe('sumMinor', () => {
  it('sums exactly and refuses overflow', () => {
    expect(sumMinor([])).toBe(0);
    expect(sumMinor([266, 239, 904])).toBe(1409);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => sumMinor([1.5])).toThrow(RangeError);
  });
});

describe('allocate', () => {
  it('splits by largest remainder (the worked-example invoice discount)', () => {
    // 100 across nets 2.50 / 2.25 / 8.50 → 18.87 / 16.98 / 64.15
    expect(allocate(100, [250, 225, 850])).toEqual([19, 17, 64]);
  });

  it('breaks remainder ties by larger weight, then lower index when no keys are given', () => {
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(1, [3, 3, 6])).toEqual([0, 0, 1]); // largest remainder
    // Exact shares 0.5 / 1.5: equal remainders, so the larger weight gets the leftover unit.
    expect(allocate(2, [1, 3])).toEqual([0, 2]);
    expect(allocate(2, [3, 1])).toEqual([2, 0]);
    // Exact shares 0.5 / 1 / 1 / 0.5: equal remainders and weights, so the lower index wins.
    expect(allocate(3, [2, 4, 4, 2])).toEqual([1, 1, 1, 0]);
  });

  it('breaks the last ties by the smaller stable key (line_no), not by position', () => {
    expect(allocate(1, [1, 1, 1], [30, 10, 20])).toEqual([0, 1, 0]);
    expect(allocate(2, [1, 1, 1], [30, 10, 20])).toEqual([0, 1, 1]);
    expect(allocate(3, [2, 4, 4, 2], [4, 3, 2, 1])).toEqual([0, 1, 1, 1]);
    expect(allocate(2, [1, 3], [2, 1])).toEqual([0, 2]); // the larger weight still comes first
    expect(allocate(10, [0, 0, 0], [3, 1, 2])).toEqual([3, 4, 3]);
    expect(allocate(-10, [0, 0, 0], [3, 1, 2])).toEqual([-3, -4, -3]);
  });

  it('handles zero totals and zero weights', () => {
    expect(allocate(0, [5, 0, 7])).toEqual([0, 0, 0]);
    expect(allocate(0, [])).toEqual([]);
    expect(allocate(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocate(-10, [0, 0, 0])).toEqual([-4, -3, -3]);
    expect(allocate(5, [0, 3, 0])).toEqual([0, 5, 0]);
  });

  it('mirrors negative totals', () => {
    expect(allocate(-100, [250, 225, 850])).toEqual([-19, -17, -64]);
  });

  it('rejects invalid input', () => {
    expect(() => allocate(10, [1, -1])).toThrow(RangeError);
    expect(() => allocate(10, [1.5])).toThrow(RangeError);
    expect(() => allocate(1.5, [1])).toThrow(RangeError);
    expect(() => allocate(10, [])).toThrow(RangeError);
    expect(() => allocate(10, [1, 1], [1])).toThrow(/one key per weight/);
    expect(() => allocate(10, [1, 1], [1, 1])).toThrow(/unique/);
    expect(() => allocate(10, [1, 1], [1, 1.5])).toThrow(RangeError);
  });

  // Small weights and totals make remainder ties common; large ones exercise the BigInt range.
  const weightsArb = fc.array(
    fc.oneof(
      { arbitrary: fc.integer({ min: 0, max: 4 }), weight: 3 },
      { arbitrary: fc.integer({ min: 0, max: 10_000_000 }), weight: 1 },
    ),
    { minLength: 1, maxLength: 12 },
  );
  const totalArb = fc.oneof(
    fc.integer({ min: -12, max: 12 }),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
  );

  it('always sums exactly, mirrors negatives and stays within one unit of the exact share (property)', () => {
    fc.assert(
      fc.property(totalArb, weightsArb, (total, weights) => {
        const shares = allocate(total, weights);
        expect(shares).toHaveLength(weights.length);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(allocate(-total, weights)).toEqual(shares.map((s) => (s === 0 ? 0 : -s)));
        const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
        if (weightSum > 0n) {
          shares.forEach((share, i) => {
            // |share × W − total × w| < W
            const diff = BigInt(share) * weightSum - BigInt(total) * BigInt(weights[i] ?? 0);
            expect(diff < 0n ? -diff : diff).toBeLessThan(weightSum);
          });
        }
      }),
    );
  });

  it('gives every keyed weight the same share whatever the order (property)', () => {
    const entriesArb = weightsArb.chain((weights) =>
      fc
        .uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: weights.length,
          maxLength: weights.length,
        })
        .map((keys) => weights.map((weight, i) => ({ weight, key: keys[i] ?? 0 }))),
    );
    const orderingsArb = entriesArb.chain((entries) =>
      fc.tuple(fc.constant(entries), fc.shuffledSubarray(entries, { minLength: entries.length })),
    );
    fc.assert(
      fc.property(totalArb, orderingsArb, (total, [entries, shuffled]) => {
        const sharesByKey = (list: typeof entries) => {
          const shares = allocate(
            total,
            list.map((e) => e.weight),
            list.map((e) => e.key),
          );
          return new Map(list.map((e, i) => [e.key, shares[i]]));
        };
        expect(sharesByKey(shuffled)).toEqual(sharesByKey(entries));
      }),
    );
  });
});

describe('parseDecimal', () => {
  it('parses plain and grouped decimals', () => {
    expect(parseDecimal('12.50', 2)).toBe(1250n);
    expect(parseDecimal('1,234.5', 2)).toBe(123450n);
    expect(parseDecimal('1,234,567', 0)).toBe(1234567n);
    expect(parseDecimal('  7 ', 3)).toBe(7000n);
    expect(parseDecimal('.5', 2)).toBe(50n);
    expect(parseDecimal('5.', 2)).toBe(500n);
    expect(parseDecimal('+3', 1)).toBe(30n);
    expect(parseDecimal('-0.25', 2)).toBe(-25n);
    expect(parseDecimal('0.250', 3)).toBe(250n);
  });

  it('parses Arabic-Indic digits and Arabic separators', () => {
    expect(parseDecimal('١٢٫٥٠', 2)).toBe(1250n);
    expect(parseDecimal('١٢٫٥', 2)).toBe(1250n);
    expect(parseDecimal('١٬٢٣٤٫٥', 2)).toBe(123450n);
    expect(parseDecimal('١٬٢٣٤٬٥٦٧', 0)).toBe(1234567n);
    expect(parseDecimal('۱۲۳٫۴۵', 2)).toBe(12345n); // Persian digits
    expect(parseDecimal('\u200f١٢٫٥٠\u200f', 2)).toBe(1250n); // RTL marks from copied text
    expect(parseDecimal('−١٢٫٥', 2)).toBe(-1250n); // minus sign U+2212
    expect(parseDecimal('\u2066−1,250.00\u2069', 2)).toBe(-125000n); // isolated, as formatMoney writes it
  });

  it('rounds half away from zero beyond the scale', () => {
    expect(parseDecimal('1.005', 2)).toBe(101n);
    expect(parseDecimal('1.0049', 2)).toBe(100n);
    expect(parseDecimal('-1.005', 2)).toBe(-101n);
    expect(parseDecimal('0.0000775', 6)).toBe(78n);
    expect(parseDecimal('9.995', 2)).toBe(1000n);
  });

  it('throws RangeError on invalid input', () => {
    for (const bad of [
      '',
      ' ',
      '.',
      '-',
      'abc',
      '1.2.3',
      '1,23',
      '12,34.5',
      ',123',
      '--1',
      '1e5',
      '1 000',
      '0x10',
    ]) {
      expect(() => parseDecimal(bad, 2), bad).toThrow(RangeError);
    }
    expect(() => parseDecimal('1', -1)).toThrow(RangeError);
    expect(() => parseDecimal('1', 1.5)).toThrow(RangeError);
    expect(() => parseDecimal(12 as unknown as string, 2)).toThrow(/must be a string/);
  });
});

describe('toMinor', () => {
  it('uses the currency decimals', () => {
    expect(toMinor('12.50', 'USD')).toBe(1250);
    expect(toMinor('1,250', 'SYP')).toBe(125000);
    expect(toMinor('١٢٫٥٠', 'USD')).toBe(1250);
    expect(toMinor('-0.01', 'USD')).toBe(-1);
  });

  it('rejects overflow and unknown currencies', () => {
    expect(() => toMinor('99999999999999999999', 'SYP')).toThrow(RangeError);
    expect(() => toMinor('1', 'EUR' as CurrencyId)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  /** The isolated form formatMoney writes: RLI ⟨LRI number PDI⟩ symbol PDI, or LRI number PDI alone. */
  const iso = (number: string, symbol?: string) =>
    symbol === undefined ? `\u2066${number}\u2069` : `\u2067\u2066${number}\u2069 ${symbol}\u2069`;

  it('isolates the number (LTR) and the amount with its symbol (RTL), symbol after the number', () => {
    expect(formatMoney(1250, 'USD')).toBe(iso('12.50', '$'));
    expect(formatMoney(5, 'USD')).toBe(iso('0.05', '$'));
    expect(formatMoney(0, 'USD')).toBe(iso('0.00', '$'));
    expect(formatMoney(123456789, 'USD', { symbol: false })).toBe(iso('1,234,567.89'));
  });

  it('shows the display decimals of the currency, not its stored decimals', () => {
    // Spec 14: the new pound is stored in qirsh and shown without fractions by default.
    expect(formatMoney(125000, 'SYP')).toBe(iso('1,250', 'ل.س'));
    expect(formatMoney(125000, 'SYP', { decimals: 2 })).toBe(iso('1,250.00', 'ل.س'));
    expect(formatMoney(125050, 'SYP', { decimals: 2, symbol: false })).toBe(iso('1,250.50'));
    expect(formatMoney(1250, 'USD', { decimals: 4, symbol: false })).toBe(iso('12.5000'));
    expect(formatMoney(125_000_000, 'SYP_OLD')).toBe(iso('1,250,000', 'ل.س قديمة'));
  });

  it('rounds hidden fractions half away from zero, for display only', () => {
    expect(formatMoney(125050, 'SYP', { symbol: false })).toBe(iso('1,251'));
    expect(formatMoney(125049, 'SYP', { symbol: false })).toBe(iso('1,250'));
    expect(formatMoney(-125050, 'SYP', { symbol: false })).toBe(iso('−1,251'));
    expect(formatMoney(1255, 'USD', { decimals: 1, symbol: false })).toBe(iso('12.6'));
  });

  it('writes negatives with the minus sign U+2212 inside the LTR isolate, never «−0»', () => {
    expect(formatMoney(-1250, 'USD')).toBe(iso('−12.50', '$'));
    expect(formatMoney(-125000, 'SYP')).toBe(iso('−1,250', 'ل.س'));
    expect(formatMoney(-50, 'SYP', { symbol: false })).toBe(iso('−1'));
    expect(formatMoney(-49, 'SYP', { symbol: false })).toBe(iso('0'));
    expect(formatMoney(-1250, 'USD')).not.toContain('-');
  });

  it('drops the sign for balances shown as «له» / «عليه» (signDisplay: never)', () => {
    expect(formatMoney(-500000, 'SYP', { signDisplay: 'never' })).toBe(iso('5,000', 'ل.س'));
    expect(formatMoney(500000, 'SYP', { signDisplay: 'never' })).toBe(iso('5,000', 'ل.س'));
    expect(formatMoney(-500000, 'SYP', { signDisplay: 'auto' })).toBe(iso('−5,000', 'ل.س'));
  });

  it('writes plain text for export, ESC/POS and pole displays: no controls, ASCII minus', () => {
    expect(formatMoney(-125000, 'SYP', { plain: true })).toBe('-1,250 ل.س');
    expect(formatMoney(-1250, 'USD', { plain: true, symbol: false })).toBe('-12.50');
    expect(formatMoney(-125000, 'SYP', { plain: true, digits: 'arab' })).toBe('-١٬٢٥٠ ل.س');
    expect(formatMoney(1250, 'USD', { plain: true })).toBe('12.50 $');
  });

  it('trims a zero fraction only', () => {
    expect(formatMoney(125000, 'SYP', { decimals: 2, trimZeros: true })).toBe(iso('1,250', 'ل.س'));
    expect(formatMoney(125050, 'SYP', { decimals: 2, trimZeros: true })).toBe(iso('1,250.50', 'ل.س'));
  });

  it('formats with Arabic-Indic digits and separators', () => {
    expect(formatMoney(123456789, 'SYP', { digits: 'arab', decimals: 2 })).toBe(iso('١٬٢٣٤٬٥٦٧٫٨٩', 'ل.س'));
    expect(formatMoney(1250, 'USD', { digits: 'arab' })).toBe(iso('١٢٫٥٠', '$'));
    expect(formatMoney(125000, 'SYP', { digits: 'arab', symbol: false })).toBe(iso('١٬٢٥٠'));
    expect(formatMoney(-5, 'USD', { digits: 'arab' })).toBe(iso('−٠٫٠٥', '$'));
  });

  it('round-trips through toMinor in both digit sets at the stored decimals (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc.constantFrom<CurrencyId>('SYP', 'USD', 'SYP_OLD'),
        fc.constantFrom('latn' as const, 'arab' as const),
        fc.boolean(),
        (minor, currency, digits, plain) => {
          const text = formatMoney(minor, currency, { digits, plain, symbol: false, decimals: 2 });
          expect(toMinor(text, currency)).toBe(minor);
        },
      ),
    );
  });

  it('isolated and plain forms carry the same characters (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.boolean(), (minor, arab) => {
        const digits = arab ? 'arab' : 'latn';
        const isolated = formatMoney(minor, 'SYP', { digits });
        expect(toLatinDigits(stripBidiControls(isolated))).toBe(
          toLatinDigits(formatMoney(minor, 'SYP', { digits, plain: true })),
        );
      }),
    );
  });

  it('rejects non-integer amounts, bad display decimals and unknown options', () => {
    expect(() => formatMoney(12.5, 'USD')).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, 'USD')).toThrow(RangeError);
    expect(() => formatMoney(1, 'USD', { decimals: -1 })).toThrow(RangeError);
    expect(() => formatMoney(1, 'USD', { decimals: 1.5 })).toThrow(RangeError);
    expect(() => formatMoney(1, 'USD', { decimals: 7 })).toThrow(RangeError);
    expect(() => formatMoney(1, 'USD', { signDisplay: 'always' as 'auto' })).toThrow(RangeError);
    expect(() => formatMoney(1, 'EUR' as CurrencyId)).toThrow(RangeError);
  });
});

describe('parseRate', () => {
  it('scales direct rates by 1e6 exactly', () => {
    expect(parseRate('13000')).toBe(13_000_000_000n);
    expect(parseRate('130')).toBe(130_000_000n);
    expect(parseRate('3.75')).toBe(3_750_000n);
    expect(parseRate('1')).toBe(1_000_000n);
    expect(parseRate('130.1234560')).toBe(130_123_456n); // trailing zeros are fine
    expect(parseRate('١٣٬٠٠٠')).toBe(13_000_000_000n);
  });

  it('rejects inverted rates (below 1)', () => {
    // 1 / 13000 rounded to six places is 0.000077: 0.1% off, so it may never be entered.
    for (const inverted of ['0.000077', '0.007692', '0.999999']) {
      expect(() => parseRate(inverted), inverted).toThrow(/inverted/);
    }
  });

  it('rejects zero, negative, too precise and malformed rates', () => {
    for (const bad of ['0', '0.000000', '-1', '-13000', '1.2345678', 'abc', '']) {
      expect(() => parseRate(bad), bad).toThrow(RangeError);
    }
  });
});

describe('convert', () => {
  const usdSyp = (rate: string): ExchangeRate => ({ unit: 'USD', quote: 'SYP', rate });

  it('multiplies from the unit currency to the quote currency', () => {
    expect(convert(1250, 'USD', 'SYP', usdSyp('130'))).toBe(162_500); // 12.50 $ → 1,625.00 ل.س
    expect(convert(1250, 'USD', 'SYP', usdSyp('13000'))).toBe(16_250_000);
    expect(convert(1, 'USD', 'SYP', usdSyp('13000'))).toBe(13_000);
    expect(convert(1250, 'USD', 'SYP', usdSyp('13000.5'))).toBe(16_250_625);
  });

  it('divides by the same direct rate in the reverse direction (spec 10: 12.50 $, not 12.51)', () => {
    expect(convert(16_250_000, 'SYP', 'USD', usdSyp('13000'))).toBe(1250); // 162,500.00 ل.س → 12.50 $
    // 13,000,000.00 new pounds at 130 = 100,000.00 $ (the inverse 0.007692 gave 99,996.00).
    expect(convert(1_300_000_000, 'SYP', 'USD', usdSyp('130'))).toBe(10_000_000);
    expect(convert(6500, 'SYP', 'USD', usdSyp('13000'))).toBe(1); // 0.5 cent → 1
    expect(convert(6499, 'SYP', 'USD', usdSyp('13000'))).toBe(0);
    expect(convert(-6500, 'SYP', 'USD', usdSyp('13000'))).toBe(-1);
  });

  it('converts old pounds to dollars exactly (1,300,000.00 old → 100.00 $)', () => {
    const usdOld: ExchangeRate = { unit: 'USD', quote: 'SYP_OLD', rate: '13000' };
    expect(convert(130_000_000, 'SYP_OLD', 'USD', usdOld)).toBe(10_000);
    // 1,300,000,000 old pounds of stock read 100,000.00 $ through the dollar lens, not 100,100.00 $.
    expect(convert(130_000_000_000, 'SYP_OLD', 'USD', usdOld)).toBe(10_000_000);
    expect(convert(10_000, 'USD', 'SYP_OLD', usdOld)).toBe(130_000_000);
  });

  it('converts old ↔ new pounds at the fixed 100 : 1 without a rate', () => {
    expect(fixedRate('SYP_OLD', 'SYP')).toEqual({ unit: 'SYP', quote: 'SYP_OLD', rate: '100' });
    expect(fixedRate('SYP', 'SYP_OLD')).toEqual({ unit: 'SYP', quote: 'SYP_OLD', rate: '100' });
    expect(fixedRate('USD', 'SYP')).toBeUndefined();
    expect(convert(125_000_000, 'SYP_OLD', 'SYP')).toBe(1_250_000); // 1,250,000 old → 12,500 new
    expect(convert(1_250_000, 'SYP', 'SYP_OLD')).toBe(125_000_000);
    expect(convert(123_456, 'SYP_OLD', 'SYP')).toBe(1235); // 1,234.56 old → 12.3456 → 12.35 new
    expect(convert(500, 'SYP_OLD', 'SYP', { unit: 'SYP', quote: 'SYP_OLD', rate: '100.000' })).toBe(5);
  });

  it('converts to the weaker currency and back without losing a cent (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e11, max: 1e11 }),
        fc.integer({ min: 1_000_000, max: 50_000_000_000 }), // 1.000000 … 50,000.000000
        (minor, scaledRate) => {
          const rate = usdSyp((scaledRate / 1e6).toFixed(6));
          const pounds = convert(minor, 'USD', 'SYP', rate);
          expect(convert(pounds, 'SYP', 'USD', rate)).toBe(minor);
        },
      ),
    );
  });

  it('returns the amount unchanged for the same currency', () => {
    expect(convert(1234, 'USD', 'USD')).toBe(1234);
    expect(convert(1234, 'SYP', 'SYP', usdSyp('not a rate'))).toBe(1234);
  });

  it('rejects inverted, missing, mismatched and bad rates, and overflow', () => {
    expect(() => convert(100, 'SYP', 'USD', { unit: 'SYP', quote: 'USD', rate: '0.000077' })).toThrow(
      /inverted/,
    );
    expect(() => convert(100, 'USD', 'SYP')).toThrow(/needed/);
    expect(() => convert(100, 'USD', 'SYP_OLD', usdSyp('130'))).toThrow(/cannot convert/);
    expect(() => convert(100, 'SYP_OLD', 'SYP', { unit: 'SYP', quote: 'SYP_OLD', rate: '99' })).toThrow(
      /fixed/,
    );
    expect(() => convert(100, 'SYP_OLD', 'SYP', { unit: 'SYP_OLD', quote: 'SYP', rate: '100' })).toThrow(
      /fixed/,
    );
    expect(() => convert(100, 'USD', 'SYP', usdSyp('0'))).toThrow(RangeError);
    expect(() => convert(100, 'USD', 'SYP', usdSyp('-13000'))).toThrow(RangeError);
    expect(() => convert(Number.MAX_SAFE_INTEGER, 'USD', 'SYP', usdSyp('13000'))).toThrow(RangeError);
    expect(() => convert(1.5, 'USD', 'SYP', usdSyp('13000'))).toThrow(RangeError);
    expect(() => convert(100, 'EUR' as CurrencyId, 'SYP', usdSyp('130'))).toThrow(/unknown currency/);
  });
});

describe('refunds mirror sales (negative amounts)', () => {
  it('every rounding helper is symmetric around zero (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1_000_000, max: 20_000_000_000 }),
        (amount, qty, bp, step, scaledRate) => {
          expect(lineGross(-amount, qty) + lineGross(amount, qty)).toBe(0);
          expect(applyBasisPoints(-amount, bp) + applyBasisPoints(amount, bp)).toBe(0);
          expect(roundToStep(-amount, step) + roundToStep(amount, step)).toBe(0);
          const rate: ExchangeRate = { unit: 'USD', quote: 'SYP', rate: (scaledRate / 1e6).toFixed(6) };
          expect(convert(-amount, 'SYP', 'USD', rate) + convert(amount, 'SYP', 'USD', rate)).toBe(0);
          expect(convert(-amount, 'USD', 'SYP', rate) + convert(amount, 'USD', 'SYP', rate)).toBe(0);
          expect(roundDiv(BigInt(-amount), BigInt(qty))).toBe(-roundDiv(BigInt(amount), BigInt(qty)));
        },
      ),
    );
  });
});
