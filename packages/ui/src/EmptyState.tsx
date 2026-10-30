import type { ReactNode } from 'react';
import { cn } from './cn';
import type { Icon } from './icons';

export interface EmptyStateProps {
  icon: Icon;
  /** One sentence: what will show here («لا زبائن بعد.»). */
  title: string;
  description?: ReactNode;
  /** One primary action… */
  action?: ReactNode;
  /** …and an optional secondary one (tab 14 › الحالات الفارغة). */
  secondaryAction?: ReactNode;
  className?: string;
}

/** A list with no data yet (kit .empty): the drawing on brand-soft, a sentence and the next step. */
export function EmptyState({
  icon: EmptyIcon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="grid size-24 place-items-center rounded-full bg-brand-soft text-brand-ink">
        <EmptyIcon size={48} />
      </span>
      <p className="text-lg font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-ink-muted">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
