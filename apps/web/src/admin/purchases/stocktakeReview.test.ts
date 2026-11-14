import { describe, expect, it } from 'vitest';
import type { InventoryRow } from '@serva/core';
import { countProblem, differenceWord, reviewCount } from './stocktakeReview';

const row = (variantId: string, qty: number, unitCostMinor: number | null): InventoryRow => ({
  variantId,
  name: variantId,
  branchId: 'b',
  qty,
  valueMinor: 0,
  unitCostMinor,
});

describe('countProblem', () => {
  it('lets an empty box and a number pass, refuses a negative and garbage', () => {
    expect(countProblem('')).toBeNull();
    expect(countProblem('12.5')).toBeNull();
    expect(countProblem('-1')).toContain('سالباً');
    expect(countProblem('abc')).toContain('رقماً');
  });
});

describe('reviewCount', () => {
  it('lists the counted items with the difference in pieces and value, a gain positive', () => {
    const items = [row('a', 10_000, 5000), row('b', 4000, 1000), row('c', 1000, null), row('a', 2000, 5000)];
    const lines = reviewCount(items, { a: '12', b: '3', c: '1' });
    expect(lines.map((l) => [l.variantId, l.diffQty, l.diffValueMinor])).toEqual([
      ['a', 2000, 10_000],
      ['b', -1000, -1000],
      ['c', 0, 0],
    ]);
    expect(reviewCount(items, {})).toEqual([]);
  });
  it('names a difference', () => {
    expect([differenceWord(5), differenceWord(-5), differenceWord(0)]).toEqual(['زيادة', 'نقص', 'مطابق']);
  });
});
