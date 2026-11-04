import type { ReactNode } from 'react';
import { cn } from './cn';
import type { Icon } from './icons';

export interface PageHeaderProps {
  /** The page's name: the one <h1> of the screen */
  title: ReactNode;
  /** One line under the title: what this page is for, or the period it covers */
  description?: ReactNode;
  /** A glyph in a brand chip before the title */
  icon?: Icon;
  /** Above the title: a back link, or a small label */
  eyebrow?: ReactNode;
  /** The page's actions, at the end: one primary button at most */
  actions?: ReactNode;
  className?: string;
}

/**
 * The head of every admin screen: the title with its icon and a line of context, and the actions at
 * the end. On a phone the actions drop under the title.
 */
export function PageHeader({
  title,
  description,
  icon: PageIcon,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? <div className="text-sm">{eyebrow}</div> : null}
        <div className="flex min-w-0 items-center gap-3.5">
          {PageIcon ? (
            <span
              aria-hidden="true"
              className="hidden size-12 shrink-0 place-items-center rounded-2xl bg-surface text-brand-ink shadow-e1 ring-1 ring-line sm:grid"
            >
              <PageIcon size={24} />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem] sm:leading-9">
              {title}
            </h1>
            {description ? <p className="text-ink-muted">{description}</p> : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
