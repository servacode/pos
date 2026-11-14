import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';
import { FieldError } from './FieldError';

/** The label above every field (هوية 4 › الحقول). */
export const FIELD_LABEL = 'text-sm font-semibold text-ink-muted';

/** The hint under a field; an error takes its place. */
export const FIELD_HINT = 'text-sm text-ink-subtle';

/** Text inside a field: 15 with a mouse, 16 on a finger (no zoom on phones), 18 on touch screens. */
export const FIELD_TEXT: Record<Density, string> = {
  touch: 'text-lg',
  comfortable: 'text-[0.9375rem] pointer-coarse:text-base',
  compact: 'text-sm pointer-coarse:text-base',
  dense: 'text-sm',
};

/**
 * A font size of its own in `inputClassName` (text-2xl, text-lg/7, text-[1.625rem], text-kpi), with
 * no variant. `cn` joins classes without merging them, so the field's size steps aside for it.
 */
const OWN_FONT_SIZE =
  /(?:^|\s)!?text-(?:xs|sm|base|lg|\d*xl|kpi|total|display|\[[\d.]+(?:px|r?em)\])(?:\/\S+)?!?(?=\s|$)/;

/** How far an icon at the start, or a unit at the end, sits from the box's edge: the text's inset. */
export const ADORNMENT_INSET: Record<Density, { start: string; end: string }> = {
  touch: { start: 'ms-4', end: 'me-4' },
  comfortable: { start: 'ms-3', end: 'me-3' },
  compact: { start: 'ms-3', end: 'me-3' },
  dense: { start: 'ms-2.5', end: 'me-2.5' },
};

/**
 * The text sits 12 from the box's edge and 8 from an icon, a unit or a button (touch 16 and 12,
 * dense 10 and 6). The input pads both sides with the smaller step: a number runs LTR inside an
 * Arabic box, so the input's own start and end are the box's end and start. The box adds the last
 * 4 on a side with nothing in it, in the page's direction.
 */
const TEXT_PADDING: Record<Density, string> = {
  touch: 'px-3',
  comfortable: 'px-2',
  compact: 'px-2',
  dense: 'px-1.5',
};

const FOCUS_HALO =
  'focus-within:border-brand focus-within:hover:border-brand focus-within:ring-4 focus-within:ring-brand/15';

/**
 * The box's border, fill and halo in each state. An error keeps its colour when focused, so the
 * global focus ring shows where the typing goes (not when the button inside has the focus: it draws
 * its own). The muted fill means «you can't type here»: disabled and read-only only.
 */
function boxTone({
  error,
  disabled,
  readOnly,
}: {
  error: boolean;
  disabled: boolean;
  readOnly: boolean;
}): string {
  if (error) {
    return cn(
      'border-danger ring-4 ring-danger/15',
      'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
      disabled || readOnly ? 'bg-surface-muted' : 'bg-surface',
    );
  }
  if (disabled) return 'cursor-not-allowed border-line bg-surface-muted';
  if (readOnly) return cn('border-line bg-surface-muted', FOCUS_HALO);
  return cn('border-line-control bg-surface hover:border-ink-subtle', FOCUS_HALO);
}

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'size'> {
  label: string;
  /** Hide the label visually (it stays for screen readers), e.g. a search box in a toolbar. */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: string;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  /** Classes for the input itself. A font size here (text-2xl) replaces the field's own. */
  inputClassName?: string;
}

/**
 * Names, addresses and notes (tab 14 › حقل النص; هوية 4 › الحقول): label above, hint or error
 * below. The box carries the density's height, so a field and a button side by side line up.
 */
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
  const ownFontSize = inputClassName ? OWN_FONT_SIZE.test(inputClassName) : false;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className={cn(FIELD_LABEL, hideLabel && 'sr-only')}>
        {label}
      </label>
      <div
        className={cn(
          // Icons and units inside take the subtle ink; the text itself is ink.
          'flex items-center rounded-control border text-ink-subtle transition-[border-color,box-shadow,background-color] duration-120 ease-standard',
          CONTROL_HEIGHT[density],
          !startAdornment && 'ps-1',
          !endAdornment && 'pe-1',
          boxTone({ error: Boolean(error), disabled: Boolean(disabled), readOnly: Boolean(readOnly) }),
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
            // The box shows the focus; the outline only comes back in Windows high-contrast mode.
            'min-w-0 flex-1 self-stretch bg-transparent text-ink caret-brand placeholder:text-ink-subtle focus:outline-hidden disabled:cursor-not-allowed disabled:text-ink-subtle',
            // The browser's saved-password fill paints its own colour: keep the field's surface,
            // rounded like the box so the fill never squares the box's corners.
            'rounded-[inherit] autofill:shadow-[inset_0_0_0_1000px_var(--color-surface)] autofill:[-webkit-text-fill-color:var(--color-ink)]',
            !ownFontSize && FIELD_TEXT[density],
            TEXT_PADDING[density],
            // Numbers, phones and codes run LTR but line up with the Arabic labels above them.
            dir === 'ltr' && 'text-end',
            inputClassName,
          )}
          {...inputProps}
        />
        {endAdornment}
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

/** The drawn size of a button inside a field: a step under the box, so it sits inside the border. */
const FIELD_BUTTON: Record<Density, string> = {
  touch: 'size-12',
  comfortable: 'size-8 pointer-coarse:size-10',
  compact: 'size-7 pointer-coarse:size-9',
  dense: 'size-6',
};

export interface FieldButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** The action's name, read by screen readers. */
  label: string;
  icon: ReactNode;
}

/**
 * An icon button at the end of a field (show the password, clear the search). Its target reaches
 * past the drawn square, so it is 48 on a finger.
 */
export function FieldButton({ label, icon, type = 'button', className, ...rest }: FieldButtonProps) {
  const density = useDensity();
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        'relative me-1 grid shrink-0 cursor-pointer place-items-center rounded-small text-ink-subtle transition-colors duration-120 ease-standard after:absolute after:-inset-1 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
        FIELD_BUTTON[density],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
