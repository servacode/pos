import { formatMoney, type CurrencyId, type FormatMoneyOptions } from '@serva/core';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { useDigits } from './context';

export interface MoneyProps
  extends
    Omit<ComponentProps<'bdi'>, 'children'>,
    Pick<FormatMoneyOptions, 'decimals' | 'trimZeros' | 'signDisplay' | 'symbol'> {
  /** The amount in integer minor units. */
  minor: number;
  currency: CurrencyId;
  /** Reports: a negative amount in the danger colour, with «−» (tab 14 › الأرصدة دون إشارة سالب). */
  negativeTone?: boolean;
}

/**
 * The one way an amount reaches the screen (tab 14 › مكوّن واحد للأرقام): formatted by
 * @serva/core formatMoney («1,250 ل.س», «12.50 $», «−3,000 ل.س»), in the store's digits, with
 * equal-width digits, inside a direction isolate so no Arabic sentence can reorder it.
 */
export function Money({
  minor,
  currency,
  decimals,
  trimZeros,
  signDisplay,
  symbol,
  negativeTone = false,
  className,
  ...rest
}: MoneyProps) {
  const digits = useDigits();
  const text = formatMoney(minor, currency, { digits, decimals, trimZeros, signDisplay, symbol });
  return (
    <bdi
      className={cn('num whitespace-nowrap', negativeTone && minor < 0 && 'text-danger-ink', className)}
      {...rest}
    >
      {text}
    </bdi>
  );
}
