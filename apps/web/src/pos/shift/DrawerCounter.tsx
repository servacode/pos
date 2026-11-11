import { useCallback, useState } from 'react';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { toLatinDigits } from '@serva/core/text';
import { AddIcon, Button, CashIcon, cn, IconChip, Money, RemoveIcon, TextField } from '@serva/ui';
import { parseAmount, amountText } from '../pay/payment';
import { countTotal, DENOMINATIONS, type DrawerCount } from './shift';

export function emptyCount(currency: CurrencyCode): DrawerCount {
  const notes = DENOMINATIONS[currency];
  return notes
    ? { currency, notes: Object.fromEntries(notes.map((v) => [v, 0])), totalMinor: 0 }
    : { currency, notes: null, totalMinor: 0 };
}

export const drawerName = (currency: CurrencyCode) =>
  currency === 'SYP'
    ? 'درج الليرة'
    : currency === 'USD'
      ? 'درج الدولار'
      : `درج ${(CURRENCIES[currency] as { nameAr: string }).nameAr}`;

const noteLabel = (value: number, currency: CurrencyCode) =>
  `${amountText(value, currency)} ${CURRENCIES[currency].symbolAr}`;

/** Where the keypad types: a note's count (its value in minor units), or the drawer's total. */
export type CountKey = number | 'total';

const firstKey = (count: DrawerCount): CountKey =>
  count.notes ? (DENOMINATIONS[count.currency]?.[0] ?? 'total') : 'total';

/** A digit typed on the keypad into a note's count (as the field allows: up to 99,999) or the total. */
function typeDigits(count: DrawerCount, key: CountKey, digits: string): DrawerCount {
  if (key !== 'total') {
    if (!count.notes) return count;
    const n = count.notes[key] ?? 0;
    const next = Number(`${n}${digits}`);
    return { ...count, notes: { ...count.notes, [key]: Math.max(0, Math.min(99_999, next)) } };
  }
  if (count.notes) return count;
  const text = count.totalMinor ? amountText(count.totalMinor, count.currency) : '';
  const next = parseAmount(`${text}${digits}`, count.currency);
  return next === null ? count : { ...count, totalMinor: next };
}

/** The keypad's backspace: the last digit of the count or of the total goes. */
function eraseDigit(count: DrawerCount, key: CountKey): DrawerCount {
  if (key !== 'total') {
    if (!count.notes) return count;
    const n = count.notes[key] ?? 0;
    return { ...count, notes: { ...count.notes, [key]: Math.floor(n / 10) } };
  }
  if (count.notes) return count;
  const rest = amountText(count.totalMinor, count.currency).slice(0, -1).replace(/\.$/, '');
  return { ...count, totalMinor: parseAmount(rest || '0', count.currency) ?? 0 };
}

/**
 * The keypad beside the drawers (kit cashier/ShiftOpen): it types into the row picked last, a
 * note's count or a drawer's total, through the same counts the fields change. Starts on the first
 * note of the first drawer, so the cashier can count at once.
 */
export function useCountKeypad(
  counts: readonly DrawerCount[],
  setCounts: (update: (list: DrawerCount[]) => DrawerCount[]) => void,
) {
  const [target, setTarget] = useState<{ currency: CurrencyCode; key: CountKey } | null>(() =>
    counts[0] ? { currency: counts[0].currency, key: firstKey(counts[0]) } : null,
  );

  const edit = useCallback(
    (change: (count: DrawerCount, key: CountKey) => DrawerCount) => {
      if (!target) return;
      setCounts((list) => list.map((c) => (c.currency === target.currency ? change(c, target.key) : c)));
    },
    [target, setCounts],
  );

  const count = target ? counts.find((c) => c.currency === target.currency) : undefined;
  const typingTotal = target?.key === 'total';
  return {
    /** The row the keypad types into, for one drawer */
    activeIn: (currency: CurrencyCode): CountKey | null =>
      target?.currency === currency ? target.key : null,
    activate: (currency: CurrencyCode, key: CountKey) => setTarget({ currency, key }),
    /** «درج الليرة · 500 ل.س», what the keypad types into now */
    targetText:
      target && count
        ? `${drawerName(target.currency)} · ${
            target.key === 'total' ? 'المجموع' : noteLabel(target.key, target.currency)
          }`
        : null,
    keypad: {
      onDigit: (digit: string) => edit((c, key) => typeDigits(c, key, digit)),
      onBackspace: () => edit(eraseDigit),
      extraKey: typingTotal ? ('00' as const) : null,
      onExtraKey: () => edit((c, key) => typeDigits(c, key, '00')),
      disabled: !target,
    },
  };
}

/**
 * One drawer counted by note (kit cashier/ShiftOpen and ShiftClose: «اكتب عدد الأوراق من كل فئة»),
 * or as a total when the cashier skips the count. Every count has − and + of 48, and the row being
 * typed by the keypad beside it shows as picked.
 */
