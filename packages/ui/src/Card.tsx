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
        'rounded-card p-5 shadow-e1 sm:p-6',
        selected ? 'bg-brand-soft ring-2 ring-brand' : 'bg-surface ring-1 ring-line/70',
        interactive &&
          'transition-[box-shadow,transform] duration-120 ease-standard hover:-translate-y-0.5 hover:shadow-e2',
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
    <div className={cn('mb-4 flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <IconChip>{icon}</IconChip> : null}
        <div className="flex min-w-0 flex-col">
          <h3 className="text-base font-bold text-ink">{title}</h3>
          {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {action}
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

/** A picture in a soft rounded square: card titles, stat tiles, list rows (هوية 3). */
export function IconChip({
  tone = 'brand',
  size = 'md',
  className,
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center',
        size === 'sm'
          ? 'size-8 rounded-[0.625rem]'
          : size === 'lg'
            ? 'size-12 rounded-2xl'
            : 'size-10 rounded-xl',
        CHIP_TONES[tone],
        className,
      )}
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
  icon,
  iconTone = 'brand',
  className,
}: StatTileProps) {
  const TrendIcon = trend?.direction === 'down' ? TrendDownIcon : TrendUpIcon;
  return (
    <Card className={cn('relative flex flex-col gap-2', className)}>
      {icon ? (
        <IconChip tone={iconTone} size="sm" className="absolute end-5 top-5 sm:end-6 sm:top-6">
          {icon}
        </IconChip>
      ) : null}
      <p className={cn('text-sm font-medium text-ink-muted', icon ? 'pe-10' : null)}>{label}</p>
      <p className={cn('num font-bold tracking-tight text-ink', hero ? 'text-total' : 'text-kpi')}>{value}</p>
      {footnote ? <p className="text-sm text-ink-muted">{footnote}</p> : null}
      {trend ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[0.8125rem]">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
              trend.direction === 'up'
                ? 'bg-success-soft text-success-ink'
                : 'bg-danger-soft text-danger-ink',
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
