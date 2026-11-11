import type { ComponentProps } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';
import { CheckIcon } from './icons';

interface ToggleChipProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label: string;
  type?: 'checkbox' | 'radio';
}

/** Text and padding per density; the height is the density's control height. */
const CHIP: Record<Density, string> = {
  touch: 'ps-3 pe-4 text-base',
  comfortable: 'ps-2.5 pe-3 text-sm',
  compact: 'ps-2.5 pe-3 text-sm',
  dense: 'ps-2 pe-2.5 text-sm',
};

/**
 * A filter or option that turns on and off (هوية 4 › الشرائح): a small rounded chip, the brand tint
 * when on. The little box at the start keeps its place either way, so a row of chips never shifts
 * under the finger; it is round for a single choice and square for several.
 */
export function ToggleChip({ label, type = 'checkbox', className, ...inputProps }: ToggleChipProps) {
  const density = useDensity();
  return (
    <label
      className={cn(
        'group/chip inline-flex cursor-pointer items-center gap-2 rounded-small border border-line-control/50 bg-surface font-semibold text-ink select-none',
        'transition-[background-color,border-color,color] duration-120 ease-standard hover:bg-surface-muted',
        'has-checked:border-brand/30 has-checked:bg-brand-soft has-checked:text-brand-ink',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50',
        CONTROL_HEIGHT[density],
        CHIP[density],
        className,
      )}
    >
      <input type={type} className="sr-only" {...inputProps} />
      <span
        className={cn(
          'grid size-4 shrink-0 place-items-center border border-line-control bg-surface text-on-brand transition-colors duration-120 ease-standard group-has-checked/chip:border-brand group-has-checked/chip:bg-brand',
          // rounded-box (5), not rounded-small: 8 on a 16 box is a circle, the single choice's shape.
          type === 'radio' ? 'rounded-full' : 'rounded-box',
        )}
      >
        <CheckIcon
          size={16}
          strokeWidth={3}
          className="size-3 opacity-0 transition-opacity duration-120 ease-standard group-has-checked/chip:opacity-100"
        />
      </span>
      {label}
    </label>
  );
}
