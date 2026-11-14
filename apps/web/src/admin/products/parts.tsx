import { useId, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Card, CONTROL_HEIGHT, IconChip, cn, useDensity } from '@serva/ui';

/**
 * One titled part of a products screen (هوية 4 › Card + CardHeader): the 36 icon tile, the title, a
 * line of description and an action at the end, then the content. The title is an h2 under the
 * page's h1, and the part is a region named by it, so «في كل الفروع» and «المقاسات والألوان» can be
 * reached by name. (CardHeader draws the same header with an h3.)
 */
export function SectionCard({
  title,
  description,
  icon,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card className={cn('min-w-0', className)}>
      <section aria-labelledby={id} className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className={cn('flex min-w-0 flex-1 gap-3', description ? 'items-start' : 'items-center')}>
            {icon ? <IconChip>{icon}</IconChip> : null}
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={id} className="text-lg font-semibold text-ink">
                {title}
              </h2>
              {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
        {children}
      </section>
    </Card>
  );
}

type LinkVariant = 'primary' | 'secondary' | 'ghost';

// The Button's own looks (packages/ui › Button.tsx), for a router link that leads somewhere: the
// shared Button only renders a <button>.
const LINK_VARIANTS: Record<LinkVariant, string> = {
  primary:
    'bg-brand text-on-brand inset-shadow-[0_1px_0] inset-shadow-on-brand/15 shadow-[0_1px_2px] shadow-brand/30 hover:bg-brand-hover dark:inset-shadow-ink/15',
  secondary: 'border border-line-control/50 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
};

/** A link drawn as a button (primary, secondary or ghost), at the density's control height. */
export function ButtonLink({
  variant = 'secondary',
  icon,
  className,
  children,
  ...rest
}: Omit<LinkProps, 'className'> & { variant?: LinkVariant; icon?: ReactNode; className?: string }) {
  const density = useDensity();
  return (
    <Link
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold whitespace-nowrap select-none',
        'transition-[color,background-color,border-color,box-shadow,scale] duration-120 ease-standard motion-safe:active:scale-[0.98]',
        CONTROL_HEIGHT[density],
        LINK_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </Link>
  );
}

/** A label and its value in a side card's list (المتغيّرات · 8). */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{children}</dd>
    </div>
  );
}
