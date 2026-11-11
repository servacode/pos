import { useDirection } from '@radix-ui/react-direction';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

export interface BarChartProps {
  /** What the chart shows («المبيعات حسب القسم»): its accessible name and the table's caption. */
  label: string;
  /** One bar, or one group of bars, per label: departments, products, hours, days (oldest first). */
  labels: readonly string[];
  /** Shorter forms under the columns; the labels by default. */
  axisLabels?: readonly string[];
  /** One to six series, coloured chart-1 … chart-6 in order: one series is one colour for every bar. */
  series: readonly ChartSeries[];
  /** Columns rise from a baseline (default); rows run from the inline start, for long names. */
  orientation?: 'vertical' | 'horizontal';
  /** Each bar's value at its end (default): columns print it on the cap where it fits, rows at the tip. */
  valueLabels?: boolean;
  formatValue?: (value: number) => string;
  /** A tick of the value axis (columns without value labels): formatValue, or compact numbers. */
  formatTick?: (value: number) => string;
  /** Columns: the first label at the right in Arabic (default), like time and reading. */
  direction?: 'rtl' | 'ltr';
  /** Columns: the plot's height in px without the labels under it (220; 180 on a narrow card). */
  height?: number;
  view?: 'chart' | 'table';
  /** The table's first column head (default «البند»). */
  labelHeader?: string;
  summary?: string;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
}

const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;
const PAD_TOP = 10;
/** Room over the tallest column (or under the lowest) for its value. */
const LABEL_ROOM = 22;
const AXIS_BAND = 28;
const GUTTER_GAP = 12;
/** The share of a column's slot its bars may take; the rest is air between the groups. */
const FILL = 0.72;

/** A bar with its data end rounded (4 px) and its baseline end square (marks-and-anatomy). */
function barPath(x: number, w: number, base: number, end: number): string {
  const r = Math.min(RADIUS, Math.abs(end - base), w / 2);
  if (end < base) {
    return `M${x} ${base}V${end + r}A${r} ${r} 0 0 1 ${x + r} ${end}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${end + r}V${base}Z`;
  }
  return `M${x} ${base}V${end - r}A${r} ${r} 0 0 0 ${x + r} ${end}H${x + w - r}A${r} ${r} 0 0 0 ${x + w} ${end - r}V${base}Z`;
}

function valueText(item: ChartSeries, index: number, format: (value: number) => string): string {
  const value = item.values[index];
  return isValue(value) ? format(value) : '—';
}

function barSummary(
  label: string,
  labels: readonly string[],
  series: readonly ChartSeries[],
  format: (value: number) => string,
): string {
  const n = labels.length;
  const [only] = series;
  if (series.length === 1 && only && n <= 12) {
    return `${label}: ${labels.map((text, index) => `${text} ${valueText(only, index, format)}`).join('، ')}.`;
  }
  if (series.length > 1 && n <= 8) {
    const groups = labels.map(
      (text, index) =>
        `${text}: ${series.map((item) => `${item.label} ${valueText(item, index, format)}`).join('، ')}`,
    );
    return `${label}: ${groups.join('؛ ')}.`;
  }
  const extremes = series.map((item) => {
    let high = -1;
    let low = -1;
    for (let index = 0; index < n; index += 1) {
      const value = item.values[index];
      if (!isValue(value)) continue;
      if (high < 0 || value > (item.values[high] as number)) high = index;
      if (low < 0 || value < (item.values[low] as number)) low = index;
    }
    const lead = series.length > 1 ? `${item.label}: ` : '';
    if (high < 0) return `${lead}لا قيم`;
    return `${lead}الأعلى ${labels[high]} ${valueText(item, high, format)}، والأدنى ${labels[low]} ${valueText(item, low, format)}`;
  });
  return `${label}: ${extremes.join('؛ ')}.`;
}

