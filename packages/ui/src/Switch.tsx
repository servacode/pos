import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { CONTROL_HEIGHT, useDensity, type Density } from './context';

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * The drawn switch per density (هوية 4 › المفتاح): the track, the thumb, and the width of the button
 * around them. The button is as tall as the density's controls (56 on touch, 48 on a finger on the
 * admin), so the target is bigger than the drawing. The thumb travels 20 in both sizes.
 */
const SIZE: Record<Density, { targetWidth: string; track: string; thumb: string }> = {
  touch: { targetWidth: 'w-15', track: 'h-8 w-13', thumb: 'size-6.5' },
  comfortable: { targetWidth: 'w-12 pointer-coarse:w-14', track: 'h-6 w-11', thumb: 'size-4.5' },
  compact: { targetWidth: 'w-12', track: 'h-6 w-11', thumb: 'size-4.5' },
  dense: { targetWidth: 'w-12', track: 'h-6 w-11', thumb: 'size-4.5' },
};

/**
 * On/off for settings and features. A real role="switch" button; the whole row, label included, is
 * the target. Off: a muted track with the control border; on: the brand track, the thumb at the
 * end. Real borders (not shadows) so it still shows in Windows high-contrast mode.
 */
export function Switch({ label, description, checked, onCheckedChange, disabled, className }: SwitchProps) {
  const density = useDensity();
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const size = SIZE[density];

  // Disabled loses the brand colour: a grey track when on, a soft outline when off.
  const track = disabled
    ? checked
      ? 'border-line-control bg-line-control'
      : 'border-line-control/50 bg-surface-muted'
    : checked
      ? 'border-brand bg-brand group-hover/switch:border-brand-hover group-hover/switch:bg-brand-hover'
      : 'border-line-control bg-surface-muted group-hover/switch:border-ink-subtle';

  return (
    <div className={cn('flex items-center justify-between gap-4', CONTROL_HEIGHT[density], className)}>
      <span className="flex min-w-0 flex-col">
        <label
          id={labelId}
          htmlFor={id}
          className={cn(
            'text-[0.9375rem]',
            disabled ? 'cursor-not-allowed text-ink-subtle' : 'cursor-pointer text-ink',
          )}
        >
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className={cn('text-sm', disabled ? 'text-ink-subtle' : 'text-ink-muted')}>
            {description}
          </span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          // The focus ring is drawn on the track, not on the larger invisible target.
          'group/switch grid shrink-0 items-center justify-items-end focus-visible:outline-hidden',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          CONTROL_HEIGHT[density],
          size.targetWidth,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center rounded-full border p-0.5 transition-[background-color,border-color] duration-120 ease-standard',
            'group-focus-visible/switch:outline-2 group-focus-visible/switch:outline-offset-2 group-focus-visible/switch:outline-ring',
            size.track,
            track,
          )}
        >
          <span
            className={cn(
              'rounded-full border bg-surface transition-[translate,border-color,box-shadow] duration-120 ease-standard motion-reduce:transition-none',
              size.thumb,
              // On, the thumb goes to the end in its own direction (`:dir`, not an ancestor's
              // attribute), flat on the brand track; off, its hairline carries the lift.
              checked
                ? 'translate-x-5 border-transparent [&:dir(rtl)]:-translate-x-5'
                : cn('shadow-e1', disabled ? 'border-line-control/50' : 'border-line-control'),
            )}
          />
        </span>
      </button>
    </div>
  );
}
