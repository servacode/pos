import { cn } from './cn';

// The emerald logo, exactly as docs/design/kit/logo.md: viewBox 64, a square with corner 16, the «S»
// of two arcs (stroke 7, round caps) and the small dot. Drawn with colour tokens so it follows the
// theme: the mark is brand with an on-brand «S»; the dot is brand-soft in light mode and on-brand in
// dark. Resize with the width and height only, never redraw it.

export const LOGO_S_PATH = 'M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42';

interface MarkProps {
  className?: string;
  /** Give the mark a name when it stands alone; next to the words it is decorative. */
  label?: string;
}

function a11y(label: string | undefined) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
}

export function LogoMark({ className, label }: MarkProps) {
  return (
    <svg viewBox="0 0 64 64" focusable="false" {...a11y(label)} className={cn('size-8 shrink-0', className)}>
      <rect width="64" height="64" rx="16" className="fill-brand" />
      <path d={LOGO_S_PATH} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-on-brand" />
      <circle cx="46" cy="46" r="3.5" className="fill-brand-soft dark:fill-on-brand" />
    </svg>
  );
}

/**
 * The app icon (logo.md › أيقونة التطبيق): corner 15 of 64. Large and medium keep the dot; the small
 * one (48 and under) has a wider stroke and no dot.
 */
export function AppIcon({ className, label, small = false }: MarkProps & { small?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" focusable="false" {...a11y(label)} className={cn('size-16 shrink-0', className)}>
      <rect width="64" height="64" rx="15" className="fill-brand" />
      <path
        d={LOGO_S_PATH}
        fill="none"
        strokeWidth={small ? 8 : 7}
        strokeLinecap="round"
        className="stroke-on-brand"
      />
      {small ? null : <circle cx="46" cy="46" r="3.5" className="fill-brand-soft dark:fill-on-brand" />}
    </svg>
  );
}

const HORIZONTAL = {
  // Headers (sidebar, cashier bar, phone top): mark 32, «Serva» 20/22, «سيرفا» 12/16, gap 10.
  sm: {
    gap: 'gap-2.5',
    mark: 'size-8',
    latin: 'text-xl/[22px] tracking-[-0.3px]',
    arabic: 'text-xs/4',
  },
  // The large sheet: mark 92, «Serva» 60/64, «سيرفا» 26/36, gap 20.
  lg: {
    gap: 'gap-5',
    mark: 'size-23',
    latin: 'text-[60px]/16 tracking-[-1px]',
    arabic: 'text-[26px]/9',
  },
} as const;

/** The horizontal lockup: the mark, «Serva» and «سيرفا» under it. */
export function Logo({
  className,
  markClassName,
  size = 'sm',
}: {
  className?: string;
  markClassName?: string;
  size?: keyof typeof HORIZONTAL;
}) {
  const s = HORIZONTAL[size];
  return (
    <span className={cn('inline-flex items-center', s.gap, className)}>
      <LogoMark className={cn(s.mark, markClassName)} />
      <span className="flex flex-col">
        <span lang="en" dir="ltr" className={cn('font-bold text-ink', s.latin)}>
          Serva
        </span>
        <span className={cn('font-semibold text-brand-ink', s.arabic)}>سيرفا</span>
      </span>
    </span>
  );
}

/** The stacked lockup for the splash, sign-in and error pages: mark 96, «Serva» 44/48, «سيرفا» 20/30. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-center gap-4', className)}>
      <LogoMark className="size-24" />
      <span className="flex flex-col items-center">
        <span lang="en" dir="ltr" className="text-[44px]/12 font-bold tracking-[-0.8px] text-ink">
          Serva
        </span>
        <span className="text-xl/[30px] font-semibold text-brand-ink">سيرفا</span>
      </span>
    </span>
  );
}
