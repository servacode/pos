import { cn } from '../lib/cn';
import { AlertCircleIcon } from './icons';

export function FieldError({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: string;
}) {
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-sm text-danger-ink', className)}>
      <AlertCircleIcon className="mt-[0.2rem] size-4" />
      <span>{children}</span>
    </p>
  );
}
