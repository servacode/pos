import { Logo, Skeleton, cn } from '@serva/ui';
import './shell.css';

/**
 * What the store admin shows while its session is restored from the server: the shell itself
 * (sidebar, top bar, a titled page of grey blocks) instead of a logo splash, so the page frame is
 * there from the first paint and the content fills in. No names or links: nothing is known yet.
 */
export function ShellSkeleton() {
  return (
    <div className="sh-app">
      <div className="sh-sbwrap">
        <aside className="sh-aside" aria-label="الشريط الجانبي">
          <div className="sh-panel" role="status" aria-busy="true">
            <span className="sr-only">جارٍ التحميل…</span>
            <div className="sh-head">
              <div className="sh-wm">
                <Logo tone="sidebar" />
              </div>
              <Skeleton className="h-14 w-full bg-sidebar-hover" />
            </div>
            <div aria-hidden="true" className="sh-nav flex flex-col gap-2">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton
                  key={index}
                  className={cn('h-9 bg-sidebar-hover', index % 3 === 2 ? 'w-4/5' : 'w-full')}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
      <div className="sh-main">
        <header className="sh-header">
          <div className="sh-top">
            <Skeleton className="h-6 w-40 max-w-full" />
            <span className="flex-1" />
            <Skeleton className="size-10 rounded-control" />
          </div>
        </header>
        <main className="sh-page">
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-8 w-48 max-w-full" />
            <Skeleton className="h-24 w-full max-w-full" />
            <Skeleton className="h-64 w-full max-w-full" />
          </div>
        </main>
      </div>
    </div>
  );
}
