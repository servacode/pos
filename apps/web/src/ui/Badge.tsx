import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

type Tone = 'neutral' | 'brand';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-muted ring-line',
  brand: 'bg-brand-soft text-brand-ink ring-brand/20',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
