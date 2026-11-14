import type { ReactNode } from 'react';
import { cn } from '@serva/ui';

const TONES = {
  /** On a surface or a secondary button. */
  default: 'border-line bg-surface-muted text-ink-muted',
  /** On a primary (brand) button: the button's own ink, a shade lighter. */
  brand: 'border-transparent bg-on-brand/15 text-on-brand',
} as const;

/**
 * A keyboard key beside the action it runs (هوية 4 › kbd: «F12», «Esc»). Decorative: the action
 * carries aria-keyshortcuts for screen readers, so the key never joins its name. Shown where the
 * pointer is a mouse; on a touch screen the hint would only crowd the button (`always` keeps it, for
 * the shortcuts guide itself).
 */
export function Kbd({
  children,
  tone = 'default',
  always = false,
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  always?: boolean;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden="true"
      dir="ltr"
      className={cn(
        'min-w-6 shrink-0 rounded-small border px-1.5 text-center font-sans text-xs/5 font-semibold',
        TONES[tone],
        always ? 'inline-block' : 'hidden pointer-fine:inline-block',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
