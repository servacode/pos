import { useDirection } from '@radix-ui/react-direction';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '../cn';
import { DataTable, type DataColumn } from '../DataTable';
import { EmptyState } from '../EmptyState';
import { ReportsIcon } from '../icons';
import { Skeleton } from '../Skeleton';
import { isValue } from './format';
import type { SeriesTone } from './palette';
import type { ExplorerHandlers } from './useExplorer';

/** One series of a chart: its name and one value per label, in the labels' order. */
export interface ChartSeries {
  /** Stable identity (React key, table column). */
  key: string;
  label: string;
  /** One value per label; null (or a missing value) leaves a gap. */
  values: readonly (number | null)[];
  /** Its colour slot (1–6), to keep the colour when other series are hidden; by default its place. */
  tone?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** A row of the readout: a series' name, its value, and its colour as a short line. */
export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  tone?: SeriesTone;
}

/**
 * Where the readout goes against the point it reads (px from the chart box's top-left corner):
 * beside it, on the side with room (a crosshair, a column); centred over it (a block of a whole); or
 * over it from its reading start (a row, where its bars begin).
 */
export type TipPlacement = 'beside' | 'above' | 'above-start';

/**
 * The hover and focus readout (هوية 4 › Tooltip, interaction › tooltips): inverted ink, the label
 * first and quiet, the values strong. One series shows its value alone; several list every series
 * at that point, each keyed by a short line of its colour. It measures itself and stays inside the
 * chart's box, so it never runs off a phone's screen.
 */
export function ChartTooltip({
  title,
  rows,
  anchor,
  placement,
  bounds,
  gap = 12,
  marksTop,
}: {
  title: string;
  rows: readonly TooltipRow[];
  anchor: { x: number; y: number };
  placement: TipPlacement;
  /** The chart box's width. */
  bounds: number;
  /** Its distance from the anchor beside it (half a column keeps it off the column). */
  gap?: number;
  /**
   * Beside: the top (px) of the marks it reads. When neither side has room (a phone), the readout
   * centres over the point instead, above these marks.
   */
  marksTop?: number;
}) {
  const dir = useDirection();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Measured again whenever its text changes, before it paints.
  const text = `${title}\n${rows.map((row) => `${row.label}\t${row.value}`).join('\n')}`;
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, [text]);

  let left: number;
  let top = anchor.y;
  if (placement === 'beside') {
    const after = anchor.x + gap;
    const before = anchor.x - gap - size.width;
    const roomAfter = after + size.width <= bounds;
    const roomBefore = before >= 0;
    if (roomBefore && (anchor.x > bounds / 2 || !roomAfter)) left = before;
    else if (roomAfter) left = after;
    else {
      // Over the highest mark, even over the legend, never down past the chart.
      left = anchor.x - size.width / 2;
      if (marksTop !== undefined) top = marksTop - size.height - 10;
    }
  } else {
    top = anchor.y - size.height - 6;
    if (placement === 'above') left = anchor.x - size.width / 2;
    else left = dir === 'rtl' ? anchor.x - size.width : anchor.x;
  }
  left = Math.max(0, Math.min(left, bounds - size.width));

  const single = rows.length === 1 ? rows[0] : undefined;
  return (
    <div
      ref={box}
      role="tooltip"
      // Data coordinates: physical px from the box's left edge (see the charts' x axis).
      style={{ left: 0, transform: `translate(${Math.round(left)}px, ${Math.round(top)}px)` }}
      className="pointer-events-none absolute top-0 z-10 w-max max-w-64 rounded-small bg-ink px-3 py-2 text-xs text-surface shadow-e2"
    >
      <p className="font-semibold text-surface/70">{title}</p>
      {single ? (
        <p className="mt-0.5 num text-sm font-bold">{single.value}</p>
      ) : (
        <ul className="mt-1.5 grid gap-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <span aria-hidden="true" className={cn('h-0.5 w-3 shrink-0 rounded-full', row.tone?.bg)} />
              <span className="text-surface/80">{row.label}</span>
              <span className="ms-auto ps-4 num font-bold">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The series names, for two or more (marks-and-anatomy › legend): each beside a key that mirrors its
 * mark, a short line for lines, a small square for areas and bars. Text in ink, never in the colour.
 */
export function ChartLegend({
  items,
  mark,
}: {
  items: readonly { key: string; label: string; tone: SeriesTone }[];
  mark: 'line' | 'square';
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-muted">
      {items.map((item) => (
        <li key={item.key} className="inline-flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0',
              mark === 'line' ? 'h-0.5 w-4 rounded-full' : 'size-2.5 rounded-[3px]',
              item.tone.bg,
            )}
          />
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The keyboard's and the pointer's way into a chart: a transparent layer over the marks, a slider
 * over them for assistive technology. The arrows step from mark to mark and each step is announced
 * (aria-valuetext), as the readout shows it.
 */
export function ExploreLayer({
  label,
  count,
  now,
  text,
  orientation,
  handlers,
  className,
  style,
}: {
  label: string;
  count: number;
  now: number;
  text: string;
  orientation: 'horizontal' | 'vertical';
  handlers: ExplorerHandlers;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={now}
      aria-valuetext={text}
      aria-orientation={orientation}
      className={cn('absolute touch-pan-y rounded-small outline-offset-4', className)}
      style={style}
      {...handlers}
    />
  );
}

/** The chart's accessible twin (anti-patterns › table view): every value as a table. */
export function ChartTable({
  caption,
  labelHeader,
  labels,
  series,
  format,
}: {
  caption: string;
  labelHeader: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
  format: (value: number) => string;
}) {
  const columns: DataColumn<number>[] = [
    { key: 'label', header: labelHeader, cell: (index) => labels[index] ?? '' },
    ...series.map((item): DataColumn<number> => ({
      key: `series-${item.key}`,
      header: item.label,
      numeric: true,
      cell: (index) => {
        const value = item.values[index];
        return isValue(value) ? format(value) : '—';
      },
    })),
  ];
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={labels.map((_, index) => index)}
      rowKey={(index) => index}
    />
  );
}

/** No data to draw: the empty state at the chart's height, so the card keeps its shape. */
export function ChartEmpty({ minHeight, children }: { minHeight: number; children?: ReactNode }) {
  return (
    <div className="grid" style={{ minHeight }}>
      {children ?? <EmptyState icon={ReportsIcon} title="لا بيانات لعرضها بعد." className="justify-center" />}
    </div>
  );
}

/** The first load: a grey block of the chart's height (a later load keeps the drawn chart). */
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div aria-hidden="true" style={{ height }}>
      <Skeleton className="size-full" />
    </div>
  );
}
