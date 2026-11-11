import { useId, useMemo } from 'react';
import { cn } from '../cn';
import { isValue } from './format';
import { toneOf, type ChartTone } from './palette';

export interface SparklineProps {
  /** The recent values, oldest first (a StatTile's last 7 or 30 days). Fewer than two draw nothing. */
  values: readonly (number | null)[];
  /**
   * What it shows, for screen readers («المبيعات آخر 7 أيام: في ارتفاع»). Without one it is
   * decorative: the number and the trend beside it say it.
   */
  label?: string;
  /** Time runs from the right in Arabic: the oldest at the right, the latest at the left (default). */
  direction?: 'rtl' | 'ltr';
  /** The series slot (default 1, the brand emerald). */
  tone?: ChartTone;
  /** A soft wash under the line (default). */
  area?: boolean;
  /** Its box: the full width and 36 px high by default. */
  className?: string;
}

const WIDTH = 100;
const HEIGHT = 36;
/** The line keeps clear of the box's top and bottom by this much (in the drawing's units). */
const INSET = 4;

/**
 * A tiny trend for a stat tile (marks-and-anatomy › figures): a 2 px line with a soft wash fading
 * under it and the latest value marked by a dot in a surface ring; no axes, no grid, no readout. It
 * stretches to its box, the line staying 2 px.
 */
export function Sparkline({
  values,
  label,
  direction = 'rtl',
  tone,
  area = true,
  className,
}: SparklineProps) {
  const fillId = `spark-${useId().replace(/[^\w-]/g, '')}`;
  const colour = toneOf(tone, 0);
  const drawing = useMemo(() => {
    const n = values.length;
    const known = values.filter(isValue);
    if (n < 2 || known.length < 2) return null;
    const low = Math.min(...known);
    const range = Math.max(...known) - low;
    const rtl = direction === 'rtl';
    const points: { x: number; y: number }[] = [];
    values.forEach((value, index) => {
      if (!isValue(value)) return;
      const t = index / (n - 1);
      const y = range === 0 ? HEIGHT / 2 : INSET + (1 - (value - low) / range) * (HEIGHT - 2 * INSET);
      points.push({ x: (rtl ? 1 - t : t) * WIDTH, y });
    });
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return null;
    const line = points.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');
    return { line, fill: `${line}L${last.x.toFixed(2)} ${HEIGHT}L${first.x.toFixed(2)} ${HEIGHT}Z`, last };
  }, [values, direction]);

  if (!drawing) return null;
  return (
    <div
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative h-9 w-full', className)}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className={cn('absolute inset-0 size-full overflow-visible', colour.text)}
      >
        {area ? (
          <>
            <defs>
              <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity={0.24} />
                <stop offset="1" stopColor="currentColor" stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={drawing.fill} fill={`url(#${fillId})`} />
          </>
        ) : null}
        <path
          d={drawing.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The latest value: a round dot (HTML, so the stretched drawing cannot squash it). */}
      <span
        className={cn(
          'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface',
          colour.bg,
        )}
        style={{ left: `${drawing.last.x}%`, top: `${(drawing.last.y / HEIGHT) * 100}%` }}
      />
    </div>
  );
}
