import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { useDensity, type Density } from './context';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
/** 32 (dense), 40 (mouse-only screens), 48 (default), 56 (large and touch), 72 (the pay button). */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'pay';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover',
  secondary: 'border border-line-control bg-surface text-brand-ink hover:bg-surface-muted',
  ghost: 'text-ink hover:bg-surface-muted',
  danger: 'bg-danger text-on-danger hover:opacity-90',
  'danger-soft': 'bg-danger-soft text-danger-ink hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'min-h-8 rounded-small px-3 text-sm',
  sm: 'min-h-10 rounded-xl px-3.5 text-sm',
  md: 'min-h-12 rounded-control px-5 text-base',
  lg: 'min-h-14 rounded-control px-6 text-lg',
  pay: 'min-h-18 w-full justify-between rounded-control px-6 text-xl font-bold',
};

const ICON_SIZES: Record<Exclude<ButtonSize, 'pay'>, string> = {
  xs: 'size-8 rounded-small',
  sm: 'size-10 rounded-xl',
  md: 'size-12 rounded-control',
  lg: 'size-14 rounded-control',
};

const DEFAULT_SIZE: Record<Density, Exclude<ButtonSize, 'pay'>> = {
  touch: 'lg',
  comfortable: 'md',
  compact: 'sm',
  dense: 'xs',
};

/**
 * The size a button gets: the one asked for, or the density's default. On the touch density nothing
 * a finger presses is under 48 × 48 (tab 14 › أهداف اللمس), so smaller sizes are raised to 48.
 */
function resolveSize(size: ButtonSize | undefined, density: Density): ButtonSize {
  const chosen = size ?? DEFAULT_SIZE[density];
  if (density === 'touch' && (chosen === 'xs' || chosen === 'sm')) return 'md';
  return chosen;
}

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-[background-color,border-color,color,opacity,transform] duration-120 ease-standard select-none active:scale-[0.98] disabled:active:scale-100';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  /** Defaults to the density's size: 56 on touch, 48 comfortable, 40 compact, 32 dense. */
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

/** Every action (tab 14 › الزر). One primary button per view; the label names the action. */
export function Button({
  variant = 'primary',
  size,
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const density = useDensity();
  const resolved = resolveSize(size, density);
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[resolved],
        fullWidth && 'w-full',
        disabled && !loading && 'cursor-not-allowed opacity-50',
        loading && 'cursor-wait',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** The action's name: read by screen readers and shown on hover (tab 14 › زر الأيقونة). */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, 'danger'>;
  size?: Exclude<ButtonSize, 'pay'>;
  loading?: boolean;
}

/** A square icon-only button for well-known actions (search, close, delete, more). */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size,
  loading = false,
  disabled,
  type = 'button',
  title,
  className,
  ...rest
}: IconButtonProps) {
  const density = useDensity();
  const resolved = resolveSize(size, density) as Exclude<ButtonSize, 'pay'>;
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        'shrink-0',
        variant === 'ghost' ? 'text-ink-muted hover:bg-surface-muted hover:text-ink' : VARIANTS[variant],
        ICON_SIZES[resolved],
        disabled && !loading && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
    </button>
  );
}
