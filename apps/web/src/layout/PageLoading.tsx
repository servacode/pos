import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Skeleton } from '@serva/ui';
import { LATE_AFTER_MS } from '../admin/reports/useReport';
import { AppShell } from './AppShell';

/**
 * What a page that is still being fetched shows once the person is signed in: the real shell
 * (sidebar, top bar) with grey blocks where the page goes, never a full-screen splash. After
 * two seconds it says «جارٍ التحميل…».
 */
export function PageLoading() {
  const { pathname } = useLocation();
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), LATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <AppShell>
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48 max-w-full" />
        {pathname === '/' ? (
          // The home page's own shape: the green hero, a row of figures, the chart beside «تحتاج انتباهك»
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-36 w-full max-w-full rounded-panel" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24 max-sm:hidden" />
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          </div>
        ) : pathname === '/welcome' ? (
          // The wizard's own shape: the step line, a title and one card
          <div aria-hidden="true" className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : (
          <>
            <Skeleton className="h-24 w-full max-w-full" />
            <Skeleton className="h-64 w-full max-w-full" />
          </>
        )}
        <p className="text-sm text-ink-muted">
          {late ? 'جارٍ التحميل…' : <span className="sr-only">جارٍ التحميل…</span>}
        </p>
      </div>
    </AppShell>
  );
}
