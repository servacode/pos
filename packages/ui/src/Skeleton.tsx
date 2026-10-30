import { cn } from './cn';

/**
 * A grey placeholder in the shape of the content while it loads (tab 14 › الهيكل الرمادي). Hidden
 * from screen readers: the region that loads says aria-busy instead.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-small bg-surface-muted motion-safe:animate-skeleton', className)}
    />
  );
}

/** Lines of text in loading: the last one shorter, as real text ends. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-4', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}
