import { Logo, LogoMark, Skeleton, cn } from '@serva/ui';
import './shell.css';

/** A resting grey block for the dark surfaces (sidebar, top bar): a pale pulsing one would shout there. */
function Dim({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-small', className)}
      style={{ background: 'var(--color-sidebar-hover)' }}
    />
  );
}

/** Rows of the real sidebar's groups (the thin line between them is a group's heading). */
const GROUPS = [2, 4, 4, 3];

/** The sidebar's fold, as AppShell keeps it on this device ('serva.sidebar'). */
function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem('serva.sidebar') === 'collapsed';
  } catch {
    return false;
  }
}

/**
 * What the store admin shows while its session is restored from the server: the shell itself
 * (sidebar, top bar, a titled page of grey blocks) instead of a logo splash, so the page frame is
 * there from the first paint and the content fills in. No names or links: nothing is known yet.
 */
export function ShellSkeleton() {
  // The same fold the real shell will open with (kept on this device), so the sidebar does not jump
  const rail = readCollapsed();
  return (
    <div className="sh-app">
      <div className="sh-sbwrap" data-rail={rail}>
        <aside className="sh-aside" aria-label="الشريط الجانبي" data-rail={rail}>
          <div className="sh-panel" role="status" aria-busy="true">
            <span className="sr-only">جارٍ التحميل…</span>
            <div className="sh-head">
              <div className="sh-wm">
                <span className="sh-wm-link">
                  {rail ? <LogoMark tone="sidebar" /> : <Logo tone="sidebar" size="lg" />}
                </span>
              </div>
            </div>
            <div aria-hidden="true" className="sh-nav">
              {GROUPS.map((rows, group) => (
                <div key={group} className="sh-grp">
                  {group > 0 ? <p className="sh-gl" /> : null}
                  <ul className="sh-list">
                    {Array.from({ length: rows }, (_, index) => (
                      <li key={index} className="sh-it">
                        <Dim className="size-6 shrink-0" />
                        {rail ? null : <Dim className={cn('h-4', index % 2 ? 'w-24' : 'w-32')} />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="sh-foot">
              <Dim className="h-[52px] w-full" />
            </div>
          </div>
        </aside>
      </div>
      <div className="sh-main">
        <header className="sh-header">
          <div className="sh-top">
            <Dim className="h-6 w-40 max-w-full" />
            <span className="flex-1" />
            <Dim className="h-[46px] w-56 max-w-full max-md:hidden" />
            <Dim className="size-10 rounded-control" />
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
