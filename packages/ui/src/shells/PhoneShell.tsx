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
 * The owner's phone, rep and customer pages (kit .shell-phone): a 56 px top bar, scrolling content,
 * an optional bottom action and the five tabs, all clear of the notch and home bar (safe areas).
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
      <header className="flex min-h-14 items-center gap-3 border-b border-line bg-surface px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        {top}
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</main>
      {action ? <div className="border-t border-line bg-surface px-4 pt-3 pb-6">{action}</div> : null}
      {tabs ? (
        <nav
          aria-label={tabsLabel}
          className="border-t border-line bg-surface px-1 pt-1.5 pb-[max(1.375rem,env(safe-area-inset-bottom))]"
        >
          <ul className="grid grid-cols-5">{tabs}</ul>
        </nav>
      ) : null}
    </div>
  );
}

/** One bottom tab: icon over a short word, 52 high; «بانتظارك» carries a count. */
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
          'relative flex h-13 flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-xs/4 font-semibold',
          active ? 'text-brand-ink' : 'text-ink-muted hover:text-ink',
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
        {count ? (
          <span className="num absolute top-0.5 start-[calc(50%+0.375rem)] min-w-4.5 rounded-full bg-brand px-1 text-center text-[0.6875rem]/4.5 font-bold text-on-brand">
            {count}
          </span>
        ) : null}
      </Component>
    </li>
  );
}
