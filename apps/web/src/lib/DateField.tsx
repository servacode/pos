import { useEffect, useRef, useState } from 'react';
import { CalendarIcon, cn, FieldButton, TextField } from '@serva/ui';
import { parseDayInput, slashDay } from './dates';

export interface DateFieldProps {
  label: string;
  /** An ISO day «2026-10-31», or '' for no date */
  value: string;
  /** The ISO day, or '' when the field was emptied (never with `required`) */
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  /** An emptied field keeps the last day (every report needs one) */
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  name?: string;
  disabled?: boolean;
  /** Something after the calendar button, e.g. a «اليوم» shortcut */
  endExtra?: React.ReactNode;
}

/**
 * A day field in the product's day-first format «31/10/2026», whatever the browser's locale (the
 * native date input shows 10/31/2026 on an English browser). It reads «٣١/١٠/٢٠٢٦» and ISO too,
 * keeps ISO as its value, and opens the browser's calendar from its button.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  required = false,
  hint,
  error,
  className,
  name,
  disabled,
  endExtra,
}: DateFieldProps) {
  const [text, setText] = useState(slashDay(value));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // A value changed from outside (a shortcut, a reset) rewrites the text, unless it is what was typed.
  useEffect(() => {
    setText((current) => (parseDayInput(current) === value ? current : slashDay(value)));
    setBad(false);
  }, [value]);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  function typed(next: string) {
    setText(next);
    if (next.trim() === '') {
      setBad(false);
      if (!required) onChange('');
      return;
    }
    const iso = parseDayInput(next);
    if (iso && inRange(iso)) {
      setBad(false);
      onChange(iso);
    }
  }

  function leave() {
    const iso = parseDayInput(text);
    if (text.trim() === '' && !required) return setBad(false);
    if (!iso || !inRange(iso)) {
      setBad(true);
      return;
    }
    setBad(false);
    setText(slashDay(iso));
  }

  return (
    <div className={cn('relative', className)}>
      <TextField
        label={label}
        name={name}
        value={text}
        disabled={disabled}
        inputMode="numeric"
        dir="ltr"
        placeholder="يوم/شهر/سنة"
        autoComplete="off"
        maxLength={10}
        hint={hint}
        error={error ?? (bad ? 'اكتب تاريخاً صحيحاً بالشكل يوم/شهر/سنة، مثل 31/10/2026' : undefined)}
        onChange={(event) => typed(event.target.value)}
        onBlur={leave}
        endAdornment={
          <>
            {endExtra}
            <FieldButton
              label={`التقويم (${label})`}
              icon={<CalendarIcon size={20} />}
              disabled={disabled}
              onClick={() => {
                const input = picker.current;
                if (!input) return;
                try {
                  input.showPicker();
                } catch {
                  input.focus();
                }
              }}
            />
          </>
        }
      />
      {/* The browser's own calendar, off screen; its choice comes back as ISO. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute size-0 opacity-0"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          if (event.target.value) {
            setBad(false);
            onChange(event.target.value);
          }
        }}
      />
    </div>
  );
}
