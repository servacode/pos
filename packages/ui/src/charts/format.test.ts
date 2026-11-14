import { describe, expect, it } from 'vitest';
import { compactNumber, formatNumber, formatShare } from './format';
import { niceScale } from './scale';

describe('niceScale', () => {
  it('ends one clean step over the highest value, from zero', () => {
    expect(niceScale(800_000, 2_100_000, 4, true)).toEqual({
      min: 0,
      max: 2_500_000,
      ticks: [0, 500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000],
    });
    expect(niceScale(3, 18, 4, true).ticks).toEqual([0, 5, 10, 15, 20]);
  });

  it('never steps by a fraction for whole numbers, so a money formatter never meets one', () => {
    expect(niceScale(0, 0, 4, true)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
    expect(niceScale(0, 2, 4, true).ticks).toEqual([0, 1, 2]);
    expect(niceScale(0, 2, 4, false).ticks).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('reaches below zero for negative values, with zero on the axis', () => {
    const scale = niceScale(-300, 1200, 4, true);
    expect(scale.min).toBeLessThanOrEqual(-300);
    expect(scale.max).toBeGreaterThanOrEqual(1200);
    expect(scale.ticks).toContain(0);
  });
});

describe('number formats', () => {
  it('prints plain numbers in the store digits', () => {
    expect(formatNumber(1250, 'latn')).toBe('1,250');
    expect(formatNumber(2.5, 'latn')).toBe('2.5');
    // Negative numbers keep their minus at the left, inside an Arabic line.
    expect(formatNumber(-300, 'latn')).toBe('\u2066−300\u2069');
    expect(formatNumber(1250, 'arab')).toBe('١٬٢٥٠');
  });

  it('shortens axis numbers from a thousand, in Arabic words with their plural', () => {
    // Intl keeps the number and its word together with a no-break space.
    expect(compactNumber(950, 'latn')).toBe('950');
    expect(compactNumber(5000, 'latn')).toMatch(/^5\sآلاف$/);
    expect(compactNumber(12_500, 'latn')).toMatch(/^12\.5\sألف$/);
    expect(compactNumber(1_250_000, 'latn')).toMatch(/^1\.25\sمليون$/);
    expect(compactNumber(12_500, 'arab')).toMatch(/^١٢٫٥\sألف$/);
    expect(compactNumber(-5000, 'latn')).toMatch(/^\u2066−5\u2069\sآلاف$/);
  });

  it('prints shares as whole percents, with one decimal under ten', () => {
    expect(formatShare(0.6123, 'latn')).toBe('61%');
    expect(formatShare(0.049, 'latn')).toBe('4.9%');
    expect(formatShare(0, 'latn')).toBe('0%');
    expect(formatShare(0.61, 'arab')).toBe('٦١٪');
  });
});
