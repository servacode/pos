import { formatMoney, getCurrency, type CurrencyId, type FormatMoneyOptions } from '@serva/core';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { useDigits } from './context';

/** POP DIRECTIONAL ISOLATE (U+2069): formatMoney closes the whole amount with it. */
const PDI = String.fromCharCode(0x2069);

export interface MoneyProps
  extends
    Omit<ComponentProps<'bdi'>, 'children'>,
    Pick<FormatMoneyOptions, 'decimals' | 'trimZeros' | 'signDisplay' | 'symbol'> {
  /** The amount in integer minor units. */
  minor: number;
  currency: CurrencyId;
  /** Reports: a negative amount in the danger colour, with «−» (tab 14 › الأرصدة دون إشارة سالب). */
  negativeTone?: boolean;
  /**
   * Classes for the currency symbol alone, e.g. a smaller «ل.س» in ink-subtle beside a big number
   * (هوية 4 › StatTile). By default the symbol takes the amount's own colour and size.
   */
  unitClassName?: string;
}

/**
 * The one way an amount reaches the screen (tab 14 › مكوّن واحد للأرقام): formatted by
 * @serva/core formatMoney («1,250 ل.س», «12.50 $», «−3,000 ل.س»), in the store's digits, with
 * equal-width digits, inside a direction isolate so no Arabic sentence can reorder it. The symbol
 * sits in its own span (data-money-unit) so a tile can draw it softer; the text stays exactly the
 * string formatMoney gives.
 */
export function Money({
  minor,
  currency,
  decimals,
  trimZeros,
  signDisplay,
  symbol,
  negativeTone = false,
  unitClassName,
  className,
  ...rest
}: MoneyProps) {
  const digits = useDigits();
  const text = formatMoney(minor, currency, { digits, decimals, trimZeros, signDisplay, symbol });
  // formatMoney ends with a space, the symbol and the closing PDI: split the symbol off only when
  // the text has exactly that shape. The PDI goes inside the span (it is invisible, and an inline
  // span does not cut the isolate), so the accessible name keeps its exact spacing.
  const unit = symbol === false ? null : getCurrency(currency).symbolAr;
  const tail = unit === null ? null : ` ${unit}${PDI}`;
  const split = tail !== null && text.endsWith(tail);
  return (
    <bdi
      className={cn('num whitespace-nowrap', negativeTone && minor < 0 && 'text-danger-ink', className)}
      {...rest}
    >
      {split ? (
        <>
          {text.slice(0, text.length - tail.length)}{' '}
          <span data-money-unit="" className={unitClassName}>
            {unit}
            {PDI}
          </span>
        </>
      ) : (
        text
      )}
    </bdi>
  );
}
