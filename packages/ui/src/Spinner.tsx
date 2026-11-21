import { cn } from './cn';
import type { IconSize } from './icons';

interface SpinnerProps {
  className?: string;
  /** Read out as a polite status (role="status"); without it the spinner is decoration. */
  label?: string;
  /** In pixels, like the icons (20 by default); a size class in `className` wins over it. */
  size?: IconSize;
}

/**
 * The busy mark (هوية 4): a faint ring and a turning quarter arc in the text colour. The stroke is
 * 2 px at every size, so the ring stays crisp; it turns only for those who allow motion.
 */
export function Spinner({ className, label, size = 20 }: SpinnerProps) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 motion-safe:animate-spin', className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className="inline-flex items-center gap-2">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
