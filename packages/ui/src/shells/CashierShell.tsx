import type { ReactNode } from 'react';
import { cn } from '../cn';
import { DensityProvider } from '../context';

/** The cashier's status bar (kit .cash-status): 44 px, above every layer (z 60). */
export function CashierStatusBar({ children }: { children: ReactNode }) {
  return (
    <header className="relative z-60 flex h-11 items-center gap-3 border-b border-line bg-surface px-4">
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
}: CashierShellProps) {
  return (
    <DensityProvider density="touch">
      <div
        className={cn(
          framed ? 'h-full' : 'h-dvh',
          'grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-canvas',
        )}
      >
        {statusBar}
        {cart ? (
          <div className="grid min-h-0 grid-cols-[minmax(0,26.25rem)_minmax(0,1fr)]">
            <aside aria-label="السلة" className="flex min-h-0 flex-col border-e border-line bg-surface">
              {cart}
            </aside>
            <main className={cn('flex min-h-0 flex-col gap-3 overflow-y-auto p-4', mainClassName)}>
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
