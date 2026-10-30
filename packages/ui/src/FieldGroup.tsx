import { useId, type ReactNode } from 'react';
import { FieldError } from './FieldError';

interface FieldGroupProps {
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function FieldGroup({ legend, hint, error, children }: FieldGroupProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <fieldset aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      <div className="mt-3">{children}</div>
      {error ? (
        <FieldError id={errorId} className="mt-2">
          {error}
        </FieldError>
      ) : null}
    </fieldset>
  );
}
