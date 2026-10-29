import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

interface ChoiceCardProps extends Omit<ComponentProps<'input'>, 'type' | 'size' | 'title'> {
  title: string;
  description?: string;
  leading?: ReactNode;
}

export function ChoiceCard({ title, description, leading, className, ...inputProps }: ChoiceCardProps) {
  return (
    <label
      className={cn(
        'group flex min-h-16 cursor-pointer items-center gap-3 rounded-control border border-line-strong bg-surface p-3 transition-colors duration-150 select-none hover:border-ink-subtle',
        'has-checked:border-brand has-checked:bg-brand-soft has-checked:ring-1 has-checked:ring-brand',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        className,
      )}
    >
      <input type="radio" className="sr-only" {...inputProps} />
      {leading ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-sm font-bold text-ink-muted transition-colors group-has-checked:bg-brand group-has-checked:text-on-brand">
          {leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-ink">{title}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
      <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-line-strong transition-colors group-has-checked:border-brand">
        <span className="size-2.5 scale-0 rounded-full bg-brand transition-transform group-has-checked:scale-100" />
      </span>
    </label>
  );
}
