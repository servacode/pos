import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';
import type { IconSize } from './icons';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
/**
 * With a mouse: xs 32 · sm 36 · md 40, the admin's control height · lg 48 · pay 72, the cashier's pay
 * bar. Under a finger each grows to its screen's touch target (HEIGHT below): 48 on the admin.
 */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'pay';

type ControlSize = Exclude<ButtonSize, 'pay'>;

/*
 * هوية 4 › الزر. `cn` joins classes without merging them, so a conflict is settled by Tailwind's
 * output order, not by the order written here. Every property is therefore set by one group only:
 * the size (height, padding, type, weight, corner, alignment), the variant (fill, ink, line, depth)
 * and the state (cursor, dimming, hover, press). Tailwind writes the `pointer-coarse:` rules last,
 * so under a finger the size's height wins over one a screen passes in className (ButtonProps).
 */

/**
 * The raised fill of primary and danger, as the specimen draws it in both modes: a hairline of light
 * along the top edge (`highlight`, white in both modes) and a small shadow. The primary's shadow is
 * the mark's deep emerald (`mark-from`, fixed), so dark mode gets no light-green glow.
 */
const RAISED = 'inset-shadow-[0_1px_0] inset-shadow-highlight/15 shadow-[0_1px_2px]';

interface VariantStyle {
  /** At rest; a disabled or busy button keeps it. A pressed toggle (aria-pressed) takes the brand tint. */
  rest: string;
  /** Under a mouse; Tailwind applies hover only where the device can hover. */
  hover: string;
}

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: {
    rest: `${RAISED} bg-brand text-on-brand shadow-mark-from/30`,
    hover: 'hover:bg-brand-hover',
  },
  secondary: {
    rest: 'border border-line-control/50 bg-surface text-ink shadow-e1 aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-ink',
    hover: 'hover:bg-surface-muted',
  },
  ghost: {
    rest: 'text-ink-muted aria-pressed:bg-brand-soft aria-pressed:text-brand-ink',
    hover: 'hover:bg-surface-muted hover:text-ink',
  },
  danger: {
    rest: `${RAISED} bg-danger text-on-danger shadow-danger/30`,
    hover: 'hover:bg-danger-ink',
  },
  'danger-soft': {
    rest: 'bg-danger-soft text-danger-ink',
    hover: 'hover:bg-danger/15',
  },
};

/**
 * The height of each size on each density: one class with a mouse and at most one under a finger
 * (pointer-coarse), so no two fight. Each size is a density's control height (context.tsx): xs dense,
 * sm compact, md comfortable, lg 48. Under a finger no density goes below its own touch target (tab 14
 * › أهداف اللمس): the admin (comfortable) raises every size to 48, compact screens raise xs to 44,
 * and the dense screens are for a mouse. On the touch density xs and sm become md (resolveSize), 48,
 * and lg is 56.
 */
const HEIGHT: Record<Density, Record<ControlSize, string>> = {
  touch: { xs: 'min-h-12', sm: 'min-h-12', md: 'min-h-12', lg: CONTROL_HEIGHT.touch },
  comfortable: {
    xs: 'min-h-8 pointer-coarse:min-h-12',
    sm: 'min-h-9 pointer-coarse:min-h-12',
    md: CONTROL_HEIGHT.comfortable,
    lg: 'min-h-12',
  },
  compact: {
    xs: 'min-h-8 pointer-coarse:min-h-11',
    sm: CONTROL_HEIGHT.compact,
    md: CONTROL_HEIGHT.comfortable,
    lg: 'min-h-12',
  },
  dense: {
    xs: CONTROL_HEIGHT.dense,
    sm: CONTROL_HEIGHT.compact,
    md: CONTROL_HEIGHT.comfortable,
    lg: 'min-h-12',
  },
};

