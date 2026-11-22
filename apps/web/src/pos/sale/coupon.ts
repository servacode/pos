import type { OrderCouponRule } from '@serva/core/contracts/shop';
import type { PromotionRow } from '@serva/core/contracts/promotions';
import { promotionActive, type PromotionRule } from '@serva/core/promotions';
import { couponPromotion, type Cart } from './cart';

/** What the till keeps of an offer a code opened: the shape a shop order's code already has (shop.ts › OrderCouponRule) */
export function couponRuleOf(row: PromotionRow): OrderCouponRule {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'buy_get' ? 'buy_get' : 'percent',
    percentBp: row.percentBp,
    buyQty: row.buyQty,
    getQty: row.getQty,
    scope: row.scope,
    categoryIds: row.categoryIds,
    productIds: row.productIds,
    couponCode: row.couponCode ?? '',
  };
}

/**
 * The offer the cart's code opened, as a promotion running for this sale: from the pulled row, only while it is still
 * running (a cart held past the end of the offer loses it), through the same couponPromotion the shop orders use.
 */
export function cartCouponRule(
  cart: Cart,
  coupons: readonly PromotionRow[],
  now: Date,
  timeZone: string,
): PromotionRule | null {
  if (!cart.coupon) return null;
  const row = coupons.find((p) => p.id === cart.coupon!.promotionId);
  if (!row || !promotionActive({ ...row, archived: false }, now, timeZone)) return null;
  return couponPromotion(couponRuleOf(row));
}
