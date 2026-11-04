import { useDirection } from '@radix-ui/react-direction';
import { useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { useDensity } from './context';
import { nextIndex } from './rovingFocus';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  /** A count after the label, e.g. pending orders. */
  count?: number;
  content: ReactNode;
}

export interface TabsProps<V extends string> {
  /** The tab list's name for screen readers. */
  label: string;
  items: readonly TabItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  className?: string;
}

/**
 * One page split into parts (tab 14 › التبويبات): a line under the active tab, arrows in the reading
 * direction, and a horizontal scroll on phones. Only the active panel is rendered.
 */
export function Tabs<V extends string>({ label, items, value, onValueChange, className }: TabsProps<V>) {
  const density = useDensity();
  const direction = useDirection();
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const active = items[activeIndex];

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div
        role="tablist"
        aria-label={label}
        className="scrollbar-none flex max-w-full gap-1 self-start overflow-x-auto rounded-full bg-surface-muted p-1 ring-1 ring-line/60"
      >
        {items.map((item, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={item.value}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              onKeyDown={(event) => {
                const next = nextIndex(event, index, items.length, direction);
                if (next === null) return;
                event.preventDefault();
                const target = items[next];
                if (!target) return;
                onValueChange(target.value);
                tabs.current[next]?.focus();
              }}
              className={cn(
                density === 'touch' ? 'min-h-12' : 'min-h-10',
                'inline-flex shrink-0 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120',
                selected ? 'bg-surface text-ink shadow-e1' : 'text-ink-muted hover:text-ink',
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span
                  className={cn(
                    'num min-w-5.5 rounded-full px-1.5 text-xs/5.5',
                    selected ? 'bg-brand text-on-brand' : 'bg-surface text-ink-muted',
                  )}
                >
                  {item.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${id}-panel-${activeIndex}`}
          aria-labelledby={`${id}-tab-${activeIndex}`}
          tabIndex={0}
          className="rounded-small"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
