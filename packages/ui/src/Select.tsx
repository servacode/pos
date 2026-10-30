import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity } from './context';
import { FieldError } from './FieldError';
import { ExpandIcon } from './icons';

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
}

/**
 * A choice among a few options (tab 14 › القائمة المنسدلة): the native <select>, so it works with
 * every keyboard, screen reader and phone picker. Long searchable lists (customers, products) get
 * their own component.
 */
export function Select({
  label,
  hideLabel = false,
  hint,
  error,
  id,
  className,
  disabled,
  children,
  ...selectProps
}: SelectProps) {
  const density = useDensity();
  const autoId = useId();
  const selectId = id ?? autoId;
  const showHint = Boolean(hint) && !error;
  const hintId = showHint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className={cn('text-sm font-semibold text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className={cn('relative flex items-center', disabled && 'opacity-50')}>
        <select
          id={selectId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          className={cn(
            CONTROL_HEIGHT[density],
            'w-full appearance-none rounded-control border bg-surface ps-3.5 pe-10 text-base text-ink outline-none transition-[border-color,box-shadow] duration-120 disabled:cursor-not-allowed',
            density === 'touch' && 'text-lg',
            error
              ? 'border-danger ring-1 ring-danger ring-inset'
              : 'border-line-control focus:border-ring focus:ring-1 focus:ring-ring focus:ring-inset',
          )}
          {...selectProps}
        >
          {children}
        </select>
        <ExpandIcon className="pointer-events-none absolute end-3.5 text-ink-muted" />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {showHint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
