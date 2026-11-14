import { useDirection } from '@radix-ui/react-direction';
import { useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity } from './context';
import { nextIndex } from './rovingFocus';
import { ScrollStrip } from './Scroller';
import { SEGMENT_SIZE, segmentClass, segmentTrackClass } from './SegmentedControl';

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
  /**
   * 'underline' (the default, هوية 4 › Underline tabs): the sections of a page, over a hairline with
   * a brand line under the active one. 'pill': a segmented track, for views inside a card.
   */
  variant?: 'underline' | 'pill';
  className?: string;
}

/**
 * One page split into parts (tab 14 › التبويبات): arrows in the reading direction, and a horizontal
 * scroll on phones. Only the active panel is rendered.
 */
export function Tabs<V extends string>({
  label,
  items,
  value,
  onValueChange,
  variant = 'underline',
  className,
}: TabsProps<V>) {
  const density = useDensity();
  const direction = useDirection();
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const active = items[activeIndex];
  const underline = variant === 'underline';

  const list = (
    <div
      role="tablist"
      aria-label={label}
      className={
        underline
          ? 'flex min-w-max gap-1 border-b border-line'
          : cn(segmentTrackClass(density), 'scrollbar-none flex max-w-full self-start overflow-x-auto')
      }
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
            className={
              underline
                ? cn(
                    CONTROL_HEIGHT[density],
                    // The focus ring is drawn inside the tab, so the scrolling strip never clips it.
                    '-mb-px inline-flex shrink-0 items-center gap-2 rounded-t-small border-b-2 px-3 text-[0.9375rem] font-semibold whitespace-nowrap transition-colors duration-120 ease-standard focus-visible:-outline-offset-2',
                    selected
                      ? 'border-brand text-ink'
                      : 'border-transparent text-ink-muted hover:border-line-control/50 hover:text-ink',
                  )
                : cn(SEGMENT_SIZE[density], 'inline-flex shrink-0 items-center gap-2', segmentClass(selected))
            }
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'num min-w-5.5 rounded-full px-1.5 text-center text-xs/5.5',
                  selected
                    ? 'bg-brand text-on-brand'
                    : underline
                      ? 'bg-surface-muted text-ink-muted'
                      : 'bg-surface text-ink-muted',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {underline ? <ScrollStrip>{list}</ScrollStrip> : list}
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
