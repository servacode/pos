import { useState, type ReactNode } from 'react';
import { cn, ExpandIcon, WarningIcon } from '@serva/ui';

/**
 * «N تنبيهات»: every warning of the cart in one collapsible row, so two of them never crush the
 * lines. Closed it is one fixed-height row (red when something blocks the sale, amber otherwise);
 * open it lists them, capped and scrolling by itself. It opens by itself when a manager's code is
 * what the sale waits for, so the button is in view.
 */
export function CartWarnings({
  title,
  danger,
  forceOpen,
  children,
}: {
  /** «3 تنبيهات» */
  title: string;
  danger: boolean;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-11 w-full items-center gap-2.5 rounded-card border px-3 text-start text-sm font-semibold transition-colors duration-120 ease-standard',
          danger
            ? 'border-danger/20 bg-danger-soft text-danger-ink'
            : 'border-warning/20 bg-warning-soft text-warning-ink',
        )}
      >
        <WarningIcon size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ExpandIcon size={20} className={cn('shrink-0 transition-transform', shown && 'rotate-180')} />
      </button>
      {shown ? (
        <div className="flex max-h-[26dvh] flex-col gap-2 overflow-y-auto overscroll-contain">{children}</div>
      ) : null}
    </div>
  );
}