function buildColumns(
  labels: readonly string[],
  axisLabels: readonly string[] | undefined,
  series: readonly ChartSeries[],
  width: number,
  height: number,
  rtl: boolean,
  tick: (value: number) => string,
  format: (value: number) => string,
  wantLabels: boolean,
) {
  const n = labels.length;
  const k = series.length;
  let low = 0;
  let high = 0;
  let integer = true;
  let widestValue = 0;
  for (const item of series) {
    for (let index = 0; index < n; index += 1) {
      const value = item.values[index];
      if (!isValue(value)) continue;
      low = Math.min(low, value);
      high = Math.max(high, value);
      if (!Number.isInteger(value)) integer = false;
      if (wantLabels) widestValue = Math.max(widestValue, textWidth(format(value), 12, 600));
    }
  }
  const barFor = (band: number) =>
    Math.max(1, Math.min(MAX_BAR, Math.floor((band * FILL - (k - 1) * GAP) / k)));

  // Every value on its column, or none: then the ticks carry them (and the grid comes back).
  let labelled = false;
  if (wantLabels) {
    const band = width / n;
    labelled = widestValue <= (k === 1 ? band - 8 : barFor(band) + GAP);
  }
  const scale = labelled
    ? { min: low, max: high > low ? high : low + 1, ticks: [] as number[] }
    : niceScale(low, high, height < 200 ? 3 : 4, integer);
  const ticks = scale.ticks.map((value) => ({ value, text: tick(value) }));
  const gutter = labelled ? 0 : Math.ceil(Math.max(0, ...ticks.map((t) => textWidth(t.text)))) + GUTTER_GAP;
  const plotLeft = rtl ? 0 : gutter;
  const plotRight = rtl ? width - gutter : width;
  const band = (plotRight - plotLeft) / n;
  const bar = barFor(band);
  const group = k * bar + (k - 1) * GAP;
  const top = labelled ? LABEL_ROOM : PAD_TOP;
  const bottom = height - 1 - (labelled && low < 0 ? LABEL_ROOM : 0);
  const y = (value: number) => top + ((scale.max - value) / (scale.max - scale.min)) * (bottom - top);
  const base = Math.round(y(0));
  const centre = (index: number) =>
    rtl ? plotRight - band * (index + 0.5) : plotLeft + band * (index + 0.5);

  const bars = labels.flatMap((_, index) => {
    const start = Math.round(centre(index) - group / 2);
    return series.flatMap((item, j) => {
      const value = item.values[index];
      if (!isValue(value) || value === 0) return [];
      // The first series sits at the reading start of its group: the right in Arabic.
      const x = start + (rtl ? k - 1 - j : j) * (bar + GAP);
      let end = Math.round(y(value));
      if (end === base) end = value > 0 ? base - 1 : base + 1;
      return [
        { key: `${index}-${j}`, index, series: j, x, end, up: value > 0, d: barPath(x, bar, base, end) },
      ];
    });
  });

  const texts = labels.map((text, index) => axisLabels?.[index] ?? text);
  const widest = Math.max(0, ...texts.map((text) => textWidth(text))) + 12;
  const every = Math.max(1, Math.ceil(widest / band));
  const nameWidth = Math.max(24, every * band - 8);
  const names: { index: number; x: number; text: string }[] = [];
  for (let index = n - 1; index >= 0; index -= every) {
    const text = texts[index] ?? '';
    // Centred under its column, held inside the chart at either end.
    const half = Math.min(textWidth(text), nameWidth) / 2;
    names.push({ index, x: Math.min(Math.max(centre(index), half), width - half), text });
  }

  return {
    bars,
    bar,
    band,
    base,
    labelled,
    names,
    nameWidth,
    centre,
    plotLeft,
    plotRight,
    tickX: rtl ? width : gutter - GUTTER_GAP,
    grid: ticks.map((t) => ({ ...t, y: Math.round(y(t.value)) + 0.5 })),
    top,
    indexAt: (x: number) => Math.floor((rtl ? plotRight - x : x - plotLeft) / band),
  };
}

/**
 * Bars that compare amounts (هوية 4 › Charts): one hue per series, bars no thicker than 24 px with
 * their data end rounded 4 px and their baseline end square, 2 px of surface between neighbours,
 * each value printed at its end, and a readout on hover and focus. Columns for a few labels (hours,
 * days); rows for long names, the best sellers or the departments.
 */
