import { describe, expect, it } from 'vitest';
import type { InventoryRow } from '@serva/core';
import { averageCosts, looksLikeDateOrPhone, purchaseWarnings } from './purchaseSanity';

const row = (variantId: string, qty: number, valueMinor: number): InventoryRow =>
  ({ variantId, qty, valueMinor, branchId: 'b', unitCostMinor: null }) as unknown as InventoryRow;

describe('purchase sanity warnings', () => {
  it('averages the cost of a piece over the branches that hold it', () => {
    const avg = averageCosts([row('v', 10_000, 1_000_000), row('v', 10_000, 3_000_000), row('z', 0, 0)]);
    expect(avg.get('v')).toBe(200_000);
    expect(avg.has('z')).toBe(false);
  });

  it('knows a pasted date or phone number', () => {
    expect(looksLikeDateOrPhone(30_062_027)).toBe(true);
    expect(looksLikeDateOrPhone(20_261_116)).toBe(true);
    expect(looksLikeDateOrPhone(963_944_000_000)).toBe(true);
    expect(looksLikeDateOrPhone(944_000_000)).toBe(true);
    expect(looksLikeDateOrPhone(30_000)).toBe(false);
    expect(looksLikeDateOrPhone(1.5)).toBe(false);
  });

  it('warns about a date in the total and about a cost far above the usual', () => {
    const avg = new Map([['v', 100_000]]);
    expect(
      purchaseWarnings([{ variantId: 'v', name: 'شاش', qty: 30_000, costMinor: 3_006_202_700 }], avg),
    ).toHaveLength(1);
    expect(
      purchaseWarnings([{ variantId: 'v', name: 'شاش', qty: 1000, costMinor: 600_000 }], avg),
    ).toHaveLength(1);
    expect(purchaseWarnings([{ variantId: 'v', name: 'شاش', qty: 1000, costMinor: 400_000 }], avg)).toEqual(
      [],
    );
    expect(purchaseWarnings([{ variantId: 'x', name: 'جديد', qty: 1000, costMinor: 9_000 }], avg)).toEqual(
      [],
    );
    expect(purchaseWarnings([{ variantId: 'v', name: 'شاش', qty: null, costMinor: null }], avg)).toEqual([]);
  });
});
