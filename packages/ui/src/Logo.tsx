import { useId } from 'react';
import { cn } from './cn';

// The SERFA mark (هوية 4 «الزمرّدي»), drawn as docs/design/kit/logo.md: viewBox 64, a square with
// corner 16, the «S» of two arcs (stroke 7, round caps) and the small dot. The square is filled with
// the emerald → teal gradient; under it lies the same square in solid emerald, so the mark stays whole
// where a gradient cannot draw. The mark keeps its colours in both modes, as the specimen draws it
// (mark-from, mark-to, on-mark): the «S» and the dot are white. Resize with the width and height only,
// never redraw it.

export const LOGO_S_PATH = 'M42 22 A10 10 0 1 0 32 32 A10 10 0 1 1 22 42';

interface MarkProps {
  className?: string;
  /** Give the mark a name when it stands alone; next to the words it is decorative. */
  label?: string;
}

function a11y(label: string | undefined) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
}

/** The square of the mark: solid emerald, and the emerald → teal gradient over it. */
function MarkSquare({ radius }: { radius: number }) {
  // One gradient per mark: two logos on a page never share an id (nor lose it when one unmounts).
  const gradient = `serfa-mark-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" className="text-mark-from" />
          <stop offset="1" stopColor="currentColor" className="text-mark-to" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={radius} className="fill-mark-from" />
      <rect width="64" height="64" rx={radius} fill={`url(#${gradient})`} />
    </>
  );
}

export function LogoMark({ className, label }: MarkProps) {
  return (
    <svg viewBox="0 0 64 64" focusable="false" {...a11y(label)} className={cn('size-8 shrink-0', className)}>
      <MarkSquare radius={16} />
      <path d={LOGO_S_PATH} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-on-mark" />
      <circle cx="46" cy="46" r="3.5" className="fill-on-mark/90" />
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
      <MarkSquare radius={15} />
      <path
        d={LOGO_S_PATH}
        fill="none"
        strokeWidth={small ? 8 : 7}
        strokeLinecap="round"
        className="stroke-on-mark"
      />
      {small ? null : <circle cx="46" cy="46" r="3.5" className="fill-on-mark/90" />}
    </svg>
  );
}

// «SERFA» in Latin capitals, bold and letter-spaced 0.12em. The text is the word «Serfa» and the
// capitals are drawn (uppercase), so a screen reader says a name instead of spelling five letters.
// The space after the last letter is taken back (-me-[0.12em]) so the word sits optically centred
// and close to the mark.
const LATIN = '-me-[0.12em] font-bold tracking-[0.12em] uppercase';
const WORDMARK = 'Serfa';

const HORIZONTAL = {
  // Headers (sidebar, cashier bar, phone top): mark 32, «SERFA» 18/20, «سيرفا» 12/16, gap 10.
  sm: {
    gap: 'gap-2.5',
    mark: 'size-8',
    latin: 'text-lg/5',
    arabic: 'text-xs/4',
  },
  // The large sheet: mark 92, «SERFA» 48/56, «سيرفا» 24/36, gap 20.
  lg: {
    gap: 'gap-5',
    mark: 'size-23',
    latin: 'text-5xl/14',
    arabic: 'text-2xl/9',
  },
} as const;

// On the page, or on the deep-emerald sidebar (the same in both modes), where the words turn light.
const WORDS = {
  default: { latin: 'text-ink', arabic: 'text-brand-ink' },
  sidebar: { latin: 'text-sidebar-strong', arabic: 'text-sidebar-muted' },
} as const;

/** The horizontal lockup: the mark, «SERFA» and «سيرفا» under it. */
export function Logo({
  className,
  markClassName,
  size = 'sm',
  tone = 'default',
}: {
  className?: string;
  markClassName?: string;
  size?: keyof typeof HORIZONTAL;
  /** 'sidebar' on the deep-emerald sidebar: «SERFA» in white and «سيرفا» in sidebar-muted. */
  tone?: keyof typeof WORDS;
}) {
  const s = HORIZONTAL[size];
  const words = WORDS[tone];
  return (
    <span className={cn('inline-flex items-center', s.gap, className)}>
      <LogoMark className={cn(s.mark, markClassName)} />
      <span className="flex flex-col">
        <span lang="en" dir="ltr" className={cn(LATIN, words.latin, s.latin)}>
          {WORDMARK}
        </span>
        <span className={cn('font-semibold', words.arabic, s.arabic)}>سيرفا</span>
      </span>
    </span>
  );
}

/** The stacked lockup for the splash, sign-in and error pages: mark 96, «SERFA» 44/48, «سيرفا» 20/30. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-center gap-4', className)}>
      <LogoMark className="size-24" />
      <span className="flex flex-col items-center">
        <span lang="en" dir="ltr" className={cn(LATIN, 'text-[44px]/12 text-ink')}>
          {WORDMARK}
        </span>
        <span className="text-xl/[30px] font-semibold text-brand-ink">سيرفا</span>
      </span>
    </span>
  );
}
