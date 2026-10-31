import { cn } from './cn';
import { WarningIcon } from './icons';

export interface TestModeRibbonProps {
  className?: string;
}

/**
 * A thin strip across the top of every page while the local server runs in test mode (sign-up
 * codes shown on screen). It has no close button, so nobody mistakes the copy for the real service.
 */
export function TestModeRibbon({ className }: TestModeRibbonProps) {
  return (
    <div
      role="note"
      className={cn(
        'flex min-h-6 items-center justify-center gap-1.5 border-b border-warning/30 bg-warning-soft px-3 py-0.5 text-xs font-semibold text-warning-ink',
        className,
      )}
    >
      <WarningIcon size={16} />
      نسخة تجربة على الخادم المحلي
    </div>
  );
}
