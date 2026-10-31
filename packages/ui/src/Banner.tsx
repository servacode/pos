import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  CloseIcon,
  InfoIcon,
  OfflineIcon,
  WarningIcon,
  type Icon,
} from './icons';

export type BannerTone = 'warning' | 'danger' | 'info' | 'success' | 'neutral' | 'offline';

const TONES: Record<BannerTone, { className: string; icon: Icon }> = {
  warning: { className: 'bg-warning-soft text-warning-ink', icon: WarningIcon },
  danger: { className: 'bg-danger-soft text-danger-ink', icon: AlertCircleIcon },
  info: { className: 'bg-info-soft text-info-ink', icon: InfoIcon },
  success: { className: 'bg-success-soft text-success-ink', icon: CheckCircleIcon },
  neutral: { className: 'bg-surface-muted text-ink', icon: InfoIcon },
  offline: { className: 'bg-warning-soft text-warning-ink', icon: OfflineIcon },
};

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** One action at the end, e.g. «جدّد الاشتراك». */
  action?: ReactNode;
  /** Shows a close button when the banner may be hidden. */
  onDismiss?: () => void;
  className?: string;
}

/**
 * A state of the whole page (tab 14 › الشريط): a trial running out, maintenance, no internet in the
 * admin. Admin only: never on the sale screen, where the connection pill says it instead.
 */
export function Banner({ tone = 'info', title, children, action, onDismiss, className }: BannerProps) {
  const { className: toneClass, icon: ToneIcon } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-center gap-3 rounded-control px-4 py-3 text-sm', toneClass, className)}
    >
      <ToneIcon />
      <div className="flex min-w-0 flex-1 flex-col">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(!title && 'font-semibold')}>{children}</div> : null}
      </div>
      {action}
      {onDismiss ? (
        <IconButton
          label="أخفِ التنبيه"
          size="sm"
          icon={<CloseIcon />}
          onClick={onDismiss}
          className="-me-2 text-current hover:bg-surface/40 hover:text-current"
        />
      ) : null}
    </div>
  );
}
