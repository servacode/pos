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
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 sm:px-4">
          <span className="truncate text-xs text-ink-muted sm:text-sm">{item.label}</span>
          <span
            className={cn(
              'num text-base leading-6 font-bold text-ink max-sm:*:whitespace-normal sm:text-xl',
              item.tone === 'warning' && 'text-warning-ink',
            )}
          >
            {item.value}
          </span>
          {item.note ? (
            <span className="line-clamp-2 text-[0.6875rem] leading-4 text-ink-muted sm:text-xs">
              {item.note}
            </span>
          ) : null}
        </div>
      ))}
    </section>
  );
}
