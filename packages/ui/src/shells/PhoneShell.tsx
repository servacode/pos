import type { ElementType, ReactNode } from 'react';
import { cn } from '../cn';
import type { PolymorphicProps } from '../context';

export interface PhoneShellProps {
  /** The top bar's content: a title, back, an action. */
  top: ReactNode;
  children: ReactNode;
  /** A primary action fixed above the tabs (kit .ph-action). */
  action?: ReactNode;
  /** The five bottom tabs: الرئيسية · بانتظارك · المبيعات · المنتجات · المزيد. */
  tabs?: ReactNode;
  tabsLabel?: string;
  /** Fill the parent instead of the screen: previews and the component gallery. */
  framed?: boolean;
}

/**
 * The owner's phone, rep and customer pages (kit .shell-phone; هوية 4): a 56 px top bar on the
 * surface, scrolling content on the page, an optional bottom action and the five tabs, all clear of
 * the notch and home bar (safe areas).
 */
export function PhoneShell({
  top,
  children,
  action,
  tabs,
  tabsLabel = 'القائمة الرئيسية',
  framed = false,
}: PhoneShellProps) {
  return (
    <div className={cn(framed ? 'h-full' : 'h-dvh', 'flex flex-col overflow-hidden bg-canvas')}>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        {top}
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-5 pb-6">{children}</main>
      {action ? (
        <div className={cn('shrink-0 border-t border-line bg-surface px-4 pt-3', tabs ? 'pb-3' : 'pb-6')}>
          {action}
        </div>
      ) : null}
      {tabs ? (
        <nav
          aria-label={tabsLabel}
          className="shrink-0 border-t border-line bg-surface px-2 pt-1 pb-[max(1.375rem,env(safe-area-inset-bottom))]"
        >
          <ul className="grid grid-cols-5">{tabs}</ul>
        </nav>
      ) : null}
    </div>
  );
}

/**
 * One bottom tab: icon over a short word, 52 high; «بانتظارك» carries a count. The open one is in
 * brand ink under the brand's short bar (هوية 4: the active-nav indicator).
 */
export function PhoneTab<C extends ElementType = 'a'>({
  as,
  active = false,
  icon,
  count,
  className,
  children,
  ...rest
}: PolymorphicProps<
  C,
  { active?: boolean; icon: ReactNode; count?: number; className?: string; children: ReactNode }
>) {
  const Component: ElementType = as ?? 'a';
  return (
    <li className="flex">
      <Component
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex h-13 flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-xs/4 font-semibold transition-colors duration-120 ease-standard focus-visible:-outline-offset-2',
          active ? 'text-brand-ink' : 'text-ink-muted hover:text-ink',
          className,
        )}
        {...rest}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-1/4 -top-1 h-0.75 rounded-b-full bg-linear-to-r from-brand to-accent"
          />
        ) : null}
        {icon}
        {children}
        {count ? (
          <span className="num absolute start-[calc(50%+0.375rem)] top-0.5 min-w-4.5 rounded-full bg-brand px-1 text-center text-[0.6875rem]/4.5 font-bold text-on-brand ring-2 ring-surface">
            {count}
          </span>
        ) : null}
      </Component>
    </li>
  );
}
