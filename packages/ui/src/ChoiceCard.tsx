import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { CheckIcon } from './icons';

interface ChoiceCardProps extends Omit<ComponentProps<'input'>, 'type' | 'size' | 'title'> {
  title: string;
  description?: string;
  leading?: ReactNode;
}

/**
 * One of a few big choices (the business type, the branch): a card that is a radio. Picked, it takes
 * the brand border, a soft halo and tint, and a check at the end.
 */
export function ChoiceCard({ title, description, leading, className, ...inputProps }: ChoiceCardProps) {
  return (
    <label
      className={cn(
        'group/card flex min-h-16 cursor-pointer items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-e1 select-none',
        'transition-[border-color,background-color,box-shadow] duration-120 ease-standard hover:border-line-control',
        'has-checked:border-brand has-checked:bg-brand-soft/40 has-checked:ring-4 has-checked:ring-brand/10',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        'has-disabled:cursor-not-allowed has-disabled:opacity-60',
        className,
      )}
    >
      <input type="radio" className="sr-only" {...inputProps} />
      {leading ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-small bg-surface-muted text-sm font-bold text-ink-muted transition-colors duration-120 ease-standard group-has-checked/card:bg-brand group-has-checked/card:text-on-brand">
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-ink">{title}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
      <span className="grid size-5 shrink-0 place-items-center rounded-full border border-line-control bg-surface text-on-brand transition-colors duration-120 ease-standard group-hover/card:border-ink-subtle group-has-checked/card:border-brand group-has-checked/card:bg-brand">
        <CheckIcon
          size={16}
          strokeWidth={3}
          className="size-3.5 opacity-0 transition-opacity duration-120 ease-standard group-has-checked/card:opacity-100"
        />
      </span>
    </label>
  );
}
