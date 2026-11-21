import { cn } from './cn';

// The SERVA logo is the owner's own picture, used as it is (docs/design/IDENTITY.md › الشعار): never
// redrawn. The files in apps/web/public/brand are cut from that one image:
//   serva-logo.webp: the picture itself with its black ground, on a rounded tile, everywhere;
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

/** The logo picture (alt «SERVA»), the owner's own image unchanged. */
export function Logo({
  className,
  size = 'sm',
  tone = 'default',
}: {
  className?: string;
  size?: keyof typeof SIZES;
  /** Kept for callers; the picture is the same everywhere. */
  tone?: LogoTone;
}) {
  const file = 'serva-logo';
  return (
    <img
      src={`${BRAND}/${file}.webp`}
      srcSet={`${BRAND}/${file}.webp 1x, ${BRAND}/${file}@2x.webp 2x`}
      width={480}
      height={320}
      decoding="async"
      alt="SERVA"
      data-tone={tone}
      className={cn('w-auto shrink-0 rounded-lg', SIZES[size], className)}
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
