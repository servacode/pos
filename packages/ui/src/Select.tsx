import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';
import { FieldError } from './FieldError';
import { ExpandIcon } from './icons';
import { FIELD_HINT, FIELD_LABEL, FIELD_TEXT } from './TextField';

/** The text's inset, leaving room for the chevron at the end, and where the chevron sits. */
const INSET: Record<Density, { text: string; chevron: string }> = {
  touch: { text: 'ps-4 pe-12', chevron: 'end-4' },
  comfortable: { text: 'ps-3 pe-10', chevron: 'end-3' },
  compact: { text: 'ps-3 pe-10', chevron: 'end-3' },
  dense: { text: 'ps-2.5 pe-8', chevron: 'end-2.5' },
};

export interface SelectProps extends Omit<ComponentProps<'select'>, 'size'> {
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
}

/**
 * A choice among a few options (tab 14 › القائمة المنسدلة; هوية 4 › القائمة المنسدلة): the native
 * <select>, so it works with every keyboard, screen reader and phone picker, drawn as the field's
 * box with a chevron at the end. Long searchable lists (customers, products) get their own component.
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
  const inset = INSET[density];

  // The box shows the focus. An error keeps its colour when focused, so the global focus ring says
  // where you are instead.
  const tone = error
    ? cn(
        'border-danger ring-4 ring-danger/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        disabled ? 'bg-surface-muted' : 'bg-surface',
      )
    : disabled
      ? 'border-line bg-surface-muted'
      : 'border-line-control bg-surface hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className={cn(FIELD_LABEL, hideLabel && 'sr-only')}>
        {label}
      </label>
      <div className="relative flex items-center">
        <select
          id={selectId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          className={cn(
            'w-full min-w-0 appearance-none rounded-control border transition-[border-color,box-shadow,background-color] duration-120 ease-standard',
            CONTROL_HEIGHT[density],
            FIELD_TEXT[density],
            inset.text,
            tone,
            disabled ? 'cursor-not-allowed text-ink-subtle' : 'cursor-pointer text-ink',
          )}
          {...selectProps}
        >
          {children}
        </select>
        <ExpandIcon
          size={density === 'dense' ? 16 : 20}
          className={cn('pointer-events-none absolute text-ink-subtle', inset.chevron)}
        />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {showHint ? (
        <p id={hintId} className={FIELD_HINT}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
