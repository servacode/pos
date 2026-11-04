import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { TrendDownIcon, TrendUpIcon, type Icon } from './icons';

export interface CardProps extends ComponentProps<'div'> {
  /** Hover lift for a card that opens something (kit .card.is-click). */
  interactive?: boolean;
  /** The chosen card (kit .card.is-sel). */
  selected?: boolean;
}

/** Groups content (tab 14 › البطاقة): normal, clickable, selected. */
export function Card({ className, interactive = false, selected = false, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border p-4 shadow-e1 sm:p-6',
        selected ? 'border-2 border-brand bg-brand-soft' : 'border-line bg-surface',
        interactive &&
          'transition-[border-color,box-shadow] duration-120 ease-standard hover:border-line-control hover:shadow-e2',
        className,
      )}
      {...rest}
    />
  );
}

/** A card's title row: an optional icon, the title and a line under it, and an action at the end. */
export function CardHeader({
  title,
  description,
  icon: HeaderIcon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: Icon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {HeaderIcon ? (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
            <HeaderIcon />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export type StatTone = 'brand' | 'info' | 'warning' | 'danger' | 'neutral';

const STAT_TONES: Record<StatTone, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  info: 'bg-info-soft text-info-ink',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger-ink',
  neutral: 'bg-surface-muted text-ink-muted',
};

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
  /** A glyph in a soft chip at the tile's end, coloured by `tone` */
  icon?: Icon;
  tone?: StatTone;
  className?: string;
}

/**
 * A KPI on the owner's dashboard (tab 14 › بطاقة المؤشر): the label, the number in equal-width
 * digits, and the change with an arrow, a colour and words, never colour alone.
 */
export function StatTile({
  label,
  value,
  trend,
  footnote,
  hero = false,
  icon: TileIcon,
  tone = 'brand',
  className,
}: StatTileProps) {
  const TrendIcon = trend?.direction === 'down' ? TrendDownIcon : TrendUpIcon;
  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink-muted">{label}</p>
        {TileIcon ? (
          <span className={cn('-mt-1 grid size-10 shrink-0 place-items-center rounded-xl', STAT_TONES[tone])}>
            <TileIcon />
          </span>
        ) : null}
      </div>
      <p className={cn('num font-bold tracking-tight text-ink', hero ? 'text-total' : 'text-kpi')}>{value}</p>
      {footnote ? <p className="text-sm text-ink-muted">{footnote}</p> : null}
      {trend ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem]">
          <span
            className={cn(
              'inline-flex items-center gap-1 font-semibold',
              trend.direction === 'up' ? 'text-success-ink' : 'text-danger-ink',
            )}
          >
            <TrendIcon size={16} />
            <span className="sr-only">{trend.direction === 'up' ? 'ارتفاع' : 'انخفاض'}</span>
            <bdi className="num">{trend.value}</bdi>
          </span>
          {trend.comparison ? <span className="text-ink-muted">{trend.comparison}</span> : null}
        </p>
      ) : null}
    </Card>
  );
}
