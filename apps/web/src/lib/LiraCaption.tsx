import type { CurrencyCode } from '@serva/core';
import { Money } from '@serva/ui';
import { useMe } from '../auth/useAuth';
import { usdToBase, useUsdRate } from './useUsdRate';

/**
 * «≈ 5,850 ل.س» beside a dollar price, at the store's rate today. Renders nothing for a price in
 * another currency, or while the rate is unknown.
 */
export function LiraCaption({
  minor,
  currency,
  className,
}: {
  minor: number | null | undefined;
  currency: CurrencyCode;
  className?: string;
}) {
  const me = useMe();
  const rate = useUsdRate();
  if (currency !== 'USD' || minor === null || minor === undefined) return null;
  const base = me.settings.baseCurrency;
  const lira = usdToBase(minor, base, rate);
  if (lira === null) return null;
  return (
    <span className={className ?? 'text-xs text-ink-muted'}>
      ≈ <Money minor={lira} currency={base} />
    </span>
  );
}
