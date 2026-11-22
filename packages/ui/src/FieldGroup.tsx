import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { FieldError } from './FieldError';
import { FIELD_HINT, FIELD_LABEL } from './TextField';

interface FieldGroupProps {
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/**
 * Related controls under one question (a few checkboxes, chips): the legend reads like a field's
 * label, with the fields' 6 px rhythm between legend, hint, controls and error.
 */
export function FieldGroup({ legend, hint, error, children }: FieldGroupProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <fieldset aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}>
      <legend className={FIELD_LABEL}>{legend}</legend>
      {hint ? (
        <p id={hintId} className={cn(FIELD_HINT, 'mt-1.5')}>
          {hint}
        </p>
      ) : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <FieldError id={errorId} className="mt-1.5">
          {error}
        </FieldError>
      ) : null}
    </fieldset>
  );
}
