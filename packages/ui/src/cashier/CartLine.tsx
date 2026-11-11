import { QTY_SCALE, type CurrencyId } from '@serva/core';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { useDigits } from '../context';
import { Money } from '../Money';
import { displayNumber } from '../NumberField';

/** A quantity in thousandths as shown: 3000 → «3», 1250 → «1.250» (three decimals for weights). */
export function formatQuantity(qtyThousandths: number, digits: 'latn' | 'arab' = 'latn'): string {
  const negative = qtyThousandths < 0;
  const magnitude = Math.abs(qtyThousandths);
  const whole = Math.trunc(magnitude / QTY_SCALE);
  const fraction = magnitude % QTY_SCALE;
  const canonical = `${negative ? '-' : ''}${whole}${fraction ? `.${String(fraction).padStart(3, '0')}` : ''}`;
  return displayNumber(canonical, digits);
}

export interface CartLineProps {
  name: string;
  /** Quantity in thousandths (1 piece = 1000, 1.250 kg = 1250). */
  qtyThousandths: number;
  /** «كغ» for weighed lines; pieces show none. */
  unit?: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: CurrencyId;
  /** The second line: options, discount, offer («سكر وسط · خصم 10%»). */
  meta?: ReactNode;
  selected?: boolean;
  onSelect: () => void;
  /** The selected line's actions, shown under it in place (tab 14 › سلة الكاشير). */
  children?: ReactNode;
}

/**
 * One line of the cashier's cart (kit .cart-line; هوية 4): the quantity in a small square, the name
 * on up to two lines (a size and a colour at its end stay in view), «quantity × price» and the
 * options or discount under it, the line total at the end. The selected line takes the brand tint
 * and opens in place with its actions.
 */
export function CartLine({
  name,
  qtyThousandths,
  unit,
  unitPriceMinor,
  lineTotalMinor,
  currency,
  meta,
  selected = false,
  onSelect,
  children,
}: CartLineProps) {
  const digits = useDigits();
  return (
    <li
      className={cn(
        'rounded-card transition-[background-color,box-shadow] duration-120 ease-standard',
        selected ? 'bg-brand-soft ring-1 ring-brand/25' : 'hover:bg-surface-muted/70',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        className="flex min-h-16 w-full items-start gap-3 rounded-card px-3 py-3 text-start motion-safe:animate-rise"
      >
        <span
          aria-hidden="true"
          className={cn(
            'num grid h-7 min-w-7 shrink-0 place-items-center rounded-small px-1.5 text-sm font-bold transition-colors duration-120 ease-standard',
            selected ? 'bg-brand text-on-brand' : 'bg-surface-muted text-ink',
          )}
        >
          {formatQuantity(qtyThousandths, digits)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-base/7 font-semibold text-ink">
            <bdi>{name}</bdi>
          </span>
          <span className="text-sm text-ink-muted">
            {/* One right-to-left isolate: «1.250 كغ × 300» reads quantity, unit, ×, price. */}
            <bdi dir="rtl" className="num">
              {formatQuantity(qtyThousandths, digits)}
              {unit ? ` ${unit}` : ''} × <Money minor={unitPriceMinor} currency={currency} symbol={false} />
            </bdi>
            {meta ? <> · {meta}</> : null}
          </span>
        </span>
        <Money minor={lineTotalMinor} currency={currency} className="text-base/7 font-bold text-ink" />
      </button>
      {selected && children ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">{children}</div>
      ) : null}
    </li>
  );
}
