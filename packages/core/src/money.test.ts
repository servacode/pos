import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBasisPoints,
  convert,
  formatMoney,
  lineGross,
  parseDecimal,
  parseRate,
  roundDiv,
  roundToStep,
  sumMinor,
  toMinor,
} from './money';
import type { CurrencyCode } from './currencies';
import { seededRandom } from './test-random';

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

  it('breaks remainder ties by larger weight, then lower index', () => {
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(1, [3, 3, 6])).toEqual([0, 0, 1]); // largest remainder
    // Exact shares 0.5 / 1.5: equal remainders, so the larger weight gets the leftover unit.
    expect(allocate(2, [1, 3])).toEqual([0, 2]);
    expect(allocate(2, [3, 1])).toEqual([2, 0]);
    // Exact shares 0.5 / 1 / 1 / 0.5: equal remainders and weights, so the lower index wins.
    expect(allocate(3, [2, 4, 4, 2])).toEqual([1, 1, 1, 0]);
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
  });

  it('always sums exactly and stays within one unit of the exact share (seeded property test)', () => {
    const rand = seededRandom(20261029);
    for (let run = 0; run < 2000; run++) {
      const total = rand.int(-1_000_000, 1_000_000);
      const weights = Array.from({ length: rand.int(1, 12) }, () =>
        rand.next() < 0.2 ? 0 : rand.int(0, rand.next() < 0.5 ? 100 : 10_000_000),
      );
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
    }
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
    expect(parseDecimal('‏١٢٫٥٠‏', 2)).toBe(1250n); // RTL marks from copied text
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
    expect(() => toMinor('1', 'EUR' as CurrencyCode)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  it('formats with Latin digits and the symbol after a space', () => {
    expect(formatMoney(125000, 'SYP')).toBe('1,250.00 ل.س');
    expect(formatMoney(1250, 'USD')).toBe('12.50 $');
    expect(formatMoney(5, 'USD')).toBe('0.05 $');
    expect(formatMoney(0, 'USD')).toBe('0.00 $');
    expect(formatMoney(123456789, 'SYP', { symbol: false })).toBe('1,234,567.89');
    expect(formatMoney(100000, 'SYP', { symbol: false })).toBe('1,000.00');
  });

  it('formats negative values with a leading minus', () => {
    expect(formatMoney(-1250, 'USD')).toBe('-12.50 $');
    expect(formatMoney(-125000, 'SYP', { trimZeros: true })).toBe('-1,250 ل.س');
  });

  it('trims a zero fraction only', () => {
    expect(formatMoney(125000, 'SYP', { trimZeros: true })).toBe('1,250 ل.س');
    expect(formatMoney(125050, 'SYP', { trimZeros: true })).toBe('1,250.50 ل.س');
  });

  it('formats with Arabic-Indic digits and separators', () => {
    expect(formatMoney(123456789, 'SYP', { digits: 'arab' })).toBe('١٬٢٣٤٬٥٦٧٫٨٩ ل.س');
    expect(formatMoney(1250, 'USD', { digits: 'arab' })).toBe('١٢٫٥٠ $');
    expect(formatMoney(125000, 'SYP', { digits: 'arab', trimZeros: true, symbol: false })).toBe('١٬٢٥٠');
    expect(formatMoney(-5, 'USD', { digits: 'arab' })).toBe('-٠٫٠٥ $');
  });

  it('round-trips through toMinor in both digit sets', () => {
    const rand = seededRandom(7);
    for (let run = 0; run < 500; run++) {
      const minor = rand.int(-1e12, 1e12);
      for (const digits of ['latn', 'arab'] as const) {
        expect(toMinor(formatMoney(minor, 'SYP', { digits, symbol: false }), 'SYP')).toBe(minor);
      }
    }
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatMoney(12.5, 'USD')).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, 'USD')).toThrow(RangeError);
  });
});

describe('parseRate', () => {
  it('scales rates by 1e6 exactly', () => {
    expect(parseRate('13000')).toBe(13_000_000_000n);
    expect(parseRate('3.75')).toBe(3_750_000n);
    expect(parseRate('0.000077')).toBe(77n);
    expect(parseRate('0.0000770')).toBe(77n); // trailing zeros are fine
    expect(parseRate('١٣٬٠٠٠')).toBe(13_000_000_000n);
  });

  it('rejects zero, negative, too precise and malformed rates', () => {
    for (const bad of ['0', '0.000000', '-1', '0.0000001', '1.2345678', 'abc', '']) {
      expect(() => parseRate(bad), bad).toThrow(RangeError);
    }
  });
});

describe('convert', () => {
  it('converts USD → SYP', () => {
    expect(convert(1250, 'USD', 'SYP', '13000')).toBe(16_250_000); // 12.50 $ → 162,500.00 ل.س
    expect(convert(1, 'USD', 'SYP', '13000')).toBe(13_000);
    expect(convert(1250, 'USD', 'SYP', '13000.5')).toBe(16_250_625);
  });

  it('converts SYP → USD with a small rate, rounding half away from zero', () => {
    expect(convert(16_250_000, 'SYP', 'USD', '0.000077')).toBe(1251); // 12.5125 → 12.51
    expect(convert(5000, 'SYP', 'USD', '0.0001')).toBe(1); // 0.5 cent → 1
    expect(convert(4999, 'SYP', 'USD', '0.0001')).toBe(0);
    expect(convert(-5000, 'SYP', 'USD', '0.0001')).toBe(-1);
  });

  it('returns the amount unchanged for the same currency', () => {
    expect(convert(1234, 'USD', 'USD', 'not a rate')).toBe(1234);
  });

  it('rejects bad rates and overflow', () => {
    expect(() => convert(100, 'USD', 'SYP', '0')).toThrow(RangeError);
    expect(() => convert(100, 'USD', 'SYP', '-13000')).toThrow(RangeError);
    expect(() => convert(100, 'SYP', 'USD', '0.0000001')).toThrow(RangeError);
    expect(() => convert(Number.MAX_SAFE_INTEGER, 'USD', 'SYP', '13000')).toThrow(RangeError);
    expect(() => convert(1.5, 'USD', 'SYP', '13000')).toThrow(RangeError);
  });
});

describe('refunds mirror sales (negative amounts)', () => {
  it('every rounding helper is symmetric around zero (seeded property test)', () => {
    const rand = seededRandom(42);
    for (let run = 0; run < 2000; run++) {
      const amount = rand.int(1, 50_000_000);
      const qty = rand.int(1, 100_000);
      const bp = rand.int(0, 10_000);
      const step = rand.int(1, 5000);
      expect(lineGross(-amount, qty) + lineGross(amount, qty)).toBe(0);
      expect(applyBasisPoints(-amount, bp) + applyBasisPoints(amount, bp)).toBe(0);
      expect(roundToStep(-amount, step) + roundToStep(amount, step)).toBe(0);
      expect(convert(-amount, 'SYP', 'USD', '0.000077') + convert(amount, 'SYP', 'USD', '0.000077')).toBe(0);
      expect(convert(-amount, 'USD', 'SYP', '13000') + convert(amount, 'USD', 'SYP', '13000')).toBe(0);
      expect(roundDiv(BigInt(-amount), BigInt(qty))).toBe(-roundDiv(BigInt(amount), BigInt(qty)));
    }
  });
});
