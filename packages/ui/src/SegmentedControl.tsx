import { useDirection } from '@radix-ui/react-direction';
import { useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';
import { nextIndex } from './rovingFocus';

/** Padding and type of one segment per density. Shared with the pill tabs. */
export const SEGMENT_SIZE: Record<Density, string> = {
  touch: 'px-4 text-base',
  comfortable: 'px-3.5 text-sm',
  compact: 'px-3 text-sm',
  dense: 'px-2.5 text-xs',
};

/**
 * The track (هوية 4 › Segmented control): surface-muted, 4 inside, and the density's control height
 * (CONTROL_HEIGHT), so it lines up with the fields and buttons beside it, also under a finger. The
 * segments stretch to fill it.
 */
export function segmentTrackClass(density: Density): string {
  return cn(CONTROL_HEIGHT[density], 'gap-1 rounded-control bg-surface-muted p-1');
}

/**
 * A segment: the chosen one lifted on surface, with a hairline as well as the soft shadow. A clear
 * layer (before:) reaches over the track's 4 inside above and below, so a finger aims at the full
 * control height (48 on a tablet) while the drawn segment stays 8 shorter.
 */
export function segmentClass(on: boolean): string {
  return cn(
    'relative rounded-small font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard before:absolute before:inset-x-0 before:-inset-y-1 disabled:cursor-not-allowed disabled:opacity-50',
    on ? 'bg-surface text-ink shadow-e1 ring-1 ring-line' : 'text-ink-muted enabled:hover:text-ink',
  );
}

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
        segmentTrackClass(density),
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
            className={cn(SEGMENT_SIZE[density], segmentClass(on))}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
