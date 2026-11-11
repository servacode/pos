import { useId, useMemo, type ReactNode } from 'react';
import { cn } from '../cn';
import { useDigits } from '../context';
import { compactNumber, formatNumber, isValue, textWidth } from './format';
import { MAX_SERIES, toneOf } from './palette';
import {
  ChartEmpty,
  ChartLegend,
  ChartSkeleton,
  ChartTable,
  ChartTooltip,
  ExploreLayer,
  type ChartSeries,
} from './parts';
import { niceScale } from './scale';
import { useChartWidth } from './useChartWidth';
import { useExplorer } from './useExplorer';

export interface TrendChartProps {
  /** What the chart shows («المبيعات آخر 30 يوماً»): its accessible name and the table's caption. */
  label: string;
  /** The points in time, oldest first, as the readout and the table print them («الأربعاء 5/11»). */
  labels: readonly string[];
  /** Shorter forms for the axis («5/11»); the labels by default. */
  axisLabels?: readonly string[];
  /** One to six series, coloured chart-1 … chart-6 in order. One series has no legend. */
  series: readonly ChartSeries[];
  /** A value in the readout, the table and the summary («1,250 ل.س»). Plain grouped digits by default. */
  formatValue?: (value: number) => string;
  /** A tick of the value axis: formatValue when given, otherwise compact numbers («12.5 ألف»). */
  formatTick?: (value: number) => string;
  /**
   * Which way time runs. Arabic reads from the right, so by default the oldest point sits at the
   * right and the latest at the left (the inline end), with the value axis beside the oldest.
   */
  direction?: 'rtl' | 'ltr';
  /** The plot's height in px, without the axis labels under it (220; 180 on a narrow card). */
  height?: number;
  /** 'table' shows the same values as a table: the chart's accessible twin. */
  view?: 'chart' | 'table';
  /** The table's first column head (default «التاريخ»). */
  labelHeader?: string;
  /** Replaces the spoken summary (by default: the range, then each series' highest and latest value). */
  summary?: string;
  /** Loading: a grey block the first time; afterwards the drawn chart stays, dimmed, until new data. */
  loading?: boolean;
  /** What shows with no points (default: an EmptyState of the chart's height). */
  empty?: ReactNode;
  className?: string;
}

const PAD_TOP = 10;
/** Room under the plot for the time labels. */
const AXIS_BAND = 28;
/** The latest point keeps this far from the edge, so its dot and ring are never cut. */
const END_INSET = 6;
/** Between the value labels and the plot. */
const GUTTER_GAP = 12;

