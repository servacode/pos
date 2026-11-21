import type { ReactNode } from 'react';
import { cn } from '@serva/ui';

export interface SlimKpi {
  key: string;
  /** What the number counts, in plain words */
  label: ReactNode;
  value: ReactNode;
  /** A short line under the number (kept to one line; a phone shows it small) */
  note?: ReactNode;
  tone?: 'warning';
  /** Show the whole note (wrapping as it needs) instead of cutting it at two lines */
  fullNote?: boolean;
  /** Makes the whole cell a button (a tile that applies the filter it counts) */
  onSelect?: () => void;
  /** The filter this cell applies is on now */
  pressed?: boolean;
  /** What pressing it does, for a screen reader */
  selectLabel?: string;
}

/**
 * One slim row of figures over a list (products, inventory, purchases): the label, the number and
 * one short note in each cell, so the table starts in the first screen. A row of cells on every
 * width, a phone included.
 */
export function SlimKpis({ items, label }: { items: readonly SlimKpi[]; label: string }) {
  return (
    <section
      aria-label={label}
      className="flex min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-e1 *:not-first:border-s *:not-first:border-line"
    >
      {items.map((item) => {
        const body = (
          <>
            <span className="truncate text-xs text-ink-muted sm:text-sm">{item.label}</span>
            <span
              className={cn(
                'num text-base leading-6 font-bold text-ink max-sm:*:whitespace-normal sm:text-xl',
                item.tone === 'warning' && 'text-warning-ink',
              )}
            >
              {item.value}
            </span>
          </>
        );
        const note = item.note ? (
          <span
            className={cn(
              'text-[0.6875rem] leading-4 text-ink-muted sm:text-xs',
              !item.fullNote && 'line-clamp-2',
            )}
          >
            {item.note}
          </span>
        ) : null;
        return (
          <div
            key={item.key}
            className={cn(
              'flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 sm:px-4',
              item.pressed && 'bg-brand-soft',
            )}
          >
            {item.onSelect ? (
              // The figure is the button; the note keeps its own links, so it sits outside it
              <button
                type="button"
                aria-pressed={item.pressed ?? false}
                aria-label={item.selectLabel}
                onClick={item.onSelect}
                className="flex min-h-11 min-w-0 flex-col gap-0.5 rounded-small text-start hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-brand"
              >
                {body}
              </button>
            ) : (
              body
            )}
            {note}
          </div>
        );
      })}
    </section>
  );
}
