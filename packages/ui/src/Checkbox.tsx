import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity } from './context';
import { FieldError } from './FieldError';
import { CheckIcon, RemoveIcon } from './icons';
import { FIELD_LABEL } from './TextField';

/**
 * The whole row is the target, as tall as the density's controls (56 on touch, like a chip or a
 * button beside it). The group is named so a card or a table row around it can't light its box.
 */
const CHOICE_ROW =
  'group/choice flex cursor-pointer items-center gap-3 py-1 text-[0.9375rem] text-ink select-none has-disabled:cursor-not-allowed has-disabled:text-ink-subtle';

/** The box and its mark share one grid cell; with a description the box sits on the first line. */
function controlSlot(withDescription: boolean): string {
  return cn(
    'grid shrink-0 place-items-center *:col-start-1 *:row-start-1',
    withDescription && 'h-lh self-start',
  );
}

/** A 20 box drawn by hand (هوية 4 › مربع الاختيار): the mark is its own element, in on-brand. */
const BOX =
  'peer size-5 shrink-0 cursor-pointer appearance-none border transition-colors duration-120 ease-standard disabled:cursor-not-allowed';

/** Unticked, hovered, ticked and disabled. A disabled tick turns grey: it shows, it doesn't invite. */
const BOX_TONE =
  'border-line-control bg-surface group-hover/choice:border-ink-subtle checked:border-brand checked:bg-brand disabled:border-line-control/50 disabled:bg-surface-muted disabled:checked:border-line-control disabled:checked:bg-line-control';

/** «بعضها» follows the prop, like aria-checked, so the fill never waits for the DOM property. */
const MIXED_TONE = 'border-brand bg-brand disabled:border-line-control disabled:bg-line-control';

const MARK = 'pointer-events-none text-on-brand transition-opacity duration-120 ease-standard';

function ChoiceText({ label, description }: { label: ReactNode; description?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      {description ? (
        <span className="text-sm text-ink-muted group-has-disabled/choice:text-ink-subtle">
          {description}
        </span>
      ) : null}
    </span>
  );
}

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  label: ReactNode;
  description?: ReactNode;
  /** «بعضها»: the select-all box when only some rows are picked. */
  indeterminate?: boolean;
}

/** A checkbox in the brand colour; the whole row, label included, is the target (56 on touch). */
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
    <label className={cn(CHOICE_ROW, CONTROL_HEIGHT[density], className)}>
      <span className={controlSlot(Boolean(description))}>
        <input
          ref={ref}
          type="checkbox"
          aria-checked={indeterminate ? 'mixed' : undefined}
          // rounded-box (5), not rounded-small: 8 on a 20 box reads as a radio's circle at 1x.
          className={cn(BOX, 'rounded-box', indeterminate ? MIXED_TONE : BOX_TONE)}
          {...inputProps}
        />
        {indeterminate ? (
          <RemoveIcon size={16} strokeWidth={3} className={MARK} />
        ) : (
          <CheckIcon size={16} strokeWidth={3} className={cn(MARK, 'opacity-0 peer-checked:opacity-100')} />
        )}
      </span>
      <ChoiceText label={label} description={description} />
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
    <label className={cn(CHOICE_ROW, CONTROL_HEIGHT[density], className)}>
      <span className={controlSlot(Boolean(description))}>
        <input type="radio" className={cn(BOX, 'rounded-full', BOX_TONE)} {...inputProps} />
        {/* A drawn dot (not a filled box) so it still shows in Windows high-contrast mode. */}
        <svg
          viewBox="0 0 8 8"
          aria-hidden="true"
          focusable="false"
          className={cn(MARK, 'size-2 opacity-0 peer-checked:opacity-100')}
        >
          <circle cx="4" cy="4" r="4" fill="currentColor" />
        </svg>
      </span>
      <ChoiceText label={label} description={description} />
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

/** A fieldset of radios with a legend that reads like a field's label; the radios share a `name`. */
export function RadioGroup({ legend, hideLegend = false, error, className, children }: RadioGroupProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset aria-describedby={errorId} className={cn('flex flex-col', className)}>
      <legend className={cn(FIELD_LABEL, 'mb-1.5', hideLegend && 'sr-only')}>{legend}</legend>
      {children}
      {error ? (
        <FieldError id={errorId} className="mt-1.5">
          {error}
        </FieldError>
      ) : null}
    </fieldset>
  );
}
