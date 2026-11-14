import { useDirection } from '@radix-ui/react-direction';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { useDigits } from '../context';
import { Skeleton, SkeletonText } from '../Skeleton';
import { formatNumber, formatShare } from './format';
import { MAX_SERIES, OTHER_TONE, SERIES_TONES, type SeriesTone } from './palette';
import { ChartTooltip, ExploreLayer } from './parts';
import { useExplorer } from './useExplorer';

/** One part of a whole: a payment method and what it took. */
export interface SharePart {
  key: string;
  label: string;
  value: number;
}

export interface ShareBarProps {
  /** What the whole is («طرق الدفع اليوم»): the bar's accessible name. */
  label: string;
  /** The parts in order, the largest first reads best. Past six, the tail folds into «أخرى». */
  parts: readonly SharePart[];
  /** A part's amount («1,250 ل.س»). Plain grouped digits by default. */
  formatValue?: (value: number) => string;
  /**
   * The list under the bar (default): each part's colour, name, amount and share, as text. Without
   * it the bar stands alone (in a table row, beside its own figures) and its name lists every part.
   */
  legend?: boolean;
  /** The name of the folded tail (default «أخرى»). */
  otherLabel?: string;
  summary?: string;
  loading?: boolean;
  /** What shows under an empty track when the whole is zero (default: one quiet line). */
  empty?: ReactNode;
  className?: string;
}

interface Part extends SharePart {
  tone: SeriesTone;
  /** Its share of the whole (0–1); 0 for nothing or less. */
  share: number;
}

function partsOf(parts: readonly SharePart[], otherLabel: string): { items: Part[]; total: number } {
  const head = parts.length > MAX_SERIES ? parts.slice(0, MAX_SERIES - 1) : parts;
  const tail = parts.length > MAX_SERIES ? parts.slice(MAX_SERIES - 1) : [];
  const listed = head.map((part, index) => ({ ...part, tone: SERIES_TONES[index] ?? OTHER_TONE }));
  if (tail.length > 0) {
    listed.push({
      key: 'other',
      label: otherLabel,
      value: tail.reduce((sum, part) => sum + part.value, 0),
      tone: OTHER_TONE,
    });
  }
  const total = listed.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  const items = listed.map((part) => ({ ...part, share: total > 0 ? Math.max(0, part.value) / total : 0 }));
  return { items, total };
}

/**
 * One whole split into its parts (choosing-a-form › part-to-whole): a slim bar of blocks in the
 * fixed series order, 2 px of surface between them and every end rounded (a whole has no baseline),
 * over a list that gives each part's name, amount and share, so nothing waits on a hover. A block's
 * readout shows on hover, on a tap and from the keyboard. Better than a donut for comparing parts.
 */
export function ShareBar({
  label,
  parts,
  formatValue,
  legend = true,
  otherLabel = 'أخرى',
  summary,
  loading = false,
  empty,
  className,
}: ShareBarProps) {
  const digits = useDigits();
  const dir = useDirection();
  const format = useMemo(
    () => formatValue ?? ((value: number) => formatNumber(value, digits)),
    [formatValue, digits],
  );
  const { items, total } = useMemo(() => partsOf(parts, otherLabel), [parts, otherLabel]);
  // Only drawn blocks are stepped through; a part at zero draws nothing (it stays in the list).
  const drawn = useMemo(() => items.filter((part) => part.share > 0), [items]);
  const blocks = useRef<(HTMLSpanElement | null)[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  const { active, handlers } = useExplorer({
    count: drawn.length,
    indexAt: (point) => {
      const found = blocks.current.findIndex((block) => {
        if (!block) return false;
        const rect = block.getBoundingClientRect();
        return point.x >= rect.left - 1 && point.x <= rect.right + 1;
      });
      return found < 0 ? null : found;
    },
    forward: dir === 'rtl' ? 'left' : 'right',
    start: 0,
  });

  // The readout sits centred over its block (kept inside the bar's width by the readout itself).
  const barBox = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState({ x: 0, bounds: 0 });
  useLayoutEffect(() => {
    if (active === null) return;
    const block = blocks.current[active];
    const box = barBox.current;
    if (!block || !box) return;
    setTip({ x: block.offsetLeft + block.offsetWidth / 2, bounds: box.clientWidth });
  }, [active]);

  const share = (part: Part) => formatShare(part.share, digits);
  const frame = cn('flex min-w-0 flex-col gap-4', className);

  if (total <= 0) {
    return (
      <div className={frame} aria-busy={loading || undefined}>
        {loading ? (
          <>
            <Skeleton className="h-2 rounded-full" />
            {legend ? <SkeletonText lines={3} /> : null}
          </>
        ) : (
          <>
            <div
              role="img"
              aria-label={`${label}: لا بيانات`}
              className="h-2 rounded-full bg-surface-muted"
            />
            {empty ?? <p className="text-sm text-ink-muted">لا بيانات لعرضها بعد.</p>}
          </>
        )}
      </div>
    );
  }

  const focus = active !== null ? drawn[active]?.key : hovered;
  const current = active !== null ? drawn[active] : undefined;
  const spoken =
    summary ??
    (legend
      ? label
      : `${label}: ${items.map((part) => `${part.label} ${format(part.value)} (${share(part)})`).join('، ')}.`);

  return (
    <div className={frame} aria-busy={loading || undefined}>
      <div ref={barBox} className={cn('relative transition-opacity duration-200', loading && 'opacity-50')}>
        <div role="img" aria-label={spoken} className="flex h-2 gap-0.5">
          {drawn.map((part, index) => (
            <span
              key={part.key}
              ref={(node) => {
                blocks.current[index] = node;
              }}
              data-index={index}
              className={cn(
                'h-full min-w-1 rounded-full transition-opacity duration-120 ease-standard',
                part.tone.bg,
                focus !== null && focus !== part.key && 'opacity-35',
              )}
              style={{ flexGrow: part.share, flexBasis: 0 }}
            />
          ))}
        </div>
        <ExploreLayer
          label={label}
          count={drawn.length}
          now={active ?? 0}
          text={(() => {
            const part = drawn[active ?? 0];
            return part ? `${part.label}: ${format(part.value)}، ${share(part)}` : '';
          })()}
          orientation="horizontal"
          handlers={handlers}
          className="inset-x-0 -inset-y-2"
        />
        {current ? (
          <ChartTooltip
            title={current.label}
            rows={[
              {
                key: current.key,
                label: current.label,
                value: `${format(current.value)} · ${share(current)}`,
              },
            ]}
            anchor={{ x: tip.x, y: 0 }}
            placement="above"
            bounds={tip.bounds}
          />
        ) : null}
      </div>
      {legend ? (
        <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 text-sm">
          {items.map((part) => (
            <li
              key={part.key}
              onPointerEnter={() => setHovered(part.key)}
              onPointerLeave={() => setHovered(null)}
              className={cn(
                'col-span-full -mx-2 grid grid-cols-subgrid items-center rounded-small px-2 py-1.5 transition-colors duration-120 ease-standard',
                focus === part.key && 'bg-surface-muted',
              )}
            >
              <span aria-hidden="true" className={cn('size-2.5 rounded-[3px]', part.tone.bg)} />
              <span className="truncate text-ink">{part.label}</span>
              <span className="num text-end font-semibold whitespace-nowrap text-ink">
                {format(part.value)}
              </span>
              <span className="num min-w-12 text-end text-ink-muted">{share(part)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
