import { cn } from './cn';

interface SpinnerProps {
  className?: string;
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  const svg = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn('size-5 animate-spin', className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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
