import { useState } from 'react';
import { CASH_NOTE_MAX, CASH_NOTES_PER_CURRENCY, DEFAULT_CASH_NOTES } from '@serva/core/contracts/till';
import { CURRENCIES, type CurrencyCode } from '@serva/core/currencies';
import { toLatinDigits } from '@serva/core/text';
import { AddIcon, Button, CloseIcon, TextField } from '@serva/ui';

/** The currencies the till counts by note: the store's own that have a built-in list. */
export const noteCurrencies = (store: { baseCurrency: CurrencyCode; enabledCurrencies: CurrencyCode[] }) =>
  [...new Set([store.baseCurrency, ...store.enabledCurrencies])].filter((c) => c in DEFAULT_CASH_NOTES);

export const defaultNotes = (currency: string): number[] => [...(DEFAULT_CASH_NOTES[currency] ?? [])];

const high = (list: readonly number[]) => [...list].sort((a, b) => b - a);
export const sameNotes = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && high(a).every((v, i) => v === high(b)[i]);

/**
 * «فئات النقد» of one currency: the banknote values the till's cash count offers, as chips
 * (high to low) with a field to add one and a button back to the built-in list.
 */
export function CashNotesField({
  currency,
  notes,
  onChange,
}: {
  currency: CurrencyCode;
  notes: number[];
  onChange: (next: number[]) => void;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const info = CURRENCIES[currency];

  function add() {
    const text = toLatinDigits(typed).trim();
    if (text === '') return;
    const value = Number(text);
    if (!/^\d+$/.test(text) || value < 1) return setError('اكتب عدداً صحيحاً أكبر من صفر');
    if (value > CASH_NOTE_MAX) return setError('الفئة كبيرة أكثر من اللازم');
    if (notes.includes(value)) return setError('هذه الفئة موجودة');
    if (notes.length >= CASH_NOTES_PER_CURRENCY) return setError('وصلت إلى أقصى عدد من الفئات');
    onChange(high([...notes, value]));
    setTyped('');
    setError(null);
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-control border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">{`فئات ${info.nameAr}`}</legend>
      <ul className="flex flex-wrap gap-2" aria-label={`فئات ${info.nameAr} الحالية`}>
        {high(notes).map((value) => (
          <li
            key={value}
            className="inline-flex items-center gap-1 rounded-small border border-line bg-surface-muted ps-3 pe-1 text-ink"
          >
            <span className="num font-bold">{value}</span>
            <button
              type="button"
              aria-label={`احذف فئة ${value} ${info.symbolAr}`}
              onClick={() => onChange(notes.filter((v) => v !== value))}
              className="grid size-8 place-items-center rounded-small text-ink-muted hover:bg-surface hover:text-ink"
            >
              <CloseIcon size={16} />
            </button>
          </li>
        ))}
      </ul>
      {notes.length === 0 ? <p className="text-sm text-danger-ink">أبقِ فئة واحدة على الأقل.</p> : null}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label={`أضف فئة ${info.nameAr}`}
            inputMode="numeric"
            dir="ltr"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value.slice(0, 8));
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            error={error ?? undefined}
            inputClassName="num"
          />
        </div>
        <Button type="button" variant="secondary" onClick={add} icon={<AddIcon size={16} />}>
          أضف
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        onClick={() => {
          onChange(defaultNotes(currency));
          setError(null);
        }}
      >
        أعد الافتراضي
      </Button>
    </fieldset>
  );
}