export function BarChart({
  label,
  labels,
  axisLabels,
  series,
  orientation = 'vertical',
  valueLabels = true,
  formatValue,
  formatTick,
  direction = 'rtl',
  height,
  view = 'chart',
  labelHeader = 'البند',
  summary,
  loading = false,
  empty,
  className,
}: BarChartProps) {
  const digits = useDigits();
  const { ref, width } = useChartWidth();
  const plotHeight = height ?? (width < 480 ? 180 : 220);
  const rtl = direction === 'rtl';
  const horizontal = orientation === 'horizontal';
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
    () => buildColumns(labels, axisLabels, shown, width, plotHeight, rtl, tick, format, valueLabels),
    [labels, axisLabels, shown, width, plotHeight, rtl, tick, format, valueLabels],
  );

  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const { active, handlers } = useExplorer({
    count: hasData ? n : 0,
    indexAt: (point, box) => {
      if (!horizontal) return model.indexAt(point.x - box.left);
      const found = rows.current.findIndex((row) => {
        if (!row) return false;
        const rect = row.getBoundingClientRect();
        return point.y >= rect.top - 2 && point.y <= rect.bottom + 2;
      });
      return found < 0 ? null : found;
    },
    forward: horizontal ? 'down' : rtl ? 'left' : 'right',
    start: horizontal ? 0 : n - 1,
  });

  // A row's readout sits just over the row, from where its bars begin: it covers bars, never a name.
  const pageDirection = useDirection();
  const rowsBox = useRef<HTMLDivElement>(null);
  const barColumns = useRef<(HTMLDivElement | null)[]>([]);
  const [rowTip, setRowTip] = useState({ x: 0, y: 0, bounds: 0 });
  useLayoutEffect(() => {
    if (!horizontal || active === null) return;
    const row = rows.current[active];
    const bars = barColumns.current[active];
    const box = rowsBox.current;
    if (!row || !bars || !box) return;
    const x = pageDirection === 'rtl' ? bars.offsetLeft + bars.offsetWidth : bars.offsetLeft;
    setRowTip({ x, y: row.offsetTop, bounds: box.clientWidth });
  }, [horizontal, active, pageDirection]);

  const readout = (index: number) =>
    `${labels[index] ?? ''}: ${shown
      .map((item) => `${shown.length > 1 ? `${item.label} ` : ''}${valueText(item, index, format)}`)
      .join('، ')}`;
  const tipRows = (index: number) =>
    shown.map((item, k) => ({
      key: item.key,
      label: item.label,
      value: valueText(item, index, format),
      tone: toneOf(item.tone, k),
    }));

  const frame = cn('flex min-w-0 flex-col gap-4', className);
  const blockHeight = plotHeight + AXIS_BAND;
  if (!hasData) {
    return (
      <div className={frame} aria-busy={loading || undefined}>
        {loading ? (
          <ChartSkeleton height={blockHeight} />
        ) : (
          <ChartEmpty minHeight={blockHeight}>{empty}</ChartEmpty>
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

  const spoken = summary ?? barSummary(label, labels, shown, format);
  const legend =
    shown.length > 1 ? (
      <ChartLegend
        mark="square"
        items={shown.map((item, index) => ({
          key: item.key,
          label: item.label,
          tone: toneOf(item.tone, index),
        }))}
      />
    ) : null;

  if (horizontal) {
    let high = 0;
    let longest = 0;
    for (const item of shown) {
      for (let index = 0; index < n; index += 1) {
        const value = item.values[index];
        if (!isValue(value)) continue;
        high = Math.max(high, value);
        if (valueLabels) longest = Math.max(longest, format(value).replace(/[\u2066-\u2069]/g, '').length);
      }
    }
    // The longest bar stops short of the end by its value's width, so every value fits at its tip.
    const reserve = valueLabels ? longest + 2 : 0;
    return (
      <div className={frame} aria-busy={loading || undefined}>
        {legend}
        <div ref={rowsBox} className="relative">
          <div
            role="img"
            aria-label={spoken}
            className={cn(
              '@container flex flex-col gap-0.5 transition-opacity duration-200',
              loading && 'opacity-50',
            )}
          >
            {labels.map((text, index) => (
              <div
                key={index}
                ref={(node) => {
                  rows.current[index] = node;
                }}
                data-index={index}
                className={cn(
                  '-mx-2 grid items-center gap-x-4 gap-y-1.5 rounded-small px-2 py-1.5 transition-colors duration-120 ease-standard @md:grid-cols-[minmax(0,32%)_minmax(0,1fr)]',
                  active === index && 'bg-surface-muted',
                )}
              >
                <span className="truncate text-sm text-ink">{text}</span>
                <div
                  ref={(node) => {
                    barColumns.current[index] = node;
                  }}
                  className="flex min-w-0 flex-col gap-0.5"
                >
                  {shown.map((item, k) => {
                    const value = item.values[index];
                    const ratio = isValue(value) && high > 0 ? Math.max(0, value) / high : 0;
                    return (
                      <div key={item.key} className="flex h-4 items-center gap-2 text-xs">
                        {ratio > 0 ? (
                          <span
                            className={cn('h-3 shrink-0 rounded-e-[4px]', toneOf(item.tone, k).bg)}
                            style={{ width: `calc((100% - ${reserve}ch) * ${ratio.toFixed(4)})` }}
                          />
                        ) : null}
                        {valueLabels ? (
                          <span className="num font-semibold whitespace-nowrap text-ink-muted">
                            {valueText(item, index, format)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <ExploreLayer
            label={label}
            count={n}
            now={active ?? 0}
            text={readout(active ?? 0)}
            orientation="vertical"
            handlers={handlers}
            className="-inset-x-2 inset-y-0"
          />
          {active !== null ? (
            <ChartTooltip
              title={labels[active] ?? ''}
              rows={tipRows(active)}
              anchor={rowTip}
              placement="above-start"
              bounds={rowTip.bounds}
            />
          ) : null}
        </div>
      </div>
    );
  }

  const activeX = active === null ? null : model.centre(active);
  // The column's bars (and their values) the readout reads, which it never covers.
  const activeEnds = model.bars.filter((item) => item.index === active).map((item) => item.end);
  const marksTop = activeEnds.length
    ? Math.min(model.base, ...activeEnds) - (model.labelled ? LABEL_ROOM : 6)
    : undefined;
  const halo = Math.min(6, model.band * 0.1);
  return (
    <div className={frame} aria-busy={loading || undefined}>
      {legend}
      <div ref={ref} className="relative" style={{ height: blockHeight }}>
        <div
          role="img"
          aria-label={spoken}
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
            {activeX !== null ? (
              <rect
                x={activeX - model.band / 2 + halo}
                y={0}
                width={Math.max(0, model.band - 2 * halo)}
                height={plotHeight}
                rx={6}
                className="fill-surface-muted"
              />
            ) : null}
            {model.grid.map((line) =>
              line.value === 0 ? null : (
                <line
                  key={line.value}
                  x1={model.plotLeft}
                  x2={model.plotRight}
                  y1={line.y}
                  y2={line.y}
                  strokeWidth={1}
                  className="stroke-line"
                />
              ),
            )}
            {model.bars.map((item) => (
              <path
                key={item.key}
                d={item.d}
                className={toneOf(shown[item.series]?.tone, item.series).fill}
              />
            ))}
            <line
              x1={model.plotLeft}
              x2={model.plotRight}
              y1={model.base + 0.5}
              y2={model.base + 0.5}
              strokeWidth={1}
              className="stroke-line-control/40"
            />
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
          {model.labelled
            ? model.bars.map((item) => {
                const owner = shown[item.series];
                return owner ? (
                  <span
                    key={item.key}
                    className="absolute num text-xs leading-none font-semibold whitespace-nowrap text-ink-muted"
                    style={{
                      left: item.x + model.bar / 2,
                      top: item.up ? item.end - 6 : item.end + 6,
                      transform: item.up ? 'translate(-50%, -100%)' : 'translateX(-50%)',
                    }}
                  >
                    {valueText(owner, item.index, format)}
                  </span>
                ) : null;
              })
            : null}
          {model.names.map((item) => (
            <span
              key={item.index}
              data-index={item.index}
              className="absolute num truncate text-center text-xs leading-none text-ink-subtle"
              style={{
                left: item.x,
                top: plotHeight + 10,
                maxWidth: model.nameWidth,
                transform: 'translateX(-50%)',
              }}
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
            rows={tipRows(active)}
            anchor={{ x: activeX, y: model.top }}
            placement="beside"
            bounds={width}
            // Beside the highlighted column, not over it.
            gap={model.band / 2 - halo + 8}
            marksTop={marksTop}
          />
        ) : null}
      </div>
    </div>
  );
}
