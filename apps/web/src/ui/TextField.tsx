import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FieldError } from './FieldError';

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'size'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  endAdornment?: ReactNode;
}

export function TextField({
  label,
  hint,
  error,
  endAdornment,
  id,
  dir,
  className,
  ...inputProps
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const showHint = Boolean(hint) && !error;
  const hintId = showHint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div
        className={cn(
          'flex items-center rounded-control border bg-surface ring-inset transition-[border-color,box-shadow] duration-150',
          error
            ? 'border-danger ring-1 ring-danger'
            : 'border-line-control focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
        )}
      >
        <input
          id={inputId}
          dir={dir}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'min-h-12 w-full min-w-0 flex-1 rounded-control bg-transparent px-3.5 text-base text-ink outline-none placeholder:text-ink-subtle',
            dir === 'ltr' && 'text-right',
          )}
          {...inputProps}
        />
        {endAdornment}
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
