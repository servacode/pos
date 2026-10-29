import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { AlertCircleIcon, CheckCircleIcon, InfoIcon, type Icon } from './icons';

type Tone = 'error' | 'info' | 'success';

const TONES: Record<Tone, { className: string; icon: Icon }> = {
  error: { className: 'border-danger/25 bg-danger-soft text-danger-ink', icon: AlertCircleIcon },
  info: { className: 'border-info-ink/15 bg-info-soft text-info-ink', icon: InfoIcon },
  success: { className: 'border-brand/25 bg-brand-soft text-brand-ink', icon: CheckCircleIcon },
};

interface AlertProps {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const { className: toneClass, icon: ToneIcon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-control border px-4 py-3 text-sm', toneClass, className)}
    >
      <ToneIcon className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
