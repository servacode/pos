import type { CurrencyId } from '@serva/core';
import { useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { Money } from '../Money';

export interface TotalPanelProps {
  totalMinor: number;
  currency: CurrencyId;
  /** Lines above the total: «المجموع الفرعي», «الخصم»… */
  breakdown?: readonly { label: ReactNode; minor: number }[];
  /** The total in the second currency, small under the base one, with the rate used. */
  secondary?: { minor: number; currency: CurrencyId; rateLabel: ReactNode };
  onPay: () => void;
  payLabel?: string;
  payDisabled?: boolean;
}

/**
 * The bottom of the cart (kit .cart-total): the total in 40/48 bold equal-width digits, the dollar
 * amount under it (tap shows the rate), and the 72 px pay button carrying the amount. The total is
 * announced to screen readers when it changes, without moving focus.
 */
export function TotalPanel({
  totalMinor,
  currency,
  breakdown = [],
  secondary,
  onPay,
  payLabel = 'ادفع',
  payDisabled = false,
}: TotalPanelProps) {
  const [showRate, setShowRate] = useState(false);
  return (
    <div className="flex flex-col gap-3 border-t border-line bg-surface-total p-4">
      {breakdown.length > 0 ? (
        <dl className="flex flex-col gap-1 text-ink-muted">
          {breakdown.map((line, index) => (
            <div key={index} className="flex items-center justify-between gap-3">
              <dt>{line.label}</dt>
              <dd>
                <Money minor={line.minor} currency={currency} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <span className="pt-2.5 text-lg font-semibold text-ink">المجموع</span>
        <div className="flex flex-col items-end">
          <output aria-live="polite" className="text-total font-bold text-ink">
            <Money minor={totalMinor} currency={currency} />
          </output>
          {secondary ? (
            <button
              type="button"
              onClick={() => setShowRate((shown) => !shown)}
              aria-expanded={showRate}
              className="min-h-11 rounded-small text-ink-muted"
            >
              {showRate ? <span className="me-2 text-sm">{secondary.rateLabel}</span> : null}
              <Money minor={secondary.minor} currency={secondary.currency} />
            </button>
          ) : null}
        </div>
      </div>
      <Button size="pay" onClick={onPay} disabled={payDisabled}>
        <span>{payLabel}</span>
        <Money minor={totalMinor} currency={currency} />
      </Button>
    </div>
  );
}
