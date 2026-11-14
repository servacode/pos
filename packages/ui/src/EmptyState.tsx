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

/**
 * A list with no data yet (هوية 4 › Empty state): a dashed frame, and in its middle the picture on
 * a 48 brand-soft tile, a sentence, one line of help and the next step.
 */
export function EmptyState({
  icon: EmptyIcon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border border-dashed border-line-control/50 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="mb-2 grid size-12 place-items-center rounded-card bg-brand-soft text-brand">
        <EmptyIcon size={24} />
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-ink-muted">{description}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
