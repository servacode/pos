import { useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { DensityProvider } from '../context';

/**
 * The cashier's status bar (kit .cash-status; هوية 4): 56 high on the surface, a hairline under it,
 * above every layer (z 60).
 */
export function CashierStatusBar({ children }: { children: ReactNode }) {
  return (
    <header className="relative z-60 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 shadow-e1">
      {children}
    </header>
  );
}

export interface CashierShellProps {
  /** Usually a <CashierStatusBar>. */
  statusBar: ReactNode;
  /** The cart, on the start side (the right in Arabic), 420 wide. Omit for full-width screens. */
  cart?: ReactNode;
  /** The items area, or a whole screen (login code) when there is no cart. */
  children: ReactNode;
  mainClassName?: string;
  /** Fill the parent instead of the screen: previews and the component gallery. */
  framed?: boolean;
  /**
   * On a phone the cart and the items cannot sit side by side: one shows at a time, switched by two
   * tabs. Controlled when `mobileView` is given, else the shell keeps it (starting on the items).
   * Tablets and desktops show both, as ever.
   */
  mobileView?: 'items' | 'cart';
  onMobileView?: (view: 'items' | 'cart') => void;
  /** The cart tab's count (pieces in the cart), shown beside its name on a phone */
  cartBadge?: ReactNode;
}

/**
 * The cashier layout (kit .shell-cashier): status bar on top, the cart first in the markup so it
 * sits on the right, the items beside it. Fills the screen without scrolling; touch density inside.
 */
export function CashierShell({
  statusBar,
  cart,
  children,
  mainClassName,
  framed = false,
  mobileView,
  onMobileView,
  cartBadge,
}: CashierShellProps) {
  const [own, setOwn] = useState<'items' | 'cart'>('items');
  const view = mobileView ?? own;
  const show = (next: 'items' | 'cart') => (onMobileView ? onMobileView(next) : setOwn(next));
  return (
    <DensityProvider density="touch">
      <div
        className={cn(
          framed ? 'h-full' : 'h-dvh',
          'grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-canvas',
        )}
      >
        {statusBar}
        {cart ? (
          <div className="flex min-h-0 min-w-0 flex-col gap-2 p-2 md:grid md:grid-cols-[minmax(0,26.25rem)_minmax(0,1fr)] md:gap-4 md:p-4">
            {/* A phone: two tabs, one view at a time (no side-by-side, no sideways scroll). */}
            <div
              role="group"
              aria-label="عرض الشاشة"
              className="grid shrink-0 auto-cols-fr grid-flow-col gap-1 rounded-control bg-surface-muted p-1 md:hidden"
            >
              {(
                [
                  ['items', 'عرض الأصناف'],
                  ['cart', 'عرض السلة'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => show(id)}
                  className={cn(
                    'flex min-h-12 items-center justify-center gap-2 rounded-small px-3 text-base font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                    view === id ? 'bg-surface text-ink shadow-e1 ring-1 ring-line' : 'text-ink-muted',
                  )}
                >
                  {label}
                  {id === 'cart' && cartBadge ? (
                    <span className="num grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-xs font-bold text-on-brand">
                      {cartBadge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {/* هوية 4: the cart is a panel on the hairline, the items lie on the page beside it. */}
            <aside
              aria-label="السلة"
              className={cn(
                'min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-e1 md:flex',
                view === 'cart' ? 'flex' : 'hidden',
              )}
            >
              {cart}
            </aside>
            <main
              className={cn(
                'min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-0.5 md:flex',
                view === 'items' ? 'flex' : 'hidden',
                mainClassName,
              )}
            >
              {children}
            </main>
          </div>
        ) : (
          <main className={cn('min-h-0 overflow-y-auto', mainClassName)}>{children}</main>
        )}
      </div>
    </DensityProvider>
  );
}
