import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity } from './context';
import { FieldError } from './FieldError';

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'size'> {
  label: string;
  /** Hide the label visually (it stays for screen readers), e.g. a search box in a toolbar. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  inputClassName?: string;
}

/** Names, addresses and notes (tab 14 › حقل النص): label above, hint or error below. */
export function TextField({
  label,
  hideLabel = false,
  hint,
  error,
  startAdornment,
  endAdornment,
  id,
  dir,
  className,
  inputClassName,
  disabled,
  readOnly,
  ...inputProps
}: TextFieldProps) {
  const density = useDensity();
  const autoId = useId();
  const inputId = id ?? autoId;
  const showHint = Boolean(hint) && !error;
  const hintId = showHint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className={cn('text-sm font-semibold text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div
        className={cn(
          'flex items-center rounded-control border bg-surface ring-inset transition-[border-color,box-shadow] duration-120',
          error
            ? 'border-danger ring-1 ring-danger'
            : 'border-line-control focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
          disabled && 'cursor-not-allowed opacity-50',
          readOnly && !error && 'bg-surface-muted',
        )}
      >
        {startAdornment}
        <input
          id={inputId}
          dir={dir}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            CONTROL_HEIGHT[density],
            'w-full min-w-0 flex-1 rounded-control bg-transparent px-3.5 text-base text-ink outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed',
            density === 'touch' && 'text-lg',
            dir === 'ltr' && 'text-right',
            inputClassName,
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
