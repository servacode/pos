import { cn } from '../lib/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      className={cn('size-10 shrink-0', className)}
    >
      <rect width="40" height="40" rx="11" className="fill-brand-600" />
      <path
        d="M26 14.6c-1.2-2-3.4-3.1-6.2-3.1-3.6 0-6 1.8-6 4.4 0 2.6 2.2 3.6 6.2 4.4 4 .8 6.3 1.9 6.3 4.6 0 2.7-2.5 4.6-6.3 4.6-3 0-5.4-1.1-6.6-3.2"
        fill="none"
        strokeWidth="3.2"
        strokeLinecap="round"
        className="stroke-white"
      />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span dir="ltr" className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      <span className="text-xl font-bold tracking-tight text-ink">
        Serva <span className="text-brand">POS</span>
      </span>
    </span>
  );
}
