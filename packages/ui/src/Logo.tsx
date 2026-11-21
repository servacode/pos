import { cn } from './cn';

// The SERVA logo is the owner's own picture, used as it is (docs/design/IDENTITY.md › الشعار): never
// redrawn. The files in apps/web/public/brand are cut from that one image:
//   serva-logo.webp: the picture with its black ground, for light surfaces (shown on a rounded tile);
//   serva-logo-on-dark.webp: the same pixels with the black made see-through, for dark surfaces;
//   serva-mark.webp: the «S» of the same picture, square, for small places and the icons.
// Resize with the height only.

/** The «S» of the logo as a line, for the faint watermark of the sign-in side (not the logo itself). */
export const LOGO_S_PATH = 'M254 276 C334 296 372 318 366 358 C356 420 236 430 142 388';

export type LogoTone = 'default' | 'sidebar';

const BRAND = '/brand';

/** The «S» alone, square, on its black ground (the logo's own pixels). */
export function LogoMark({ className, label }: { className?: string; label?: string; tone?: LogoTone }) {
  return (
    <img
      src={`${BRAND}/serva-mark.webp`}
      width={256}
      height={256}
      decoding="async"
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      className={cn('size-8 shrink-0 rounded-[22%] object-cover', className)}
    />
  );
}

/** The app icon: the mark on its rounded tile (the PWA and home-screen icons in public/ are the same). */
export function AppIcon({ className, label }: { className?: string; label?: string }) {
  return <LogoMark label={label} className={cn('size-16 shadow-e1', className)} />;
}

const SIZES = {
  // Headers (sidebar, cashier bar, phone top).
  sm: 'h-12',
  // The large sheet.
  lg: 'h-28',
} as const;

/** The logo picture (alt «SERVA»): on a light surface with its black ground, on the dark sidebar see-through. */
export function Logo({
  className,
  size = 'sm',
  tone = 'default',
}: {
  className?: string;
  size?: keyof typeof SIZES;
  /** 'sidebar' on the always-dark sidebar: the see-through cut, so the glow sits on the sidebar itself. */
  tone?: LogoTone;
}) {
  const file = tone === 'sidebar' ? 'serva-logo-on-dark' : 'serva-logo';
  return (
    <img
      src={`${BRAND}/${file}.webp`}
      srcSet={`${BRAND}/${file}.webp 1x, ${BRAND}/${file}@2x.webp 2x`}
      width={360}
      height={240}
      decoding="async"
      alt="SERVA"
      className={cn('w-auto shrink-0', tone === 'sidebar' ? '' : 'rounded-lg', SIZES[size], className)}
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
