import type { ReactNode } from 'react';
import { cn } from './cn';
import { AlertCircleIcon, CheckCircleIcon, InfoIcon, WarningIcon, type Icon } from './icons';

type Tone = 'error' | 'warning' | 'info' | 'success';

// هوية 4 › Alert: the tone's tinted fill with a hairline of the tone, its icon, and -ink words.
const TONES: Record<Tone, { className: string; icon: Icon }> = {
  error: { className: 'border-danger/20 bg-danger-soft text-danger-ink', icon: AlertCircleIcon },
  warning: { className: 'border-warning/20 bg-warning-soft text-warning-ink', icon: WarningIcon },
  info: { className: 'border-info/20 bg-info-soft text-info-ink', icon: InfoIcon },
  success: { className: 'border-success/20 bg-success-soft text-success-ink', icon: CheckCircleIcon },
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

/** A message inside a form or a card: an error is read out at once, the others politely. */
export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const { className: toneClass, icon: ToneIcon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-card border px-4 py-3 text-sm', toneClass, className)}
    >
      <ToneIcon className="mt-0.5" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
