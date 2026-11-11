import type { ReactNode } from 'react';
import { IconChip } from './Card';
import { cn } from './cn';

export interface PageHeaderProps {
  /** The page's one title, its h1. */
  title: ReactNode;
  /** One line under the title: what the page holds («101 قطعة في 16 موديلاً»). */
  description?: ReactNode;
  /** A picture in a soft square before the title. */
  icon?: ReactNode;
  /** The page's actions, at the end: one primary button at most. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The top of a page (هوية 4 › Page title): the title in 24 bold with a line of description under it
 * and an optional icon at the start, the actions at the end. On a narrow screen the actions wrap
 * under the title.
 */
export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        {icon ? <IconChip size={description ? 'lg' : 'md'}>{icon}</IconChip> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
