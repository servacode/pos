import type { ElementType, ReactNode } from 'react';
import { cn } from '../cn';
import type { PolymorphicProps } from '../context';

export interface AdminShellProps {
  /** The sidebar: logo, navigation, plan. On the start side (the right in Arabic), from 1024 px. */
  sidebar: ReactNode;
  /** The top bar's content: store and user, page actions. */
  topBar: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  /** Fill the parent instead of the screen: previews and the component gallery. */
  framed?: boolean;
}

/**
 * The store admin and panels layout (kit .shell-admin): a 264 px sidebar on the right, a sticky
 * 64 px top bar, and the content at most 1280 wide (tab 14 › شاشة كبيرة). Under 1024 the sidebar
 * hides and the top bar stays.
 */
export function AdminShell({ sidebar, topBar, children, contentClassName, framed = false }: AdminShellProps) {
  return (
    <div
      className={cn(
        framed ? 'h-full overflow-auto' : 'min-h-dvh',
        'lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]',
      )}
    >
      <aside
        className={cn(
          framed ? 'h-full' : 'h-dvh',
          'sticky top-0 hidden flex-col gap-8 overflow-y-auto border-e border-line bg-surface px-3 py-4 lg:flex',
        )}
      >
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-surface">
          <div className="flex min-h-16 items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">{topBar}</div>
        </header>
        <main className={cn('mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8', contentClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** A sidebar link's look; for a router NavLink: `className={({ isActive }) => navItemClass(isActive)}`. */
export function navItemClass(active: boolean): string {
  return cn(
    'flex min-h-12 items-center gap-3 rounded-control px-3 font-semibold transition-colors duration-120',
    active ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  );
}

/** A sidebar link with its icon and an optional count («بانتظارك 3»). */
export function NavItem<C extends ElementType = 'a'>({
  as,
  active = false,
  icon,
  count,
  className,
  children,
  ...rest
}: PolymorphicProps<
  C,
  { active?: boolean; icon?: ReactNode; count?: number; className?: string; children: ReactNode }
>) {
  const Component: ElementType = as ?? 'a';
  return (
    <Component
      aria-current={active ? 'page' : undefined}
      className={cn(navItemClass(active), className)}
      {...rest}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count ? (
        <span className="num min-w-5.5 rounded-full bg-brand px-1.5 text-center text-xs/5.5 font-bold text-on-brand">
          {count}
        </span>
      ) : null}
    </Component>
  );
}

/** A titled group of sidebar links (kit .nav-group). */
export function NavGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label ? <p className="px-3 pt-3.5 pb-1 text-xs font-semibold text-ink-subtle">{label}</p> : null}
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}
