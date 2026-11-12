import { useEffect, useState } from 'react';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { toMinor } from '@serva/core/money';
import type { Approval } from '@serva/core/contracts/documents';
import {
  AlertCircleIcon,
  BackIcon,
  Button,
  CheckIcon,
  cn,
  DeleteIcon,
  displayNumber,
  Keypad,
  Money,
  OfferIcon,
  PercentIcon,
  useDigits,
} from '@serva/ui';
import { digitOf } from '../PinScreen';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember } from '../staff/staff';
import type { ApprovalNeed } from './cart';
import { Kbd } from './Kbd';
import { SalePanel } from './SalePanel';

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
    <SalePanel
      label={title}
      title={title}
      subtitle={subtitle}
      icon={mode === 'qty' ? null : mode === 'price' ? <OfferIcon size={20} /> : <PercentIcon size={20} />}
      bodyClassName="@container"
      actions={
        <>
          {onRemove ? (
            <Button variant="danger-soft" size="md" icon={<DeleteIcon size={20} />} onClick={onRemove}>
              أزل الخصم
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="md"
            icon={<BackIcon size={20} />}
            aria-keyshortcuts="Escape"
            onClick={onClose}
          >
            ارجع للأصناف
            <Kbd>Esc</Kbd>
          </Button>
        </>
      }
    >
      {pending ? (
        <ManagerCode
          staff={staff}
          permission="sale.discount_over_limit"
          reason={NEED_TEXT[pending.need]}
          onApproved={(approval) => onApply(pending.value, approval)}
          onCancel={() => setPending(null)}
        />
      ) : (
        <>
          {modes.length > 1 ? (
            // One of a few, always one chosen (هوية 4 › Segmented control), drawn as its track
            <div
              role="group"
              aria-label="النوع"
              className="grid auto-cols-fr grid-flow-col gap-1 rounded-control bg-surface-muted p-1"
            >
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
                    'min-h-12 rounded-small px-3 text-base font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                    mode === m
                      ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-5 @lg:grid-cols-2 @3xl:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="flex flex-col gap-3">
              {/* The value as typed: a field in focus, the number large at the start, its unit at the end */}
              <output
                aria-label={MODE_LABEL[mode]}
                className="flex h-18 items-center justify-between gap-3 rounded-control border border-brand bg-surface px-5 ring-4 ring-brand/15"
              >
                <span className="num truncate text-3xl font-bold text-ink" dir="ltr">
                  {text ? displayNumber(text, digits) : displayNumber('0', digits)}
                </span>
                <span className="shrink-0 text-lg font-semibold text-ink-subtle">{unit}</span>
              </output>
              {preview ? <div className="text-sm text-ink-muted">{preview(value)}</div> : null}
              {error ? (
                <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-danger-ink">
                  <AlertCircleIcon size={20} className="shrink-0" />
                  {error}
                </p>
              ) : null}
              <span className="flex-1" />
              <Button
                size="lg"
                fullWidth
                icon={<CheckIcon size={20} />}
                aria-keyshortcuts="Enter"
                onClick={apply}
                disabled={!value}
              >
                طبّق
                <Kbd tone="brand">Enter</Kbd>
              </Button>
            </div>
            <Keypad
              onDigit={type}
              onBackspace={() => setText((t) => t.slice(0, -1))}
              extraKey={decimals > 0 ? '.' : null}
              onExtraKey={() => type('.')}
            />
          </div>
        </>
      )}
    </SalePanel>
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
