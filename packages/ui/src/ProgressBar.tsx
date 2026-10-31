import { cn } from './cn';

export interface ProgressBarProps {
  /** What is progressing, read by screen readers (e.g. «تنزيل بيانات المحل»). */
  label: string;
  /** Done so far, out of `max`. Leave it out while the total is not known yet. */
  value?: number;
  max?: number;
  /** The words a screen reader says instead of the bare percentage, e.g. «8:41 دقيقة باقية». */
  valueText?: string;
  /** Warning: time running out (a code about to expire). */
  tone?: 'brand' | 'warning';
  className?: string;
}

/**
 * A thin bar of progress (kit: the download bar and the code countdown): 8 px, rounded, the
 * filled part in the brand or warning colour. Without a value it shows a calm pulse.
 */
export function ProgressBar({
  label,
  value,
  max = 100,
  valueText,
  tone = 'brand',
  className,
}: ProgressBarProps) {
  const known = value !== undefined && max > 0;
  const ratio = known ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={known ? max : undefined}
      aria-valuenow={known ? Math.min(max, Math.max(0, value)) : undefined}
      aria-valuetext={valueText}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200 ease-standard',
          tone === 'warning' ? 'bg-warning' : 'bg-brand',
          !known && 'w-1/3 motion-safe:animate-skeleton',
        )}
        style={known ? { width: `${ratio * 100}%` } : undefined}
      />
    </div>
  );
}
