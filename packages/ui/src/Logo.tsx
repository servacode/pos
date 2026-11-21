import { cn } from './cn';

// The SERVA logo is the owner's own drawing, used as it is (docs/design/IDENTITY.md › الشعار): never
// redrawn. Every file comes from scripts/brand/serva-logo-source.svg through `pnpm brand`:
//   /brand/serva-logo.svg: the logo itself;
//   /brand/serva-mark.svg: the same drawing cut to the square around the «S», for small places.
// On a dark surface (the sidebar) it sits on a white tile so its blue reads. Resize with the height only.

/** The «S» of the logo as a line, for the faint watermark of the sign-in side (not the logo itself). */
export const LOGO_S_PATH = 'M254 276 C334 296 372 318 366 358 C356 420 236 430 142 388';

export type LogoTone = 'default' | 'sidebar';

const BRAND = '/brand';
/** The white tile under the logo on a dark surface (part of the logo, the same in both themes). */
// eslint-disable-next-line no-restricted-syntax -- the logo's own white ground, white in both themes, not an interface colour
const TILE = { backgroundColor: '#fff' } as const;

/** The «S» alone, square: the logo's own drawing cut around it. */
export function LogoMark({
  className,
  label,
  tone = 'default',
}: {
  className?: string;
  label?: string;
  tone?: LogoTone;
}) {
  return (
    <img
      src={`${BRAND}/serva-mark.svg`}
      width={64}
      height={64}
      decoding="async"
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      style={tone === 'sidebar' ? TILE : undefined}
      className={cn('size-8 shrink-0', tone === 'sidebar' && 'rounded-md p-0.5', className)}
    />
  );
}

/** The app icon: the mark on a white rounded tile (the PWA and home-screen icons in public/ are the same). */
export function AppIcon({ className, label }: { className?: string; label?: string }) {
  return (
    <LogoMark
      label={label}
      tone="sidebar"
      className={cn('size-16 rounded-[22%] p-[6%] shadow-e1', className)}
    />
  );
}

const SIZES = {
  // Headers (sidebar, cashier bar, phone top).
  sm: 'h-10',
  // The large sheet.
  lg: 'h-28',
} as const;

/** The logo (alt «SERVA»), the owner's own drawing unchanged; on the dark sidebar on a white tile. */
export function Logo({
  className,
  size = 'sm',
  tone = 'default',
}: {
  className?: string;
  size?: keyof typeof SIZES;
  /** 'sidebar' on the always-dark sidebar: the logo on a white tile, so its blue reads. */
  tone?: LogoTone;
}) {
  return (
    <img
      src={`${BRAND}/serva-logo.svg`}
      width={1536}
      height={1024}
      decoding="async"
      alt="SERVA"
      style={tone === 'sidebar' ? TILE : undefined}
      className={cn('w-auto shrink-0', tone === 'sidebar' && 'rounded-lg px-2 py-1', SIZES[size], className)}
    />
  );
}

/** The stacked lockup for the splash and error pages: the logo, and «سيرفا» under it. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-col items-center gap-3', className)}>
      <Logo size="lg" />
      <span className="text-xl/[30px] font-semibold text-brand-ink">سيرفا</span>
    </span>
  );
}
