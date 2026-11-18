import { describe, expect, it } from 'vitest';
import { promotionInput } from './promotions';

const base = { name: 'عرض', scope: 'all' as const };
const uuid = '0192a000-0000-7000-8000-00000000d001';

describe('promotionInput', () => {
  it('still reads the two kinds that existed, with the new fields at their defaults', () => {
    const p = promotionInput.parse({ ...base, kind: 'percent', percentBp: 1000 });
    expect(p).toMatchObject({
      tiers: [],
      freeVariantId: null,
      customerKinds: [],
      priceTiers: [],
      repOnly: false,
    });
    expect(promotionInput.safeParse({ ...base, kind: 'percent' }).success).toBe(false);
    expect(promotionInput.safeParse({ ...base, kind: 'buy_get', buyQty: 2, getQty: 1 }).success).toBe(true);
    expect(promotionInput.safeParse({ ...base, kind: 'buy_get', buyQty: 2 }).success).toBe(false);
  });

  it('tiered needs steps with different quantities', () => {
    expect(promotionInput.safeParse({ ...base, kind: 'tiered' }).success).toBe(false);
    const steps = [
      { minQty: 10, percentBp: 500 },
      { minQty: 50, percentBp: 800 },
    ];
    expect(promotionInput.safeParse({ ...base, kind: 'tiered', tiers: steps }).success).toBe(true);
    expect(promotionInput.safeParse({ ...base, kind: 'tiered', tiers: [steps[0], steps[0]] }).success).toBe(
      false,
    );
    expect(
      promotionInput.safeParse({ ...base, kind: 'tiered', tiers: [{ minQty: 10, percentBp: 0 }] }).success,
    ).toBe(false);
  });

  it('free_item needs what to buy, what comes free and how many', () => {
    const ok = { ...base, kind: 'free_item', buyQty: 10, freeQty: 2, freeVariantId: uuid };
    expect(promotionInput.safeParse(ok).success).toBe(true);
    expect(promotionInput.safeParse({ ...ok, freeVariantId: null }).success).toBe(false);
    expect(promotionInput.safeParse({ ...ok, freeQty: null }).success).toBe(false);
    expect(promotionInput.safeParse({ ...ok, buyQty: null }).success).toBe(false);
  });

  it('takes who it is for, and a coupon only on the old kinds', () => {
    const t = promotionInput.parse({
      ...base,
      kind: 'percent',
      percentBp: 500,
      customerKinds: ['grocery'],
      priceTiers: ['wholesale'],
      repOnly: true,
    });
    expect(t).toMatchObject({ customerKinds: ['grocery'], priceTiers: ['wholesale'], repOnly: true });
    expect(
      promotionInput.safeParse({ ...base, kind: 'percent', percentBp: 5, customerKinds: ['bank'] }).success,
    ).toBe(false);
    const tiers = [{ minQty: 10, percentBp: 500 }];
    expect(promotionInput.safeParse({ ...base, kind: 'tiered', tiers, couponCode: 'ABC' }).success).toBe(
      false,
    );
  });
});
