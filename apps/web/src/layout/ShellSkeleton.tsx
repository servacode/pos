import { AdminShell, Logo, Skeleton, cn } from '@serva/ui';

/**
 * What the store admin shows while its session is restored from the server: the shell itself
 * (sidebar, top bar, a titled page of grey blocks) instead of a logo splash, so the page frame is
 * there from the first paint and the content fills in. No names or links: nothing is known yet.
 */
export function ShellSkeleton() {
  return (
    <AdminShell
      sidebar={
        <div role="status" aria-busy="true" className="flex flex-1 flex-col">
          <span className="sr-only">جارٍ التحميل…</span>
          <div className="flex h-8 shrink-0 items-center px-1.5">
            <Logo />
          </div>
          <div aria-hidden="true" className="mt-6 flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton
                key={index}
                className={cn('h-10 bg-sidebar-hover', index % 3 === 2 ? 'w-4/5' : 'w-full')}
              />
            ))}
          </div>
        </div>
      }
      topBar={
        <>
          <Skeleton className="h-6 w-40 max-w-full" />
          <span className="flex-1" />
          <Skeleton className="size-10 rounded-full" />
        </>
      }
    >
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-24 w-full max-w-full" />
        <Skeleton className="h-64 w-full max-w-full" />
      </div>
    </AdminShell>
  );
}
