import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { getCurrency, stripBidiControls, toLatinDigits, toMinor, type CurrencyId } from '@serva/core';
import { cn } from './cn';
import { useDigits, type Digits } from './context';
import { TextField, type TextFieldProps } from './TextField';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Turns what was typed into the canonical Latin form: «١٬٢٥٠٫٥» → "1250.5", «−3» → "-3". It keeps
 * partial input ("-", "12.") so typing is never fought, drops grouping and any other character, and
 * cuts the fraction to `decimals` digits.
 */
export function canonicalNumber(raw: string, decimals: number, allowNegative = false): string {
  const latin = stripBidiControls(toLatinDigits(raw)).replace(/[^0-9.-]/g, '');
  const negative = allowNegative && latin.startsWith('-');
  const unsigned = latin.replace(/-/g, '');
  const dot = unsigned.indexOf('.');
  const intDigits = (dot === -1 ? unsigned : unsigned.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const fraction = dot === -1 || decimals === 0 ? null : unsigned.slice(dot + 1).replace(/\./g, '');
  let text = intDigits;
  if (fraction !== null) text = `${intDigits || '0'}.${fraction.slice(0, decimals)}`;
  return `${negative ? '-' : ''}${text}`;
}

/** Shows a canonical number with thousands separators in the store's digits: "1250.5" → «1,250.5». */
export function displayNumber(canonical: string, digits: Digits): string {
  const [int = '', fraction] = canonical.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  if (digits === 'latn') return text;
  return text.replace(/[\d,.-]/g, (ch) =>
    ch === ',' ? '٬' : ch === '.' ? '٫' : ch === '-' ? '−' : ARABIC_DIGITS.charAt(Number(ch)),
  );
}

/** How many digits, separators-free, sit before `position`: what the caret keeps across reformatting. */
function significantBefore(text: string, position: number): number {
  return stripBidiControls(toLatinDigits(text.slice(0, position))).replace(/[^0-9.-]/g, '').length;
}

/** Characters that count as typed input (digits, separator, minus), Latin or Arabic-Indic. */
const SIGNIFICANT_CHARS = new Set('0123456789.-٠١٢٣٤٥٦٧٨٩٫−');

function positionAfter(text: string, significant: number): number {
  if (significant === 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (SIGNIFICANT_CHARS.has(text.charAt(i))) seen += 1;
    if (seen === significant) return i + 1;
  }
  return text.length;
}

export interface NumberFieldProps extends Omit<
  TextFieldProps,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> {
  /** The canonical Latin value: "1250.5", "" when empty. */
  value: string;
  onValueChange: (value: string) => void;
  /** Fraction digits accepted (tab 14: by currency). Default 0. */
  decimals?: number;
  allowNegative?: boolean;
  /** A unit or currency symbol shown inside the field, at its end. */
  unit?: string;
}

/**
 * A number field (tab 14 › حقل المبلغ): thousands separators while typing, Latin or Arabic-Indic
 * digits, «٫» «٬» and «−» accepted, equal-width digits, laid out LTR so a sign or a fraction never
 * jumps inside the Arabic form.
 */
export function NumberField({
  value,
  onValueChange,
  decimals = 0,
  allowNegative = false,
  unit,
  inputClassName,
  ...rest
}: NumberFieldProps) {
  const digits = useDigits();
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = displayNumber(value, digits);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (caret.current === null || !input || document.activeElement !== input) return;
    const position = positionAfter(shown, caret.current);
    input.setSelectionRange(position, position);
    caret.current = null;
  }, [shown]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { value: typed, selectionStart } = event.target;
    caret.current = significantBefore(typed, selectionStart ?? typed.length);
    onValueChange(canonicalNumber(typed, decimals, allowNegative));
  }

  return (
    <TextField
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      dir="ltr"
      value={shown}
      onChange={handleChange}
      inputClassName={cn('num', inputClassName)}
      endAdornment={
        unit ? (
          <span aria-hidden="true" className="pe-3.5 text-sm text-ink-muted">
            {unit}
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * Minor units → the canonical number a field shows, with the fraction digits it accepts: 1250 USD
 * minor → "12.50", 195000 SYP minor (no fraction shown) → "1950".
 */
function minorToCanonical(minor: number | null, currency: CurrencyId, shown: number): string {
  if (minor === null) return '';
  const { decimals } = getCurrency(currency);
  const negative = minor < 0;
  const padded = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const int = padded.slice(0, padded.length - decimals);
  const fraction = padded
    .slice(padded.length - decimals)
    .padEnd(shown, '0')
    .slice(0, shown);
  return `${negative ? '-' : ''}${int}${fraction ? `.${fraction}` : ''}`;
}

function canonicalToMinor(canonical: string, currency: CurrencyId): number | null {
  if (![...canonical].some((c) => c >= '0' && c <= '9')) return null;
  return toMinor(canonical.replace(/\.$/, ''), currency);
}

export interface MoneyFieldProps extends Omit<NumberFieldProps, 'value' | 'onValueChange' | 'unit'> {
  currency: CurrencyId;
  /** The amount in minor units (spec: money is an integer), null when empty. */
  valueMinor: number | null;
  onValueChange: (minor: number | null) => void;
}

/**
 * Prices and payments: the currency symbol inside, fraction digits by currency (none for the new
 * pound, two for the dollar) and the value as integer minor units.
 */
export function MoneyField({ currency, valueMinor, onValueChange, decimals, ...rest }: MoneyFieldProps) {
  const info = getCurrency(currency);
  const shown = decimals ?? info.displayDecimals;
  const [text, setText] = useState(() => minorToCanonical(valueMinor, currency, shown));
  const [lastMinor, setLastMinor] = useState(valueMinor);

  // Follow a new amount from outside (a quick-cash button, a reset) unless it is what was typed.
  if (valueMinor !== lastMinor) {
    setLastMinor(valueMinor);
    if (valueMinor !== canonicalToMinor(text, currency))
      setText(minorToCanonical(valueMinor, currency, shown));
  }

  return (
    <NumberField
      {...rest}
      value={text}
      decimals={shown}
      unit={info.symbolAr}
      onValueChange={(next) => {
        setText(next);
        const minor = canonicalToMinor(next, currency);
        setLastMinor(minor);
        onValueChange(minor);
      }}
    />
  );
}
