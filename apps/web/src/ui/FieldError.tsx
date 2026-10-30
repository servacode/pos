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
      <AlertCircleIcon size={16} className="mt-[0.2rem]" />
      <span>{children}</span>
    </p>
  );
}
