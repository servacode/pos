import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { useDensity } from './context';
import { FieldError } from './FieldError';

const CHOICE_ROW =
  'flex cursor-pointer items-center gap-2.5 text-[0.9375rem] text-ink select-none has-disabled:cursor-not-allowed has-disabled:opacity-50';

const BOX = 'size-5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed';

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label: ReactNode;
  description?: ReactNode;
  /** «بعضها»: the select-all box when only some rows are picked. */
  indeterminate?: boolean;
}

/** A native checkbox in the brand colour; the whole row is the target (44, 48 on touch). */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  className,
  ...inputProps
}: CheckboxProps) {
  const density = useDensity();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cn(CHOICE_ROW, density === 'touch' ? 'min-h-12' : 'min-h-11', className)}>
      <input
        ref={ref}
        type="checkbox"
        aria-checked={indeterminate ? 'mixed' : undefined}
        className={BOX}
        {...inputProps}
      />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export interface RadioProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label: ReactNode;
  description?: ReactNode;
}

/** One option of a RadioGroup. Arrow keys move between options natively, in the page direction. */
export function Radio({ label, description, className, ...inputProps }: RadioProps) {
  const density = useDensity();
  return (
    <label className={cn(CHOICE_ROW, density === 'touch' ? 'min-h-12' : 'min-h-11', className)}>
      <input type="radio" className={BOX} {...inputProps} />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export interface RadioGroupProps {
  legend: string;
  hideLegend?: boolean;
  error?: string;
  className?: string;
  children: ReactNode;
}

/** A fieldset of radios with a legend; the radios share a `name`. */
export function RadioGroup({ legend, hideLegend = false, error, className, children }: RadioGroupProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className={cn('flex flex-col', className)}>
      <legend className={cn('mb-1 text-sm font-semibold text-ink', hideLegend && 'sr-only')}>{legend}</legend>
      {children}
      {error ? (
        <FieldError id={errorId} className="mt-1">
          {error}
        </FieldError>
      ) : null}
    </fieldset>
  );
}
