import { useState } from 'react';
import type { PromotionRow } from '@serva/core/contracts/promotions';
import { promotionActive, promotionCovers, type PromotionRule } from '@serva/core/promotions';
import { AlertCircleIcon, Button, TextField } from '@serva/ui';
import { couponPromotion, unitPriceOf, type Cart, type PricingContext } from './cart';
import { couponRuleOf } from './coupon';

/** The kinds of offer a code may open: the same as the online shop's (the server checks them too) */
const COUPON_KINDS: readonly PromotionRule['kind'][] = ['percent', 'buy_get'];

export const COUPON_TEXT = {
  empty: 'اكتب الكود أولاً.',
  unknown: 'هذا الكود غير صحيح. تأكد من كتابته.',
  notStarted: 'هذا الكود لم يبدأ بعد.',
  ended: 'انتهت مدة هذا الكود.',
  notNow: 'هذا الكود لا يعمل الآن (أيام أو ساعات العرض).',
  notApplicable: 'هذا الكود لا ينطبق على أصناف هذه الفاتورة.',
} as const;

export type CouponResult = { ok: true; coupon: NonNullable<Cart['coupon']> } | { ok: false; error: string };

/**
 * A code the cashier typed, looked up in the promotions the till pulled (offline too): unknown, not started, ended,
 * outside its days or hours, or not for any item of this cart each say so. The code is not case sensitive, as on the shop.
 */
export function resolveCoupon(
  typed: string,
  coupons: readonly PromotionRow[],
  cart: Cart,
  ctx: PricingContext,
  now: Date,
  timeZone: string,
): CouponResult {
  const code = typed.trim().toLowerCase();
  if (!code) return { ok: false, error: COUPON_TEXT.empty };
  const row = coupons.find((p) => p.couponCode?.toLowerCase() === code);
  if (!row) return { ok: false, error: COUPON_TEXT.unknown };
  if (row.startsAt && now.getTime() < Date.parse(row.startsAt))
    return { ok: false, error: COUPON_TEXT.notStarted };
  if (row.endsAt && now.getTime() >= Date.parse(row.endsAt)) return { ok: false, error: COUPON_TEXT.ended };
  if (!promotionActive({ ...row, archived: false }, now, timeZone))
    return { ok: false, error: COUPON_TEXT.notNow };
  const rule = couponPromotion(couponRuleOf(row));
  const reaches =
    COUPON_KINDS.includes(row.kind) &&
    cart.lines.some((line) =>
      promotionCovers(rule, {
        lineNo: line.lineNo,
        productId: line.productId,
        categoryPath: line.categoryPath ?? [],
        qty: line.qty,
        unitPriceMinor: unitPriceOf(line, ctx),
        weighed: line.weighed,
      }),
    );
  if (!reaches) return { ok: false, error: COUPON_TEXT.notApplicable };
  return { ok: true, coupon: { code: row.couponCode ?? typed.trim(), promotionId: row.id, name: row.name } };
}

/**
 * «كود الخصم» (round A5) in the invoice-discount panel: the code typed, resolved from the promotions the till pulled.
 * Its own chunk, as it is rarely opened (the cashier's size budget).
 */
export default function CouponForm({
  coupons,
  cart,
  ctx,
  timeZone,
  onApplied,
  onRemove,
}: {
  coupons: readonly PromotionRow[];
  cart: Cart;
  ctx: PricingContext;
  timeZone: string;
  onApplied: (coupon: NonNullable<Cart['coupon']>) => void;
  onRemove: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const found = resolveCoupon(code, coupons, cart, ctx, new Date(), timeZone);
        if (found.ok) {
          setCode('');
          onApplied(found.coupon);
        } else setError(found.error);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <TextField
            label="كود الخصم"
            dir="ltr"
            autoComplete="off"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.slice(0, 40));
              setError(null);
            }}
          />
        </div>
        <Button type="submit" variant="secondary" size="lg" disabled={code.trim() === ''}>
          طبّق الكود
        </Button>
        {cart.coupon ? (
          <Button variant="danger-soft" size="lg" onClick={onRemove}>
            أزل الكود
          </Button>
        ) : null}
      </div>
      {cart.coupon ? (
        <p className="text-sm font-semibold text-success-ink">
          الكود المطبّق: <bdi dir="ltr">{cart.coupon.code}</bdi>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-danger-ink">
          <AlertCircleIcon size={20} className="shrink-0" />
          {error}
        </p>
      ) : null}
    </form>
  );
}