/** The IconButton square of each size and density: as tall as the Button (HEIGHT), and as wide. */
const SQUARE: Record<Density, Record<ControlSize, string>> = {
  touch: { xs: 'size-12', sm: 'size-12', md: 'size-12', lg: 'size-14' },
  comfortable: {
    xs: 'size-8 pointer-coarse:size-12',
    sm: 'size-9 pointer-coarse:size-12',
    md: 'size-10 pointer-coarse:size-12',
    lg: 'size-12',
  },
  compact: {
    xs: 'size-8 pointer-coarse:size-11',
    sm: 'size-9 pointer-coarse:size-11',
    md: 'size-10 pointer-coarse:size-12',
    lg: 'size-12',
  },
  dense: {
    xs: 'size-8',
    sm: 'size-9 pointer-coarse:size-11',
    md: 'size-10 pointer-coarse:size-12',
    lg: 'size-12',
  },
};

const CONTROL = 'justify-center rounded-control font-semibold';

/**
 * Height, padding and type per size; md and lg are larger on the touch density, for the cashier. Only
 * the pay bar is card-cornered, full width and bold, with its label at the start and the amount at
 * the end, 72 whatever the density.
 */
function sizeClass(size: ButtonSize, density: Density): string {
  if (size === 'pay') return 'min-h-18 w-full justify-between gap-3 rounded-card px-7 text-xl font-bold';
  const touch = density === 'touch';
  const box = {
    xs: 'gap-1.5 px-3 text-sm',
    sm: 'gap-2 px-3.5 text-sm',
    md: touch ? 'gap-2 px-5 text-base' : 'gap-2 px-4 text-sm',
    lg: touch ? 'gap-2.5 px-6 text-lg' : 'gap-2 px-5 text-[0.9375rem]',
  }[size];
  return `${HEIGHT[density][size]} ${CONTROL} ${box}`;
}

const SPINNER_SIZE: Record<ButtonSize, IconSize> = { xs: 16, sm: 16, md: 20, lg: 20, pay: 24 };

const DEFAULT_SIZE: Record<Density, ControlSize> = {
  touch: 'lg',
  comfortable: 'md',
  compact: 'sm',
  dense: 'xs',
};

/**
 * The size a button gets: the one asked for, or the density's default. On the touch density nothing
 * a finger presses is under 48 × 48 (tab 14 › أهداف اللمس), so smaller sizes are raised to md, 48 there.
 */
function resolveSize(size: ButtonSize | undefined, density: Density): ButtonSize {
  const chosen = size ?? DEFAULT_SIZE[density];
  if (density === 'touch' && (chosen === 'xs' || chosen === 'sm')) return 'md';
  return chosen;
}

/** Busy: a wait cursor. Disabled: half strength. Otherwise it answers hover and shrinks a touch when pressed. */
function stateClass(variant: ButtonVariant, disabled: boolean | undefined, loading: boolean) {
  if (loading) return 'cursor-wait';
  if (disabled) return 'cursor-not-allowed opacity-50';
  return cn(VARIANTS[variant].hover, 'motion-safe:active:scale-[0.98]');
}

/* Shared by Button and IconButton: colours, depth and the press change in 120 ms. */
const BASE =
  'inline-flex items-center whitespace-nowrap select-none touch-manipulation transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-120 ease-standard';

/**
 * A height set in `className` must be set under a finger too (`min-h-14 pointer-coarse:min-h-14`):
 * the size's own `pointer-coarse:` height comes later in the style sheet and wins on touch screens.
 */
export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  /** Defaults to the density's control height: 56 touch, 40 comfortable (48 on a finger), 36 compact (44), 32 dense. */
  size?: ButtonSize;
  /** Busy: the spinner takes the icon's place before the label, and the button cannot be pressed. */
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * Every action (tab 14 › الزر). One primary button per view; the label names the action. While
 * loading, the spinner stands in for the icon: the label stays in view and stays the button's name.
 */
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
        sizeClass(resolved, density),
        VARIANTS[variant].rest,
        stateClass(variant, disabled, loading),
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={SPINNER_SIZE[resolved]} /> : icon}
      {children}
    </button>
  );
}

/**
 * A square set in `className` must be set under a finger too (`size-14 pointer-coarse:size-14`), as
 * with ButtonProps.
 */
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
  const resolved = resolveSize(size, density) as ControlSize;
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        'shrink-0 justify-center rounded-control',
        SQUARE[density][resolved],
        VARIANTS[variant].rest,
        stateClass(variant, disabled, loading),
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={SPINNER_SIZE[resolved]} /> : icon}
    </button>
  );
}
