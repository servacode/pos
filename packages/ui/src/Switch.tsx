import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { useDensity } from './context';

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * On/off for settings and features (kit .toggle, 52 × 32). A real role="switch" button; the whole
 * row, label included, is the touch target.
 */
export function Switch({ label, description, checked, onCheckedChange, disabled, className }: SwitchProps) {
  const density = useDensity();
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        density === 'touch' ? 'min-h-12' : 'min-h-11',
        disabled && 'opacity-50',
        className,
      )}
    >
      <span className="flex min-w-0 flex-col">
        <label htmlFor={id} className={cn('text-ink', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className="text-sm text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative grid shrink-0 place-items-center disabled:cursor-not-allowed',
          density === 'touch' ? 'h-12 w-15' : 'h-11 w-14',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-13 items-center rounded-full p-1 transition-colors duration-120 ease-standard',
            checked ? 'justify-end bg-brand' : 'justify-start bg-line-control',
          )}
        >
          <span className={cn('size-6 rounded-full shadow-e1', checked ? 'bg-on-brand' : 'bg-surface')} />
        </span>
      </button>
    </div>
  );
}
