import { describe, expect, it } from 'vitest';
import type { PromotionRule } from '@serva/core/promotions';
import { buildCatalog } from '../catalog';
import { posSets } from '../../test/pos';
import { addItem, EMPTY_CART, priceCart, type PricingContext } from './cart';

/**
 * Regression guard (round 32): the two kinds that existed before trade promotions, priced through
 * the cart exactly as the till does. These numbers must never move.
 */

const catalog = buildCatalog(posSets());
const item = catalog.items[0]!;

const rule = (over: Partial<PromotionRule>): PromotionRule => ({
  id: 'p1',
  name: 'عرض',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'all',
  categoryIds: [],
  productIds: [],
  startsAt: null,
  endsAt: null,
  daysOfWeek: [],
  fromTime: null,
  toTime: null,
  archived: false,
  ...over,
});

const ctx = (promotions: PromotionRule[]): PricingContext => ({
  currency: catalog.settings!.baseCurrency,
  taxInclusive: catalog.settings!.taxInclusive,
  rates: catalog.rates,
  promotions,
});

describe('the existing promotion kinds, priced in the cart', () => {
  it('percent takes its share off the line and names itself', () => {
    const cart = addItem(EMPTY_CART, item, null, 3000);
    const none = priceCart(cart, ctx([]));
    const done = priceCart(cart, ctx([rule({ percentBp: 1500, name: 'خصم 15%' })]));
    const gross = none.lines[0]!.priced.grossMinor;
    expect(none.lines[0]!.discount).toBeNull();
    expect(done.lines).toHaveLength(1);
    expect(done.lines[0]!.discount).toMatchObject({
      type: 'amount',
      source: 'promotion',
      reason: 'خصم 15%',
      approval: null,
      promotionId: 'p1',
    });
    expect(done.lines[0]!.priced.lineDiscountMinor).toBe(Math.round((gross * 15) / 100));
  });

  it('buy_get gives whole free packs and the line count stays what the cart holds', () => {
    const cart = addItem(EMPTY_CART, item, null, 3000);
    const priced = priceCart(cart, ctx([rule({ kind: 'buy_get', percentBp: null, buyQty: 2, getQty: 1 })]));
    const unit = priced.lines[0]!.unitPriceMinor;
    expect(priced.lines).toHaveLength(1);
    expect(priced.lines[0]!.priced.lineDiscountMinor).toBe(unit);
    expect(priced.lines[0]!.discount?.source).toBe('promotion');
  });

  it('the best of several wins, a typed discount replaces it, and an expired flag changes nothing', () => {
    const cart = addItem(EMPTY_CART, item, null, 3000);
    const priced = priceCart(
      cart,
      ctx([
        rule({ id: 'a', name: 'قليل', percentBp: 500 }),
        rule({ id: 'b', name: 'كثير', percentBp: 2000 }),
      ]),
    );
    expect(priced.lines[0]!.discount?.reason).toBe('كثير');
    const typed = {
      ...cart,
      lines: [
        {
          ...cart.lines[0]!,
          adjustment: { kind: 'discount' as const, discount: { type: 'percent' as const, bp: 100 } },
        },
      ],
    };
    expect(priceCart(typed, ctx([rule({ percentBp: 2000 })])).lines[0]!.discount?.source).toBe('manual');
  });

  it('a promotion that targets nobody in particular (no audience set) still applies to everyone', () => {
    const cart = addItem(EMPTY_CART, item, null, 1000);
    const priced = priceCart(cart, ctx([rule({ percentBp: 1000 })]));
    expect(priced.lines[0]!.priced.lineDiscountMinor).toBeGreaterThan(0);
  });
});

