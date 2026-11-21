import { useId } from 'react';
import { cn } from './cn';

// The SERVA logo: the «S» with its rising arrow in the brand blue and green, and the rounded «erva»
// (the approved identity, docs/design/IDENTITY.md; the files are in apps/web/public/brand). The art
// is drawn as in those SVGs, in a 512 box: the blue swoosh, the green swoosh and arrow cut away
// around it by a mask (so the two never touch), then the letters as strokes (no font, no licence).
// It follows the theme (blue → brand, green → accent); on the always-dark sidebar the 'sidebar' tone
// uses the dark-surface values of the logo files. Resize with the height or width only, never redraw.

/** The blue swoosh of the «S» in the logo's 512 box (viewBox 40 40 440 440); the faint S of the sign-in side. */
export const LOGO_S_PATH = 'M254 276 C334 296 372 318 366 358 C356 420 236 430 142 388';
const GREEN_SWOOSH = 'M300 176 C250 132 150 136 142 202 C136 252 200 270 258 284';
const GREEN_ARROW =
  'M336 276 C352 236 352 196 366 152 L334 154 L414 62 L450 176 L418 166 C404 210 398 246 392 290 Z';
const ERVA =
  'M762 605 H910 A74 75 0 1 0 882 664 M988 682 V532 M988 604 C988 562 1016 538 1062 540 M1092 536 L1156 680 L1220 536 M1332 533 A72 72 0 1 0 1332 677 A72 72 0 1 0 1332 533 M1404 530 V682';

export type LogoTone = 'default' | 'sidebar';

/* eslint-disable no-restricted-syntax -- the logo's own artwork colours on a dark surface (serva-logo-dark.svg): the sidebar is dark in both modes, so no theme token applies */
const ON_DARK = { blue: '#4a80ff' } as const;
/* eslint-enable no-restricted-syntax */

const PAINT = {
  default: { blue: 'stroke-brand', green: 'fill-accent stroke-accent' },
  sidebar: { blue: '', green: 'fill-sidebar-brand stroke-sidebar-brand' },
} as const;

interface ArtProps {
  className?: string;
  /** Give the logo a name when it stands alone; next to the words it is decorative. */
  label?: string;
  tone?: LogoTone;
}

function a11y(label: string | undefined) {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
}

function Art({
  className,
  label,
  tone = 'default',
  viewBox,
  withWord,
}: ArtProps & { viewBox: string; withWord: boolean }) {
  // One mask per logo: two logos on a page never share an id (nor lose it when one unmounts).
  const mask = `serva-cut-${useId().replace(/[^\w-]/g, '')}`;
  const paint = PAINT[tone];
  const blue = tone === 'sidebar' ? { stroke: ON_DARK.blue } : {};
  return (
    <svg viewBox={viewBox} focusable="false" {...a11y(label)} className={className}>
      <defs>
        {/* eslint-disable no-restricted-syntax -- a mask works by luminance: white keeps, black cuts; not a colour of the interface */}
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <rect width="512" height="512" fill="#fff" />
          <path
            d={LOGO_S_PATH}
            fill="none"
            stroke="#000"
            strokeWidth="116"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
        {/* eslint-enable no-restricted-syntax */}
      </defs>
      <g mask={`url(#${mask})`}>
        <path
          d={GREEN_SWOOSH}
          fill="none"
          strokeWidth="92"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={paint.green}
        />
        <path d={GREEN_ARROW} className={paint.green} strokeWidth="0" />
      </g>
      <path
        d={LOGO_S_PATH}
        fill="none"
        strokeWidth="92"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={paint.blue}
        {...blue}
      />
      {withWord ? (
        <path
          d={ERVA}
          transform="translate(-235 -270)"
          fill="none"
          strokeWidth="60"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={paint.blue}
          {...blue}
        />
      ) : null}
    </svg>
  );
}

/** The «S» alone, square: legible from 16 px up. */
export function LogoMark({ className, label, tone }: ArtProps) {
  return (
    <Art
      viewBox="40 40 440 440"
      withWord={false}
      label={label}
      tone={tone}
      className={cn('size-8 shrink-0', className)}
    />
  );
}

/** The app icon: the mark on a rounded tile (the PWA and home-screen icon is the same, in public/). */
export function AppIcon({ className, label }: Omit<ArtProps, 'tone'>) {
  return (
    <span
      className={cn(
        'inline-grid size-16 shrink-0 place-items-center rounded-[22%] bg-surface shadow-e1',
        className,
      )}
    >
      <LogoMark label={label} className="size-[78%]" />
    </span>
  );
}

const SIZES = {
  // Headers (sidebar, cashier bar, phone top): the lockup 32 tall.
  sm: 'h-8',
  // The large sheet: 92 tall.
  lg: 'h-23',
} as const;

/** The horizontal lockup: the «S» with «erva» (aria-label «SERVA»). */
export function Logo({
  className,
  size = 'sm',
  tone = 'default',
}: {
  className?: string;
  size?: keyof typeof SIZES;
  /** 'sidebar' on the always-dark sidebar: the logo's colours for a dark surface. */
  tone?: LogoTone;
}) {
  return (
    <Art
      viewBox="44 44 1190 420"
      withWord
      label="SERVA"
      tone={tone}
      className={cn('w-auto shrink-0', SIZES[size], className)}
    />
  );
}

/** The stacked lockup for the splash and error pages: the lockup, and «سيرفا» under it. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-center gap-3', className)}>
      <Logo className="h-20" />
      <span className="text-xl/[30px] font-semibold text-brand-ink">سيرفا</span>
    </span>
  );
}
