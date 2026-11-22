import { QTY_SCALE, type CurrencyId } from '@serva/core';
import type { ReactNode } from 'react';
import { IconButton } from '../Button';
import { cn } from '../cn';
import { DeleteIcon, WarningIcon } from '../icons';
import { useDigits } from '../context';
import { exactDecimals, Money } from '../Money';
import { displayNumber } from '../NumberField';
import { NameText } from './NameText';

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
  /** The line's element id, so the cart can scroll to it */
  id?: string;
  name: string;
  /** The variant («34 · أزرق») kept whole on one line after the name, never split by the wrap */
  variant?: string;
  /** Quantity in thousandths (1 piece = 1000, 1.250 kg = 1250). */
  qtyThousandths: number;
  /** «كغ» for weighed lines; pieces show none. */
  unit?: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  currency: CurrencyId;
  /** The second line: options, discount, offer («سكر وسط · خصم 10%»). */
  meta?: ReactNode;
  /** A ⚠ at the name: the line has a warning (listed in the cart's «N تنبيهات» row), red when it blocks the sale */
  warning?: 'danger' | 'warning' | null;
  selected?: boolean;
  onSelect: () => void;
  /** A delete button always in view at the line's end (no need to open the line to remove it). */
  onRemove?: () => void;
  /** A control that sits under the line, always in view, outside its button (a button cannot hold a button). */
  extra?: ReactNode;
  /** The selected line's actions, shown under it in place (tab 14 › سلة الكاشير). */
  children?: ReactNode;
}

/**
 * One line of the cashier's cart (kit .cart-line; هوية 4): the name
 * on up to two lines (a size and a colour at its end stay in view), «quantity × price» and the
 * options or discount under it, the line total at the end. The selected line takes the brand tint
 * and opens in place with its actions.
 */
export function CartLine({
  id,
  name,
  variant,
  qtyThousandths,
  unit,
  unitPriceMinor,
  lineTotalMinor,
  currency,
  meta,
  warning = null,
  selected = false,
  onSelect,
  onRemove,
  extra,
  children,
}: CartLineProps) {
  const digits = useDigits();
  return (
    <li
      id={id}
      className={cn(
        'rounded-card transition-[background-color,box-shadow] duration-120 ease-standard',
        selected ? 'bg-brand-soft ring-1 ring-brand/25' : 'hover:bg-surface-muted/70',
      )}
    >
      <div className="flex items-start">
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          className="flex min-h-14 min-w-0 flex-1 items-start gap-3 rounded-card px-3 py-1.5 text-start motion-safe:animate-rise"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 text-base/7 font-semibold text-ink">
              {warning ? (
                <span
                  className={cn(
                    'me-1.5 inline-block align-middle',
                    warning === 'danger' ? 'text-danger-ink' : 'text-warning-ink',
                  )}
                >
                  <WarningIcon size={16} />
                  <span className="sr-only">عليه تنبيه</span>
                </span>
              ) : null}
              <NameText name={name} />
            </span>
            <span className="text-sm text-ink-muted">
              {/* The size and colour sit whole on the detail row, never wrapped under a long name */}
              {variant ? (
                <bdi className="me-2 rounded-small bg-surface-muted px-1.5 py-0.5 font-semibold whitespace-nowrap text-ink">
                  {variant}
                </bdi>
              ) : null}
              {/* One right-to-left isolate: «1.250 كغ × 300» reads quantity, unit, ×, price. */}
              <bdi dir="rtl" className="num">
                {formatQuantity(qtyThousandths, digits)}
                {unit ? ` ${unit}` : ''} ×{' '}
                <Money
                  minor={unitPriceMinor}
                  currency={currency}
                  decimals={exactDecimals(unitPriceMinor, currency)}
                  symbol={false}
                />
              </bdi>
              {/* On its own line, whole items wrapping: no separator dot left stranded at a line's end */}
              {meta ? <span className="block">{meta}</span> : null}
            </span>
          </span>
          <Money
            minor={lineTotalMinor}
            currency={currency}
            decimals={exactDecimals(lineTotalMinor, currency)}
            className="text-base/7 font-bold text-ink"
          />
        </button>
        {onRemove ? (
          <IconButton
            label="احذف السطر"
            size="sm"
            variant="ghost"
            icon={<DeleteIcon size={20} />}
            onClick={onRemove}
            className="mt-1 me-1 shrink-0 text-ink-subtle"
          />
        ) : null}
      </div>
      {extra ? <div className="px-3 pb-2 text-sm">{extra}</div> : null}
      {selected && children ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">{children}</div>
      ) : null}
    </li>
  );
}
