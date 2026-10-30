import { cn } from '../lib/cn';

// The emerald logo from docs/design/kit/logo.md, drawn with colour tokens so it follows the theme:
// the mark is brand with an on-brand «S»; the dot is brand-soft in light mode and on-brand in dark.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('size-8 shrink-0', className)}
    >
      <rect width="64" height="64" rx="16" className="fill-brand" />
      <path
        d="M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42"
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        className="stroke-on-brand"
      />
      <circle cx="46" cy="46" r="3.5" className="fill-brand-soft dark:fill-on-brand" />
    </svg>
  );
}

/** The small horizontal lockup for headers: mark, «Serva» and «سيرفا» under it. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      <span className="flex flex-col">
        <span lang="en" dir="ltr" className="text-xl/[22px] font-bold tracking-[-0.3px] text-ink">
          Serva
        </span>
        <span className="text-xs/4 font-semibold text-brand-ink">سيرفا</span>
      </span>
    </span>
  );
}
