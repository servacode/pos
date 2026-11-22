import { describe, expect, it } from 'vitest';
import {
  commissionOf,
  distributionReportQuery,
  repSettlementCreateInput,
  repTargetListQuery,
  repVanCountInput,
  settlementCancelInput,
} from './distribution-ops';

const id = '0190b1c0-1111-7000-8000-000000000001';

describe('commissionOf', () => {
  it('pays a flat rate on the net of returns', () => {
    const plan = { mode: 'flat', rateBp: 250, tiers: null, returnsEffect: 'deduct' } as const;
    expect(commissionOf(plan, 1_000_000, 200_000)).toEqual({
      netMinor: 800_000,
      rateBp: 250,
      commissionMinor: 20_000,
    });
  });

  it('leaves returns out when the plan ignores them', () => {
    const plan = { mode: 'flat', rateBp: 100, tiers: null, returnsEffect: 'ignore' } as const;
    expect(commissionOf(plan, 500_000, 400_000).commissionMinor).toBe(5_000);
  });

  it('never goes below nothing when returns exceed the base', () => {
    const plan = { mode: 'flat', rateBp: 100, tiers: null, returnsEffect: 'deduct' } as const;
    expect(commissionOf(plan, 100, 900)).toEqual({ netMinor: 0, rateBp: 100, commissionMinor: 0 });
  });

  it('takes the rate of the highest tier reached, on the whole amount', () => {
    const plan: Parameters<typeof commissionOf>[0] = {
      mode: 'tiered',
      rateBp: null,
      tiers: [
        { fromMinor: 0, rateBp: 100 },
        { fromMinor: 1_000_000, rateBp: 200 },
        { fromMinor: 5_000_000, rateBp: 300 },
      ],
      returnsEffect: 'deduct',
    };
    expect(commissionOf(plan, 900_000, 0).rateBp).toBe(100);
    expect(commissionOf(plan, 1_000_000, 0)).toMatchObject({ rateBp: 200, commissionMinor: 20_000 });
    expect(commissionOf(plan, 6_000_000, 0).rateBp).toBe(300);
    expect(commissionOf(plan, 0, 0).commissionMinor).toBe(0);
  });

  it('pays nothing under a flat plan with no rate and a tiered one with no tiers', () => {
    expect(
      commissionOf({ mode: 'flat', rateBp: null, tiers: null, returnsEffect: 'deduct' }, 100, 0),
    ).toMatchObject({
      rateBp: 0,
    });
    expect(
      commissionOf({ mode: 'tiered', rateBp: null, tiers: null, returnsEffect: 'deduct' }, 100, 0),
    ).toMatchObject({
      rateBp: 0,
    });
  });
});

describe('the inputs', () => {
  it('reads a van count and refuses a negative one', () => {
    expect(
      repVanCountInput.safeParse({ businessDate: '2026-11-18', lines: [{ variantId: id, counted: 5000 }] })
        .success,
    ).toBe(true);
    expect(
      repVanCountInput.safeParse({ businessDate: '2026-11-18', lines: [{ variantId: id, counted: -1 }] })
        .success,
    ).toBe(false);
  });

  it('reads a settlement with counted money and an empty note as none', () => {
    const parsed = repSettlementCreateInput.parse({
      repId: id,
      businessDate: '2026-11-18',
      countedCash: { SYP: 100 },
      note: '  ',
    });
    expect(parsed.note).toBeNull();
    expect(
      repSettlementCreateInput.safeParse({ repId: id, businessDate: '2026-11-18', countedCash: { SYP: -1 } })
        .success,
    ).toBe(false);
  });

  it('asks a reason to cancel, a month as year-month, and a period for a report', () => {
    expect(settlementCancelInput.safeParse({ version: 1, reason: 'x' }).success).toBe(false);
    expect(repTargetListQuery.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(repTargetListQuery.safeParse({ month: '2026-11' }).success).toBe(true);
    expect(distributionReportQuery.safeParse({ from: '2026-11-01' }).success).toBe(false);
  });
});
