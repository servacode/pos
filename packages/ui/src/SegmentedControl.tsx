import { useDirection } from '@radix-ui/react-direction';
import { useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { useDensity } from './context';
import { nextIndex } from './rovingFocus';

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  /** The group's name for screen readers («السكر», «الفترة», «العملة»). */
  label: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  fullWidth?: boolean;
  className?: string;
}

/**
 * Two to five options, one always chosen, one tap to change (tab 14 › أداة التبديل المجزّأة):
 * sugar, period, currency. A radio group: Tab enters it, the arrows move in the reading direction.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onValueChange,
  fullWidth = false,
  className,
}: SegmentedControlProps<V>) {
  const density = useDensity();
  const direction = useDirection();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  function move(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    buttons.current[index]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'gap-1 rounded-xl bg-surface-muted p-1',
        fullWidth ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex',
        className,
      )}
    >
      {options.map((option, index) => {
        const on = index === selected;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              const next = nextIndex(event, index, options.length, direction);
              if (next === null) return;
              event.preventDefault();
              move(next);
            }}
            className={cn(
              density === 'touch' ? 'min-h-12 px-4 text-base' : 'min-h-10 px-3.5 text-sm',
              'rounded-[0.625rem] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'bg-surface text-ink shadow-e2' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
