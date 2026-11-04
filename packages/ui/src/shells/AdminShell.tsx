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
        'bg-canvas lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]',
      )}
    >
      {/* هوية 3: the sidebar floats as a white panel on the grey page. */}
      <aside className={cn(framed ? 'h-full' : 'h-dvh', 'sticky top-0 hidden p-3 lg:block')}>
        <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-[1.5rem] bg-surface px-3 py-4 shadow-e1 ring-1 ring-line/70">
          {sidebar}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 bg-canvas/85 backdrop-blur-md">
          <div className="flex min-h-18 items-center gap-3 px-4 py-3 sm:px-6 lg:ps-3 lg:pe-8">{topBar}</div>
        </header>
        <main
          className={cn(
            'mx-auto w-full max-w-7xl flex-1 px-4 pt-2 pb-10 sm:px-6 lg:ps-3 lg:pe-8',
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/** A sidebar link's look; for a router NavLink: `className={({ isActive }) => navItemClass(isActive)}`. */
export function navItemClass(active: boolean): string {
  return cn(
    'flex min-h-12 items-center gap-3 rounded-2xl px-3.5 text-[0.9375rem] transition-[background-color,color,box-shadow] duration-120',
    active
      ? 'bg-brand font-semibold text-on-brand shadow-[0_4px_12px_-2px_color-mix(in_oklab,var(--color-brand)_45%,transparent)]'
      : 'font-medium text-ink-muted hover:bg-surface-muted hover:text-ink',
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
        <span
          className={cn(
            'num min-w-5.5 rounded-full px-1.5 text-center text-xs/5.5 font-bold',
            active ? 'bg-on-brand text-brand-ink' : 'bg-brand text-on-brand',
          )}
        >
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
      {label ? <p className="px-3 pt-4 pb-1 text-xs font-semibold text-ink-subtle">{label}</p> : null}
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}