export function DrawerCounter({
  count,
  onChange,
  active = null,
  onActivate,
}: {
  count: DrawerCount;
  onChange: (next: DrawerCount) => void;
  /** The row the keypad types into, when it is in this drawer */
  active?: CountKey | null;
  onActivate?: (key: CountKey) => void;
}) {
  const { currency } = count;
  const byNote = count.notes !== null;
  const total = countTotal(count);
  return (
    <section
      aria-label={drawerName(currency)}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-e1"
    >
      <div className="flex items-center gap-3 pb-1">
        <IconChip size="sm">
          <CashIcon size={16} />
        </IconChip>
        <h2 className="flex-1 text-lg font-semibold text-ink">{drawerName(currency)}</h2>
        <Money minor={total} currency={currency} className="text-xl font-bold text-ink" />
      </div>
      {byNote ? (
        <ul className="flex flex-col gap-1">
          {DENOMINATIONS[currency]!.map((value) => {
            const n = count.notes![value] ?? 0;
            const set = (next: number) =>
              onChange({
                ...count,
                notes: { ...count.notes!, [value]: Math.max(0, Math.min(99_999, next)) },
              });
            const label = noteLabel(value, currency);
            const picked = active === value;
            return (
              <li
                key={value}
                className={cn(
                  'flex items-center gap-2 rounded-control py-1 ps-1 pe-2 transition-colors duration-120 ease-standard',
                  picked && 'bg-brand-soft/60',
                )}
              >
                <button
                  type="button"
                  aria-pressed={picked}
                  onClick={() => onActivate?.(value)}
                  className={cn(
                    'num min-h-12 w-24 shrink-0 rounded-small border px-2.5 text-start font-bold transition-colors duration-120 ease-standard',
                    picked
                      ? 'border-brand/40 bg-surface text-brand-ink'
                      : 'border-line bg-surface-muted text-ink hover:border-line-control',
                  )}
                >
                  {label}
                </button>
                <div className="inline-flex items-stretch overflow-hidden rounded-control border border-line-control/50 bg-surface shadow-e1">
                  <button
                    type="button"
                    aria-label={`أنقص ${label}`}
                    onClick={() => {
                      onActivate?.(value);
                      set(n - 1);
                    }}
                    className="grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink active:bg-surface-muted"
                  >
                    <RemoveIcon size={16} />
                  </button>
                  <input
                    aria-label={`عدد أوراق ${label}`}
                    inputMode="numeric"
                    value={n === 0 ? '' : String(n)}
                    placeholder="0"
                    onFocus={() => onActivate?.(value)}
                    onChange={(e) => set(Number(toLatinDigits(e.target.value).replace(/\D/g, '') || '0'))}
                    className="num h-12 w-14 border-x border-line bg-surface text-center text-lg font-bold text-ink caret-brand outline-none placeholder:text-ink-subtle focus:bg-brand-soft/40"
                  />
                  <button
                    type="button"
                    aria-label={`زِد ${label}`}
                    onClick={() => {
                      onActivate?.(value);
                      set(n + 1);
                    }}
                    className="grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard hover:bg-surface-muted hover:text-ink active:bg-surface-muted"
                  >
                    <AddIcon size={16} />
                  </button>
                </div>
                <span className="flex-1" />
                <Money
                  minor={value * n}
                  currency={currency}
                  symbol={false}
                  className={cn('text-sm', n > 0 ? 'font-semibold text-ink' : 'text-ink-subtle')}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className={cn(
            'rounded-control p-2 transition-colors duration-120 ease-standard',
            active === 'total' && 'bg-brand-soft/60',
          )}
        >
          <TextField
            label="المجموع"
            inputMode="decimal"
            dir="ltr"
            value={count.totalMinor ? amountText(count.totalMinor, currency) : ''}
            placeholder="0"
            onFocus={() => onActivate?.('total')}
            onChange={(e) =>
              onChange({
                ...count,
                totalMinor: parseAmount(toLatinDigits(e.target.value).replace(/[^\d.]/g, ''), currency) ?? 0,
              })
            }
            inputClassName="num text-2xl font-bold"
            endAdornment={<span className="me-4 shrink-0 text-base">{CURRENCIES[currency].symbolAr}</span>}
          />
        </div>
      )}
      {DENOMINATIONS[currency] ? (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            const next = byNote
              ? { currency, notes: null, totalMinor: countTotal(count) }
              : emptyCount(currency);
            onChange(next);
            onActivate?.(firstKey(next));
          }}
        >
          {byNote ? 'تخطَّ العدّ واكتب المجموع' : 'عُدّ بالفئات'}
        </Button>
      ) : null}
    </section>
  );
}
