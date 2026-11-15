import { useEffect, useState } from 'react';
import { Skeleton } from '@serva/ui';
import { LATE_AFTER_MS } from '../admin/reports/useReport';
import { AppShell } from './AppShell';

/**
 * What a page that is still being fetched shows once the person is signed in: the real shell
 * (sidebar, top bar) with grey blocks where the page goes, never a full-screen splash. After
 * two seconds it says «جارٍ التحميل…».
 */
export function PageLoading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), LATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <AppShell>
      <div role="status" aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-24 w-full max-w-full" />
        <Skeleton className="h-64 w-full max-w-full" />
        <p className="text-sm text-ink-muted">
          {late ? 'جارٍ التحميل…' : <span className="sr-only">جارٍ التحميل…</span>}
        </p>
      </div>
    </AppShell>
  );
}
