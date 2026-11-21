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

// هوية 4 › Alert / banner: the tone's tinted fill with a hairline of the tone, its icon, -ink words.
const TONES: Record<BannerTone, { className: string; icon: Icon }> = {
  warning: { className: 'border-warning/20 bg-warning-soft text-warning-ink', icon: WarningIcon },
  danger: { className: 'border-danger/20 bg-danger-soft text-danger-ink', icon: AlertCircleIcon },
  info: { className: 'border-info/20 bg-info-soft text-info-ink', icon: InfoIcon },
  success: { className: 'border-success/20 bg-success-soft text-success-ink', icon: CheckCircleIcon },
  neutral: { className: 'border-line bg-surface-muted text-ink', icon: InfoIcon },
  offline: { className: 'border-warning/20 bg-warning-soft text-warning-ink', icon: OfflineIcon },
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
      className={cn('flex items-center gap-3 rounded-card border px-4 py-3 text-sm', toneClass, className)}
    >
      <ToneIcon />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(!title && 'font-semibold')}>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      {onDismiss ? (
        <IconButton
          label="أخفِ التنبيه"
          size="sm"
          icon={<CloseIcon />}
          onClick={onDismiss}
          // Important (!): the ghost button's own ink would win the cascade, and the cross takes the
          // banner's tone.
          className="-me-2 text-current! hover:bg-surface/40 hover:text-current!"
        />
      ) : null}
    </div>
  );
}
