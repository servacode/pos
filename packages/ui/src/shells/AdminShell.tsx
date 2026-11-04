import * as RadixDialog from '@radix-ui/react-dialog';
import { useState, type ElementType, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from '../Button';
import { cn } from '../cn';
import type { PolymorphicProps } from '../context';
import { CloseIcon, MenuIcon } from '../icons';

export interface AdminShellProps {
  /** The sidebar: logo, navigation, account. On the start side (the right in Arabic), from 1024 px. */
  sidebar: ReactNode;
  /** The top bar's content: store and user, page actions. */
  topBar: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  /** Fill the parent instead of the screen: previews and the component gallery. */
  framed?: boolean;
}

/**
 * The store admin and panels layout (kit .shell-admin): a 272 px sidebar on the right, a sticky
 * top bar, and the content at most 1280 wide on the canvas (tab 14 › شاشة كبيرة). Under 1024 the
 * sidebar becomes a drawer opened from the top bar's menu button, and closes on any link.
 */
export function AdminShell({ sidebar, topBar, children, contentClassName, framed = false }: AdminShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // A link chosen in the drawer navigates: close it.
  const closeOnLink = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest('a')) setMenuOpen(false);
  };

  return (
    <div
      className={cn(
        framed ? 'h-full overflow-auto' : 'min-h-dvh',
        'bg-canvas lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]',
      )}
    >
      <aside
        className={cn(
          framed ? 'h-full' : 'h-dvh',
          'sticky top-0 hidden flex-col overflow-hidden border-e border-line bg-surface lg:flex',
        )}
      >
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="flex min-h-16 items-center gap-3 px-4 py-2 sm:px-6 lg:px-8">
            <IconButton
              label="القائمة"
              icon={<MenuIcon size={24} />}
              onClick={() => setMenuOpen(true)}
              className="-ms-2 lg:hidden"
            />
            {topBar}
          </div>
        </header>
        <main className={cn('mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8', contentClassName)}>
          {children}
        </main>
      </div>

      <RadixDialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay motion-safe:animate-fade lg:hidden" />
          <RadixDialog.Content
            aria-describedby={undefined}
            onClick={closeOnLink}
            className="fixed inset-y-0 start-0 z-40 flex w-[min(19rem,88vw)] flex-col bg-surface shadow-e3 [--sheet-from:1] motion-safe:animate-sheet-in lg:hidden"
          >
            <RadixDialog.Title className="sr-only">القائمة</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton label="أغلق القائمة" icon={<CloseIcon />} className="absolute end-2 top-3 z-10" />
            </RadixDialog.Close>
            {sidebar}
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </div>
  );
}

/** A sidebar link's look; for a router NavLink: `className={({ isActive }) => navItemClass(isActive)}`. */
export function navItemClass(active: boolean): string {
  return cn(
    'relative flex min-h-12 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-semibold transition-colors duration-120',
    active
      ? 'bg-brand-soft text-brand-ink before:absolute before:inset-y-2.5 before:-start-3 before:w-1 before:rounded-e-full before:bg-brand'
      : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
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
      {label ? (
        <p className="px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-ink-subtle">{label}</p>
      ) : null}
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}
