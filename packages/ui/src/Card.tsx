import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { TrendDownIcon, TrendUpIcon } from './icons';

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

/** A card's title row: the title at the start, an action at the end. */
export function CardHeader({
  title,
  action,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {action}
    </div>
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
  className?: string;
}

/**
 * A KPI on the owner's dashboard (tab 14 › بطاقة المؤشر): the label, the number in equal-width
 * digits, and the change with an arrow, a colour and words, never colour alone.
 */
export function StatTile({ label, value, trend, footnote, hero = false, className }: StatTileProps) {
  const TrendIcon = trend?.direction === 'down' ? TrendDownIcon : TrendUpIcon;
  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <p className="text-sm font-semibold text-ink-muted">{label}</p>
      <p className={cn('num font-bold text-ink', hero ? 'text-total' : 'text-kpi')}>{value}</p>
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
