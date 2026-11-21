import { describe, expect, it } from 'vitest';
import type { PromotionRule } from '@serva/core/promotions';
import { buildCatalog, type CatalogItem } from '../catalog';
import { posSets } from '../../test/pos';
import { addItem, buyGetHint, EMPTY_CART, priceCart, type PricingContext } from './cart';

/** Round 34: a free piece obeys the stock rule of a normal line, and «10 + 1» tells when it is one short */

const catalog = buildCatalog(posSets());
const item = catalog.items[0]!;
const second = catalog.items[1]!;
const everyone = { customerKind: null, priceTier: 'retail' as const, rep: true };

const rule = (over: Partial<PromotionRule>): PromotionRule => ({
  id: 'p1',
  name: 'عرض',
  kind: 'free_item',
  percentBp: null,
  buyQty: 4,
  getQty: null,
  freeQty: 1,
  freeVariantId: second.variantId,
  scope: 'products',
  categoryIds: [],
  productIds: [item.productId],
  startsAt: null,
  endsAt: null,
  daysOfWeek: [],
  fromTime: null,
  toTime: null,
  archived: false,
  ...over,
});

const withStock = (stock: number | null): PricingContext => {
  const variants = new Map<string, CatalogItem>(catalog.byVariant);
  variants.set(second.variantId, { ...second, stockQty: stock });
  return {
    currency: catalog.settings!.baseCurrency,
    taxInclusive: catalog.settings!.taxInclusive,
    rates: catalog.rates,
    promotions: [rule({})],
    audience: everyone,
    variants,
  };
};

describe('a free piece and the stock of the device', () => {
  const cart = addItem(EMPTY_CART, item, null, 4000);
  it('is given when the device holds it', () => {
    expect(priceCart(cart, withStock(5000)).lines).toHaveLength(2);
  });
  it('is not given when the device holds none of it', () => {
    expect(priceCart(cart, withStock(0)).lines).toHaveLength(1);
  });
  it('is not given when the device holds less than the gift', () => {
    expect(priceCart(addItem(EMPTY_CART, item, null, 8000), withStock(1000)).lines).toHaveLength(1);
    expect(priceCart(addItem(EMPTY_CART, item, null, 8000), withStock(2000)).lines).toHaveLength(2);
  });
  it('is given when the device does not know its stock (as for a normal line)', () => {
    expect(priceCart(cart, withStock(null)).lines).toHaveLength(2);
  });
  it('counts what the paid lines of the same piece take', () => {
    const own = rule({ freeVariantId: item.variantId });
    const variants = new Map<string, CatalogItem>(catalog.byVariant);
    variants.set(item.variantId, { ...item, stockQty: 4000 });
    const ctx: PricingContext = { ...withStock(5000), promotions: [own], variants };
    // 4 paid take all 4 held: nothing left to give
    expect(priceCart(cart, ctx).lines).toHaveLength(1);
  });
});

describe('«اشترِ 10 وخذ 1 مجاناً»: one short', () => {
  const buyGet = rule({ kind: 'buy_get', buyQty: 10, getQty: 1, freeQty: null, freeVariantId: null });
  const ctx: PricingContext = { ...withStock(null), promotions: [buyGet] };
  const at = (qty: number) => addItem(EMPTY_CART, item, null, qty).lines[0]!;
  it('hints at 10 and at 21, not at 9, 11 or 20', () => {
    expect(buyGetHint(at(10_000), ctx)).toEqual({ get: 1, name: 'عرض' });
    expect(buyGetHint(at(21_000), ctx)).toEqual({ get: 1, name: 'عرض' });
    for (const qty of [9000, 11_000, 20_000]) expect(buyGetHint(at(qty), ctx)).toBeNull();
  });
  it('gives the free piece from the 11th, as the rule says', () => {
    const gross = priceCart(addItem(EMPTY_CART, item, null, 11_000), ctx).lines[0]!;
    expect(gross.priced.lineDiscountMinor).toBe(Math.round(gross.priced.grossMinor / 11));
  });
  it('says nothing when no promotion runs', () => {
    expect(buyGetHint(at(10_000), { ...ctx, promotions: [] })).toBeNull();
  });
});
