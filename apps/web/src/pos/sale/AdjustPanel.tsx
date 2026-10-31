import { useEffect, useState } from 'react';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { toMinor } from '@serva/core/money';
import type { Approval } from '@serva/core/contracts/documents';
import { Button, cn, displayNumber, Keypad, Money, useDigits } from '@serva/ui';
import { digitOf } from '../PinScreen';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember } from '../staff/staff';
import type { ApprovalNeed } from './cart';

export type AdjustMode = 'qty' | 'percent' | 'amount' | 'price';

const MODE_LABEL: Record<AdjustMode, string> = {
  qty: 'الكمية',
  percent: 'خصم بالنسبة',
  amount: 'خصم بمبلغ',
  price: 'سعر جديد',
};

export const NEED_TEXT: Record<ApprovalNeed, string> = {
  over_limit: 'الخصم أكبر من الحد المسموح لدورك، فيحتاج موافقة المدير.',
  under_min_price: 'السعر تحت السعر الأدنى لهذا الصنف، فيحتاج موافقة المدير.',
};

/** What the panel hands back: a value in the mode's unit. */
export type AdjustValue =
  | { mode: 'qty'; qty: number }
  | { mode: 'percent'; bp: number }
  | { mode: 'amount'; minor: number }
  | { mode: 'price'; minor: number };

/** Parses the typed text; null while it is not a usable value. */
export function parseAdjust(
  mode: AdjustMode,
  text: string,
  currency: CurrencyCode,
  fractions: boolean,
): AdjustValue | null {
  if (!/^\d+(\.\d*)?$/.test(text)) return null;
  const value = Number(text);
  if (mode === 'qty') {
    const [whole = '0', frac = ''] = text.split('.');
    if (!fractions && frac) return null;
    if (frac.length > 3) return null;
    const qty = Number(whole) * 1000 + Number(frac.padEnd(3, '0'));
    return qty > 0 && qty <= 100_000_000 ? { mode, qty } : null;
  }
  if (mode === 'percent') {
    const bp = Math.round(value * 100);
    return bp > 0 && bp <= 10_000 && (text.split('.')[1]?.length ?? 0) <= 2 ? { mode, bp } : null;
  }
  try {
    const minor = toMinor(text.endsWith('.') ? text.slice(0, -1) : text, currency);
    return mode === 'price' ? { mode, minor } : minor > 0 ? { mode, minor } : null;
  } catch {
    return null;
  }
}

export interface AdjustPanelProps {
  title: string;
  /** The line or invoice it changes, one line under the title */
  subtitle?: string;
  modes: AdjustMode[];
  initialMode: AdjustMode;
  currency: CurrencyCode;
  /** Weights allow three decimals */
  fractions?: boolean;
  /** Checks a value: an error to show, or what approval it needs (null = none) */
  check: (value: AdjustValue) => { error: string } | { need: ApprovalNeed | null };
  onApply: (value: AdjustValue, approval: Approval | null) => void;
  onRemove?: () => void;
  onClose: () => void;
  staff: readonly StaffMember[];
  /** The value shown before typing, e.g. the current quantity */
  preview?: (value: AdjustValue | null) => React.ReactNode;
}

/**
 * Quantity, discount or price on the keypad, in the items area beside the cart (no dialog). Over the
 * role's limit or under the minimum price, the manager's code opens as a layer inside it.
 */
export function AdjustPanel({
  title,
  subtitle,
  modes,
  initialMode,
  currency,
  fractions = false,
  check,
  onApply,
  onRemove,
  onClose,
  staff,
  preview,
}: AdjustPanelProps) {
  const digits = useDigits();
  const [mode, setMode] = useState<AdjustMode>(initialMode);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ value: AdjustValue; need: ApprovalNeed } | null>(null);
  const decimals =
    mode === 'qty' ? (fractions ? 3 : 0) : mode === 'percent' ? 2 : CURRENCIES[currency].displayDecimals;
  const value = parseAdjust(mode, text, currency, fractions);

  const type = (key: string) => {
    setError(null);
    setText((current) => {
      if (key === '.') return decimals > 0 && !current.includes('.') ? `${current || '0'}.` : current;
      const next = current === '0' ? key : current + key;
      const frac = next.split('.')[1];
      return frac && frac.length > decimals ? current : next.slice(0, 12);
    });
  };

  function apply() {
    if (!value) {
      setError('اكتب قيمة صحيحة أولاً.');
      return;
    }
    const result = check(value);
    if ('error' in result) setError(result.error);
    else if (result.need) setPending({ value, need: result.need });
    else onApply(value, null);
  }

  useEffect(() => {
    if (pending) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement) return;
      const digit = digitOf(event.key);
      if (digit) type(digit);
      else if (event.key === '.' || event.key === '٫') type('.');
      else if (event.key === 'Backspace') setText((t) => t.slice(0, -1));
      else if (event.key === 'Enter') {
        event.preventDefault();
        apply();
      } else return;
      event.stopPropagation();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const unit =
    mode === 'percent' ? '%' : mode === 'qty' ? (fractions ? 'كغ' : '') : CURRENCIES[currency].symbolAr;
  return (
    <section aria-label={title} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-2xl font-bold text-ink">{title}</h2>
          {subtitle ? <p className="truncate text-ink-muted">{subtitle}</p> : null}
        </div>
        {onRemove ? (
          <Button variant="danger-soft" onClick={onRemove}>
            أزل الخصم
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          ارجع للأصناف
        </Button>
      </header>

      {pending ? (
        <ManagerCode
          staff={staff}
          permission="sale.discount_over_limit"
          reason={NEED_TEXT[pending.need]}
          onApproved={(approval) => onApply(pending.value, approval)}
          onCancel={() => setPending(null)}
        />
      ) : (
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-5">
          <div className="flex flex-col gap-3">
            {modes.length > 1 ? (
              <div role="group" aria-label="النوع" className="grid grid-cols-2 gap-2">
                {modes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={mode === m}
                    onClick={() => {
                      setMode(m);
                      setText('');
                      setError(null);
                    }}
                    className={cn(
                      'min-h-14 rounded-control border-2 px-3 font-semibold',
                      mode === m
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface text-ink',
                    )}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            ) : null}
            <output
              aria-label={MODE_LABEL[mode]}
              className="flex h-18 items-center justify-between rounded-control border-2 border-brand bg-surface px-5"
            >
              <span className="num text-3xl font-bold text-ink" dir="ltr">
                {text ? displayNumber(text, digits) : displayNumber('0', digits)}
              </span>
              <span className="text-lg text-ink-muted">{unit}</span>
            </output>
            {preview ? <div className="text-ink-muted">{preview(value)}</div> : null}
            {error ? (
              <p role="alert" className="font-semibold text-danger-ink">
                {error}
              </p>
            ) : null}
            <Button size="lg" onClick={apply} disabled={!value}>
              طبّق
            </Button>
          </div>
          <Keypad
            onDigit={type}
            onBackspace={() => setText((t) => t.slice(0, -1))}
            extraKey={decimals > 0 ? '.' : null}
            onExtraKey={() => type('.')}
          />
        </div>
      )}
    </section>
  );
}

export function MoneyPreview({
  minor,
  currency,
  label,
}: {
  minor: number;
  currency: CurrencyCode;
  label: string;
}) {
  return (
    <span>
      {label} <Money minor={minor} currency={currency} className="font-semibold text-ink" />
    </span>
  );
}