interface Point {
  x: number;
  y: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

function buildTrend(
  labels: readonly string[],
  axisLabels: readonly string[] | undefined,
  series: readonly ChartSeries[],
  width: number,
  height: number,
  rtl: boolean,
  tick: (value: number) => string,
) {
  const n = labels.length;
  let low = Infinity;
  let high = -Infinity;
  let integer = true;
  for (const item of series) {
    for (let index = 0; index < n; index += 1) {
      const value = item.values[index];
      if (!isValue(value)) continue;
      low = Math.min(low, value);
      high = Math.max(high, value);
      if (!Number.isInteger(value)) integer = false;
    }
  }
  const scale = niceScale(low, high, height < 200 ? 3 : 4, integer);
  const ticks = scale.ticks.map((value) => ({ value, text: tick(value) }));
  const gutter = Math.ceil(Math.max(0, ...ticks.map((t) => textWidth(t.text)))) + GUTTER_GAP;

  // The chart, not the page, decides which end time starts at, so its axis is physical: x grows to
  // the right, the oldest point sits beside the value axis and the latest at the far end.
  const plotLeft = rtl ? 0 : gutter;
  const plotRight = rtl ? width - gutter : width;
  const first = rtl ? plotRight : plotLeft;
  const latest = rtl ? plotLeft + END_INSET : plotRight - END_INSET;
  const xs = Array.from({ length: n }, (_, index) =>
    n === 1 ? (first + latest) / 2 : first + ((latest - first) * index) / (n - 1),
  );
  const top = PAD_TOP;
  const bottom = height - 1;
  const y = (value: number) => top + ((scale.max - value) / (scale.max - scale.min)) * (bottom - top);
  const base = y(0);

  const paths = series.map((item) => {
    let line = '';
    let area = '';
    let run: Point[] = [];
    let last = -1;
    const close = () => {
      const head = run[0];
      const tail = run[run.length - 1];
      if (head && tail && run.length > 1) {
        const d = run.map((p, j) => `${j ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`).join('');
        line += d;
        area += `${d}L${round(tail.x)} ${round(base)}L${round(head.x)} ${round(base)}Z`;
      }
      run = [];
    };
    for (let index = 0; index < n; index += 1) {
      const value = item.values[index];
      if (isValue(value)) {
        run.push({ x: xs[index] ?? 0, y: y(value) });
        last = index;
      } else close();
    }
    close();
    return { line, area, last };
  });

  // Time labels: as many as fit side by side, counted back from the latest, which always shows.
  const texts = labels.map((text, index) => axisLabels?.[index] ?? text);
  const widest = Math.max(0, ...texts.map((text) => textWidth(text))) + 16;
  const spacing = n > 1 ? Math.abs(latest - first) / (n - 1) : Infinity;
  const every = Math.max(1, Math.ceil(widest / spacing));
  const timeLabels: { index: number; x: number; text: string; shift: string }[] = [];
  for (let index = n - 1; index >= 0; index -= every) {
    const x = xs[index] ?? 0;
    const text = texts[index] ?? '';
    const half = textWidth(text) / 2;
    const shift = x - half < 0 ? 'none' : x + half > width ? 'translateX(-100%)' : 'translateX(-50%)';
    timeLabels.push({ index, x, text, shift });
  }

  return {
    xs,
    y,
    plotLeft,
    plotRight,
    paths,
    timeLabels,
    // Value labels end at the page's edge in Arabic (and against the plot otherwise), so the ones
    // digits line up.
    tickX: rtl ? width : gutter - GUTTER_GAP,
    grid: ticks.map((t) => ({ ...t, y: Math.round(y(t.value)) + 0.5 })),
    indexAt: (x: number) => (n <= 1 ? 0 : Math.round(((x - first) / (latest - first)) * (n - 1))),
  };
}

function trendSummary(
  label: string,
  labels: readonly string[],
  series: readonly ChartSeries[],
  format: (value: number) => string,
): string {
  const n = labels.length;
  const range = n > 1 ? `من ${labels[0]} إلى ${labels[n - 1]}` : (labels[0] ?? '');
  const parts = series.map((item) => {
    let high = -Infinity;
    let highAt = -1;
    let last = -1;
    for (let index = 0; index < n; index += 1) {
      const value = item.values[index];
      if (!isValue(value)) continue;
      if (value > high) {
        high = value;
        highAt = index;
      }
      last = index;
    }
    const lead = series.length > 1 ? `${item.label}: ` : '';
    const lastValue = item.values[last];
    if (highAt < 0 || !isValue(lastValue)) return `${lead}لا قيم`;
    return `${lead}الأعلى ${format(high)} في ${labels[highAt]}، والأخير ${format(lastValue)} في ${labels[last]}`;
  });
  return `${label}، ${range}. ${parts.join('. ')}.`;
}

/**
 * A trend over time (هوية 4 › Charts): one value axis, 2 px lines, a recessive grid, the latest
 * point marked, a crosshair and a readout that follow the pointer or the arrows. Used through
 * AreaChart (a soft fill under each line) and LineChart.
 */
function TrendChart({
  area,
  label,
  labels,
  axisLabels,
  series,
  formatValue,
  formatTick,
  direction = 'rtl',
  height,
  view = 'chart',
  labelHeader = 'التاريخ',
  summary,
  loading = false,
  empty,
  className,
}: TrendChartProps & { area: boolean }) {
  const digits = useDigits();
  const fillId = `trend-${useId().replace(/[^\w-]/g, '')}`;
  const { ref, width } = useChartWidth();
  const plotHeight = height ?? (width < 480 ? 180 : 220);
  const rtl = direction === 'rtl';
  const shown = useMemo(() => series.slice(0, MAX_SERIES), [series]);
  const n = labels.length;
  const hasData = n > 0 && shown.some((item) => item.values.some(isValue));

  const format = useMemo(
    () => formatValue ?? ((value: number) => formatNumber(value, digits)),
    [formatValue, digits],
  );
  const tick = useMemo(
    () => formatTick ?? formatValue ?? ((value: number) => compactNumber(value, digits)),
    [formatTick, formatValue, digits],
  );
  const model = useMemo(
    () => buildTrend(labels, axisLabels, shown, width, plotHeight, rtl, tick),
    [labels, axisLabels, shown, width, plotHeight, rtl, tick],
  );
  const { active, handlers } = useExplorer({
    count: hasData ? n : 0,
    indexAt: (point, box) => model.indexAt(point.x - box.left),
    forward: rtl ? 'left' : 'right',
    start: n - 1,
  });

  const valueAt = (index: number, item: ChartSeries) => {
    const value = item.values[index];
    return isValue(value) ? format(value) : '—';
  };
  const readout = (index: number) =>
    `${labels[index] ?? ''}: ${shown
      .map((item) => `${shown.length > 1 ? `${item.label} ` : ''}${valueAt(index, item)}`)
      .join('، ')}`;

  const frame = cn('flex min-w-0 flex-col gap-4', className);
  if (!hasData) {
    return (
      <div className={frame} aria-busy={loading || undefined}>
        {loading ? (
          <ChartSkeleton height={plotHeight + AXIS_BAND} />
        ) : (
          <ChartEmpty minHeight={plotHeight + AXIS_BAND}>{empty}</ChartEmpty>
        )}
      </div>
    );
  }
  if (view === 'table') {
    return (
      <div className={frame} aria-busy={loading || undefined}>
        <ChartTable
          caption={label}
          labelHeader={labelHeader}
          labels={labels}
          series={shown}
          format={format}
        />
      </div>
    );
  }

  const activeX = active === null ? null : (model.xs[active] ?? null);
  // The points the readout reads, which it never covers.
  const activeYs =
    active === null
      ? []
      : shown.flatMap((item) => {
          const value = item.values[active];
          return isValue(value) ? [model.y(value)] : [];
        });
  const marksTop = activeYs.length ? Math.min(...activeYs) - 6 : undefined;
  return (
    <div className={frame} aria-busy={loading || undefined}>
      {shown.length > 1 ? (
        <ChartLegend
          mark={area ? 'square' : 'line'}
          items={shown.map((item, index) => ({
            key: item.key,
            label: item.label,
            tone: toneOf(item.tone, index),
          }))}
        />
      ) : null}
      <div ref={ref} className="relative" style={{ height: plotHeight + AXIS_BAND }}>
        <div
          role="img"
          aria-label={summary ?? trendSummary(label, labels, shown, format)}
          className={cn('absolute inset-0 transition-opacity duration-200', loading && 'opacity-50')}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="100%"
            height={plotHeight}
            viewBox={`0 0 ${width} ${plotHeight}`}
            className="block overflow-visible"
          >
            {area ? (
              <defs>
                {shown.map((item, index) => (
                  <linearGradient
                    key={item.key}
                    id={`${fillId}-${index}`}
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                    className={toneOf(item.tone, index).text}
                  >
                    <stop offset="0" stopColor="currentColor" stopOpacity={shown.length > 1 ? 0.12 : 0.2} />
                    <stop offset="1" stopColor="currentColor" stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
            ) : null}
            {model.grid.map((line) => (
              <line
                key={line.value}
                x1={model.plotLeft}
                x2={model.plotRight}
                y1={line.y}
                y2={line.y}
                strokeWidth={1}
                className={line.value === 0 ? 'stroke-line-control/40' : 'stroke-line'}
              />
            ))}
            {area
              ? model.paths.map((path, index) =>
                  path.area ? <path key={index} d={path.area} fill={`url(#${fillId}-${index})`} /> : null,
                )
              : null}
            {model.paths.map((path, index) =>
              path.line ? (
                <path
                  key={index}
                  d={path.line}
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={toneOf(shown[index]?.tone, index).stroke}
                />
              ) : null,
            )}
            {activeX !== null ? (
              <line
                x1={Math.round(activeX) + 0.5}
                x2={Math.round(activeX) + 0.5}
                y1={PAD_TOP}
                y2={plotHeight - 1}
                strokeWidth={1}
                className="stroke-line-control"
              />
            ) : null}
            {shown.map((item, index) => {
              const end = model.paths[index]?.last ?? -1;
              const marks = [end, active].filter(
                (at, i, all): at is number => at !== null && at >= 0 && all.indexOf(at) === i,
              );
              return (
                <g key={item.key} className={toneOf(item.tone, index).fill}>
                  {marks.map((at) => {
                    const value = item.values[at];
                    return isValue(value) ? (
                      <circle
                        key={at}
                        cx={round(model.xs[at] ?? 0)}
                        cy={round(model.y(value))}
                        r={5}
                        strokeWidth={2}
                        className="stroke-surface"
                      />
                    ) : null;
                  })}
                </g>
              );
            })}
          </svg>
          {model.grid.map((line) => (
            <span
              key={line.value}
              className="absolute num text-xs leading-none whitespace-nowrap text-ink-subtle"
              style={{ left: model.tickX, top: line.y, transform: 'translate(-100%, -50%)' }}
            >
              {line.text}
            </span>
          ))}
          {model.timeLabels.map((item) => (
            <span
              key={item.index}
              data-index={item.index}
              className="absolute num text-xs leading-none whitespace-nowrap text-ink-subtle"
              style={{ left: item.x, top: plotHeight + 10, transform: item.shift }}
            >
              {item.text}
            </span>
          ))}
        </div>
        <ExploreLayer
          label={label}
          count={n}
          now={active ?? n - 1}
          text={readout(active ?? n - 1)}
          orientation="horizontal"
          handlers={handlers}
          className="inset-x-0 top-0"
          style={{ height: plotHeight }}
        />
        {active !== null && activeX !== null ? (
          <ChartTooltip
            title={labels[active] ?? ''}
            rows={shown.map((item, index) => ({
              key: item.key,
              label: item.label,
              value: valueAt(active, item),
              tone: toneOf(item.tone, index),
            }))}
            anchor={{ x: activeX, y: PAD_TOP }}
            placement="beside"
            bounds={width}
            marksTop={marksTop}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A trend with a soft wash under each line: sales by day, the default form for one series over time. */
export function AreaChart(props: TrendChartProps) {
  return <TrendChart {...props} area />;
}

/** A trend as lines alone: several series compared over time (this month against the last). */
export function LineChart(props: TrendChartProps) {
  return <TrendChart {...props} area={false} />;
}