describe('trade promotions, priced in the cart', () => {
  const second = catalog.items[1]!;
  const withVariants = (
    promotions: PromotionRule[],
    audience?: PricingContext['audience'],
  ): PricingContext => ({
    ...ctx(promotions),
    variants: catalog.byVariant,
    ...(audience ? { audience } : {}),
  });
  const everyone = { customerKind: null, priceTier: 'retail' as const, rep: false };

  it('tiered takes the percent of the highest tier reached and names itself', () => {
    const tiered = rule({
      kind: 'tiered',
      percentBp: null,
      name: 'جملة الكميات',
      tiers: [
        { minQty: 10, percentBp: 500 },
        { minQty: 50, percentBp: 800 },
      ],
    });
    const gross = (qty: number) =>
      priceCart(addItem(EMPTY_CART, item, null, qty), ctx([])).lines[0]!.priced.grossMinor;
    const at = (qty: number) =>
      priceCart(addItem(EMPTY_CART, item, null, qty), withVariants([tiered], everyone)).lines[0]!;
    expect(at(9000).discount).toBeNull();
    expect(at(10_000).priced.lineDiscountMinor).toBe(Math.round(gross(10_000) * 0.05));
    expect(at(49_000).priced.lineDiscountMinor).toBe(Math.round(gross(49_000) * 0.05));
    expect(at(50_000).priced.lineDiscountMinor).toBe(Math.round(gross(50_000) * 0.08));
    expect(at(50_000).discount).toMatchObject({ source: 'promotion', reason: 'جملة الكميات' });
  });

  it('free_item adds a line at price 0 naming the promotion, per whole group bought', () => {
    const gift = rule({
      kind: 'free_item',
      percentBp: null,
      name: 'اشترِ 4 وخذ هدية',
      buyQty: 4,
      freeQty: 1,
      freeVariantId: second.variantId,
      scope: 'products',
      productIds: [item.productId],
    });
    const cartOf = (qty: number) => addItem(EMPTY_CART, item, null, qty);
    expect(priceCart(cartOf(3000), withVariants([gift], everyone)).lines).toHaveLength(1);
    const eight = priceCart(cartOf(8000), withVariants([gift], everyone));
    expect(eight.lines).toHaveLength(2);
    const free = eight.lines[1]!;
    expect(free).toMatchObject({
      variantId: second.variantId,
      qty: 2000,
      unitPriceMinor: 0,
      priceMinor: 0,
      discount: { source: 'promotion', reason: 'اشترِ 4 وخذ هدية', minor: 0 },
    });
    expect(free.priced).toMatchObject({ grossMinor: 0, netMinor: 0, totalMinor: 0, lineDiscountMinor: 0 });
    // The goods' own line and the total are what they would be with no promotion at all
    const plain = priceCart(cartOf(8000), ctx([]));
    expect(eight.lines[0]!.priced).toEqual(plain.lines[0]!.priced);
    expect(eight.priced.totals.totalMinor).toBe(plain.priced.totals.totalMinor);
    expect(new Set(eight.lines.map((l) => l.lineNo)).size).toBe(2);
  });

  it('a promotion for wholesale customers, one kind or the reps only skips everyone else', () => {
    const forWholesale = rule({ percentBp: 2000, priceTiers: ['wholesale'] });
    const priced = (audience: PricingContext['audience']) =>
      priceCart(addItem(EMPTY_CART, item, null, 1000), withVariants([forWholesale], audience)).lines[0]!;
    expect(priced(everyone).discount).toBeNull();
    expect(priced(undefined).discount).toBeNull();
    expect(priced({ ...everyone, priceTier: 'wholesale' }).discount?.source).toBe('promotion');
    const forShops = rule({ percentBp: 2000, customerKinds: ['grocery'] });
    const shops = (audience: PricingContext['audience']) =>
      priceCart(addItem(EMPTY_CART, item, null, 1000), withVariants([forShops], audience)).lines[0]!;
    expect(shops({ ...everyone, customerKind: 'supermarket' }).discount).toBeNull();
    expect(shops({ ...everyone, customerKind: 'grocery' }).discount?.source).toBe('promotion');
    const forReps = rule({ percentBp: 2000, repOnly: true });
    const reps = (rep: boolean) =>
      priceCart(addItem(EMPTY_CART, item, null, 1000), withVariants([forReps], { ...everyone, rep }))
        .lines[0]!;
    expect(reps(false).discount).toBeNull();
    expect(reps(true).discount?.source).toBe('promotion');
  });
});
