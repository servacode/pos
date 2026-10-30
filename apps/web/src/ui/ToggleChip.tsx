import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { CheckIcon } from './icons';

interface ToggleChipProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label: string;
  type?: 'checkbox' | 'radio';
}

export function ToggleChip({ label, type = 'checkbox', className, ...inputProps }: ToggleChipProps) {
  return (
    <label
      className={cn(
        'group inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line-control bg-surface ps-2.5 pe-4 text-sm font-medium text-ink transition-colors duration-150 select-none hover:bg-surface-muted',
        'has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand-ink',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50',
        className,
      )}
    >
      <input type={type} className="sr-only" {...inputProps} />
      <span className="grid size-5 place-items-center rounded-full border border-line-control bg-surface transition-colors group-has-checked:border-brand group-has-checked:bg-brand group-has-checked:text-on-brand">
        <CheckIcon
          strokeWidth={3}
          className="size-3 scale-50 opacity-0 transition group-has-checked:scale-100 group-has-checked:opacity-100"
        />
      </span>
      {label}
    </label>
  );
}
