import { cn } from './cn';
import { AlertCircleIcon } from './icons';

/** What is wrong with a field, under it: the danger ink with an icon, never colour alone. */
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
      {/* One line tall, so the icon centres on the first line however the message wraps. */}
      <span className="flex h-lh shrink-0 items-center">
        <AlertCircleIcon size={16} />
      </span>
      <span>{children}</span>
    </p>
  );
}
