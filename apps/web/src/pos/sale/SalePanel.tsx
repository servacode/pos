import type { ReactNode } from 'react';
import { cn, IconChip } from '@serva/ui';

/**
 * The frame of everything that opens beside the cart in place of the items (هوية 4 › Card): the
 * variant picker, quantity and discount, the hold, the store's orders, the tables, the serial
 * number, the shortcuts. One surface on a hairline, a header with the title, one line under it and
 * the panel's own way back at the end, then the body. Never a dialog over the sale.
 */
export function SalePanel({
  label,
  title,
  subtitle,
  icon,
  media,
  actions,
  footer,
  children,
  className,
  bodyClassName,
}: {
  /** The region's name for screen readers; the title when left out. */
  label?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A small picture in a soft square before the title. */
  icon?: ReactNode;
  /** A larger picture in its place (the model's photo). */
  media?: ReactNode;
  /** At the header's end: the way back («أغلق», «إلغاء») and the panel's own extra action. */
  actions?: ReactNode;
  /** A bar under the body for the panel's main action, kept in view while the body scrolls. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cn(
        'flex min-h-0 shrink-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1 motion-safe:animate-rise',
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        {media ?? (icon ? <IconChip size="md">{icon}</IconChip> : null)}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="truncate text-sm text-ink-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('flex min-h-0 flex-col gap-5 overflow-y-auto p-5', bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface-muted/40 px-5 py-4">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
