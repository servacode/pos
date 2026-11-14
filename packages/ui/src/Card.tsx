import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { TrendDownIcon, TrendUpIcon } from './icons';

export interface CardProps extends ComponentProps<'div'> {
  /** Hover lift for a card that opens something (kit .card.is-click). */
  interactive?: boolean;
  /** The chosen card (kit .card.is-sel). */
  selected?: boolean;
}

/**
 * Groups content (هوية 4 › Card): a surface on a hairline border with a soft lift, corner 16,
 * padding 20 (24 from 640 px). Normal, clickable (raised on hover) or selected (brand-soft, brand edge).
 */
export function Card({ className, interactive = false, selected = false, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border p-5 shadow-e1 sm:p-6',
        selected ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-surface',
        interactive &&
          'transition-[box-shadow,border-color,translate] duration-120 ease-standard hover:shadow-e2 motion-safe:hover:-translate-y-0.5',
        interactive && !selected && 'hover:border-line-control/50',
        className,
      )}
      {...rest}
    />
  );
}

/**
 * A card's title row (هوية 4 › CardHeader): an optional 36 icon tile, the title and a line of
 * description at the start, the action at the end.
 */
export function CardHeader({
  title,
  action,
  icon,
  description,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  /** A small picture in a soft square before the title. */
  icon?: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-center justify-between gap-4', className)}>
      <div className={cn('flex min-w-0 flex-1 gap-3', description ? 'items-start' : 'items-center')}>
        {icon ? <IconChip>{icon}</IconChip> : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

const CHIP_TONES = {
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  info: 'bg-info-soft text-info-ink',
  neutral: 'bg-surface-muted text-ink-muted',
} as const;

const CHIP_SIZES = {
  sm: 'size-8 rounded-small',
  md: 'size-9 rounded-small',
  lg: 'size-12 rounded-card',
} as const;

/**
 * A picture in a soft square: card titles, stat tiles, list rows (هوية 4): 32 or 36 with corner 8,
 * 48 with corner 16.
 */
export function IconChip({
  tone = 'brand',
  size = 'md',
  className,
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  size?: keyof typeof CHIP_SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center', CHIP_SIZES[size], CHIP_TONES[tone], className)}
    >
      {children}
    </span>
  );
}

export interface StatTileProps {
  label: ReactNode;
  /** The number, usually a <Money> or a count in a `num` span. */
  value: ReactNode;
  /** The change against the previous period, e.g. «+12%», with its comparison text. */
  trend?: { direction: 'up' | 'down'; value: ReactNode; comparison?: ReactNode };
  /** A small note under the number, e.g. «مؤقت» or the dollar amount. */
  footnote?: ReactNode;
  /** The hero tile at the top of the dashboard: a bigger number (tab 14 › لوحات المؤشرات). */
  hero?: boolean;
  /** A picture beside the label, in a soft square. */
  icon?: ReactNode;
  iconTone?: keyof typeof CHIP_TONES;
  /**
   * The recent values, oldest first, drawn as a small line under the number. Time runs from the
   * right in Arabic (tab 14 › محور الزمن: the oldest on the right, like the trend arrows, which are
   * mirrored too), so the line is mirrored there. Decorative: the number and the trend say it.
   */
  sparkline?: readonly number[];
  className?: string;
}

// The symbol of a <Money> in the number (its data-money-unit span): smaller and softer (هوية 4).
const VALUE_UNIT =
  '[&_[data-money-unit]]:text-sm [&_[data-money-unit]]:font-semibold [&_[data-money-unit]]:text-ink-subtle';
const HERO_UNIT =
  '[&_[data-money-unit]]:text-base [&_[data-money-unit]]:font-semibold [&_[data-money-unit]]:text-ink-subtle';

/**
 * A KPI on the owner's dashboard (هوية 4 › StatTile): the label with the change in a pill at its
 * end, then the number in equal-width digits with its unit smaller and softer. The change has an
 * arrow, a colour and words, never colour alone, and what it is measured against sits just under
 * the pill.
 *
 * The DOM keeps the reading order: the label, its number right after it, the footnote, then the
 * change and its comparison together («مبيعات اليوم، 1,284,500 ل.س، ارتفاع 12%، عن الخميس الماضي»).
 * The grid draws the pill beside the label and the comparison under the pill.
 */
export function StatTile({
  label,
  value,
  trend,
  footnote,
  hero = false,
  icon,
  iconTone = 'brand',
  sparkline,
  className,
}: StatTileProps) {
  const TrendIcon = trend?.direction === 'down' ? TrendDownIcon : TrendUpIcon;
  return (
    <Card
      className={cn(
        'grid content-start gap-x-3 gap-y-3',
        trend ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
        className,
      )}
    >
      <p className={cn('min-w-0 text-sm text-ink-muted', icon ? 'flex items-center gap-2.5' : null)}>
        {icon ? (
          <IconChip tone={iconTone} size="sm">
            {icon}
          </IconChip>
        ) : null}
        {label}
      </p>
      <p
        className={cn(
          'col-span-full num font-bold tracking-tight text-ink',
          hero ? cn('text-total', HERO_UNIT) : cn('text-kpi', VALUE_UNIT),
        )}
      >
        {value}
      </p>
      {sparkline && sparkline.length > 1 ? <Sparkline values={sparkline} /> : null}
      {footnote ? <p className="col-span-full text-sm text-ink-muted">{footnote}</p> : null}
      {trend ? (
        <span
          className={cn(
            'col-start-2 row-start-1 inline-flex items-center gap-1 self-center rounded-full px-2 py-0.5 text-xs font-semibold',
            trend.direction === 'up' ? 'bg-success-soft text-success-ink' : 'bg-danger-soft text-danger-ink',
          )}
        >
          <TrendIcon size={16} />
          <span className="sr-only">{trend.direction === 'up' ? 'ارتفاع' : 'انخفاض'}</span>
          <bdi className="num">{trend.value}</bdi>
        </span>
      ) : null}
      {trend?.comparison ? (
        // Its own row across the tile, so a long comparison never squeezes the label; pulled up
        // to 4 under the pill and aligned to its edge, so it reads as the pill's.
        <p className="col-span-full row-start-2 -mt-2 text-end text-xs text-ink-subtle">{trend.comparison}</p>
      ) : null}
    </Card>
  );
}

const SPARK_WIDTH = 200;
const SPARK_HEIGHT = 40;

/** The small brand line of a StatTile, with a soft fill fading to nothing under it. */
function Sparkline({ values }: { values: readonly number[] }) {
  const fill = `spark-${useId().replace(/[^\w-]/g, '')}`;
  const low = Math.min(...values);
  const range = Math.max(...values) - low || 1;
  // Nothing before the latest day: a line climbing from zero to it is only the jump between two
  // days, not a trend. A level dashed baseline says «no history».
  const flat = values.slice(0, -1).every((v) => v === 0) && (values.at(-1) ?? 0) > 0;
  const points = values.map((v, index) => {
    const x = (index / (values.length - 1)) * SPARK_WIDTH;
    const y = flat ? SPARK_HEIGHT / 2 : 2 + (1 - (v - low) / range) * (SPARK_HEIGHT - 4);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${points.join(' L')}`;
  return (
    <svg
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className="col-span-full h-9 w-full text-brand rtl:-scale-x-100"
    >
      <defs>
        <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {flat ? null : (
        <path d={`${line} L${SPARK_WIDTH} ${SPARK_HEIGHT} L0 ${SPARK_HEIGHT} Z`} fill={`url(#${fill})`} />
      )}
      <path
        d={line}
        fill="none"
        stroke={flat ? 'var(--color-line-control)' : 'currentColor'}
        strokeDasharray={flat ? '4 5' : undefined}
        strokeWidth={flat ? '1.5' : '2'}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
