import type { CurrencyId } from '@serva/core';
import { useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { cn } from '../cn';
import { Money } from '../Money';

/** A breakdown line's colour: the plain ones are muted, a saving reads in its tone. */
const LINE_TONE = {
  default: 'text-ink-muted',
  info: 'font-semibold text-info-ink',
  success: 'font-semibold text-success-ink',
} as const;

export interface TotalPanelProps {
  totalMinor: number;
  currency: CurrencyId;
  /** The word before the total, and the total's name for screen readers: «المجموع», «المطلوب». */
  label?: string;
  /** One short line under the label: «سطران · 3 قطع». */
  caption?: ReactNode;
  /** Lines above the total: «المجموع الفرعي», «الخصم»… A saving can take its tone. */
  breakdown?: readonly { label: ReactNode; minor: number; tone?: keyof typeof LINE_TONE }[];
  /** The total in the second currency, small under the base one (tap shows the rate). */
  secondary?: { minor: number; currency: CurrencyId; rateLabel: ReactNode };
  /** A line that stays under the total, e.g. «≈ 26.92 $ · سعر الصرف 130». */
  note?: ReactNode;
  /** What the sale waits for, above the total (a manager's approval with its button). */
  notice?: ReactNode;
  /** The quiet actions between the total and the pay button («علّق», «خصم»), in equal columns. */
  actions?: ReactNode;
  onPay: () => void;
  payLabel?: string;
  payDisabled?: boolean;
  /** The pay key («F12»): shown on the button and announced with aria-keyshortcuts. */
  payShortcut?: string;
  className?: string;
}

/**
 * The bottom of the cart (kit .cart-total; هوية 4): on the total's own tint under a hairline, the
 * total in 40 bold equal-width digits with its unit softer, the second currency under it, the quiet
 * actions, and the 72 px pay button carrying the amount. The total is announced to screen readers
 * when it changes, without moving focus.
 */
export function TotalPanel({
  totalMinor,
  currency,
  label = 'المجموع',
  caption,
  breakdown = [],
  secondary,
  note,
  notice,
  actions,
  onPay,
  payLabel = 'ادفع',
  payDisabled = false,
  payShortcut,
  className,
}: TotalPanelProps) {
  const [showRate, setShowRate] = useState(false);
  return (
    <div className={cn('flex shrink-0 flex-col gap-3 border-t border-line bg-surface-total p-4', className)}>
      {breakdown.length > 0 ? (
        <dl className="flex flex-col gap-1 border-b border-line pb-3 text-sm">
          {breakdown.map((line, index) => (
            <div
              key={index}
              className={cn('flex items-center justify-between gap-3', LINE_TONE[line.tone ?? 'default'])}
            >
              <dt>{line.label}</dt>
              <dd>
                <Money minor={line.minor} currency={currency} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {notice}
      <div className="flex flex-col">
        {/* The word and the total share a baseline; what explains them sits on the line under. */}
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-ink-muted">{label}</span>
          <output aria-live="polite" aria-label={label} className="text-total font-bold tracking-tight text-ink">
            <Money minor={totalMinor} currency={currency} unitClassName="text-xl font-semibold text-ink-muted" />
          </output>
        </div>
        {caption || note || secondary ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink-subtle">{caption}</span>
            {note ? <span className="shrink-0 text-ink-muted">{note}</span> : null}
            {secondary ? (
              <button
                type="button"
                onClick={() => setShowRate((shown) => !shown)}
                aria-expanded={showRate}
                className="min-h-11 shrink-0 rounded-small text-ink-muted transition-colors duration-120 ease-standard hover:text-ink"
              >
                {showRate ? <span className="me-2">{secondary.rateLabel}</span> : null}
                <Money minor={secondary.minor} currency={secondary.currency} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {actions ? <div className="grid auto-cols-fr grid-flow-col gap-2">{actions}</div> : null}
      <Button size="pay" onClick={onPay} disabled={payDisabled} aria-keyshortcuts={payShortcut}>
        <span className="flex items-center gap-3">
          {payLabel}
          {payShortcut ? (
            <kbd
              aria-hidden="true"
              dir="ltr"
              className="rounded-small bg-on-brand/15 px-1.5 font-sans text-xs/5 font-semibold text-on-brand"
            >
              {payShortcut}
            </kbd>
          ) : null}
        </span>
        <Money minor={totalMinor} currency={currency} />
      </Button>
    </div>
  );
}
