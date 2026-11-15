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
  it('values a count of stock below zero like the save does: at the last known average', () => {
    // 20 below zero, last average 40 per piece; counting 0 brings it back to nothing: a surplus with a value
    const below: InventoryRow = {
      ...row('x', -20_000, null),
      valueMinor: -800_000,
      refQty: 100_000,
      refValueMinor: 4_000_000,
    };
    const [line] = reviewCount([below], { x: '0' });
    expect(line!.diffQty).toBe(20_000);
    expect(line!.diffValueMinor).toBe(800_000);
    // Counting less than what the shelf holds is a loss at the running average
    const held: InventoryRow = {
      ...row('y', 10_000, 5000),
      valueMinor: 50_000,
      refQty: 10_000,
      refValueMinor: 50_000,
    };
    expect(reviewCount([held], { y: '4' })[0]!.diffValueMinor).toBe(-30_000);
  });
  it('names a difference', () => {
    expect([differenceWord(5), differenceWord(-5), differenceWord(0)]).toEqual(['زيادة', 'نقص', 'مطابق']);
  });
});
