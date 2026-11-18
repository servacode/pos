import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Alert, cn, CONTROL_HEIGHT, ScrollStrip, Skeleton } from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { useMe } from '../../auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';

/** The pages of «التوزيع», each behind the permission the server checks again */
const TABS = [
  { to: '/distribution/today', label: 'اليوم', permission: 'report.view' },
  { to: '/distribution/orders', label: 'الطلبيات', permission: 'sales_orders.manage' },
  { to: '/distribution/settlements', label: 'التسوية', permission: 'rep.settle' },
  { to: '/distribution/targets', label: 'الأهداف', permission: 'rep.targets' },
  { to: '/reports/distribution', label: 'التقارير', permission: 'report.view' },
  { to: '/distribution/routes', label: 'خطوط السير', permission: 'routes.manage' },
  { to: '/distribution/reps', label: 'المندوبون', permission: 'routes.manage' },
  { to: '/distribution/vans', label: 'السيارات', permission: 'routes.manage' },
  { to: '/distribution/regions', label: 'المناطق', permission: 'routes.manage' },
  { to: '/distribution/settings', label: 'الإعدادات', permission: 'routes.manage' },
] as const;

/** The frame of the distribution pages: the admin shell, and the pages as tabs under the header */
export function DistributionFrame() {
  const me = useMe();
  const tabs = TABS.filter((t) => me.user.permissions.includes(t.permission));
  return (
    <AppShell>
      <title>التوزيع · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <nav aria-label="صفحات التوزيع" className="-mb-2 border-b border-line">
          <ScrollStrip>
            <ul className="flex min-w-max gap-1">
              {tabs.map((tab) => (
                <li key={tab.to}>
                  <NavLink
                    to={tab.to}
                    className={({ isActive }) =>
                      cn(
                        CONTROL_HEIGHT.comfortable,
                        '-mb-px inline-flex items-center rounded-t-small border-b-2 px-3 text-[0.9375rem] font-semibold whitespace-nowrap focus-visible:-outline-offset-2',
                        isActive
                          ? 'border-brand text-ink'
                          : 'border-transparent text-ink-muted hover:text-ink',
                      )
                    }
                  >
                    {tab.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </ScrollStrip>
        </nav>
        {!me.subscription.repsEnabled ? (
          <Alert tone="info" title="التوزيع غير متاح في باقتك">
            المندوبون والطلبيات المسبقة تأتي مع الباقات الأعلى.{' '}
            <Link to="/subscription" className="font-semibold underline underline-offset-4">
              انتقل إلى باقة أعلى
            </Link>
          </Alert>
        ) : (
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <Outlet />
          </Suspense>
        )}
      </div>
    </AppShell>
  );
}

/** Loads a list when the page opens and again when asked; the error says what to do */
export function useLoad<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetcher()
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    // the fetcher is a module function: it never changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);
  return { data, error, reload: load, setData };
}

/** What a failed save shows: the fields the server marked, or one message */
export function saveFailure(e: unknown): { fields: Record<string, string>; message: string | null } {
  if (e instanceof ApiError && e.fields) return { fields: e.fields, message: null };
  return { fields: {}, message: errorMessage(e) };
}

/** Cancel and save at the foot of a dialog form */
export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-3 pt-1">{children}</div>;
}

/** Whole numbers typed in Arabic or Latin digits; null when it is not one in the range */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const clean = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  if (!/^\d{1,12}$/.test(clean)) return null;
  const n = Number(clean);
  return n >= min && n <= max ? n : null;
}

/** «12.5» → 12500 (thousandths); null when it is not a positive amount */
export function thousandths(text: string): number | null {
  const clean = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.')
    .trim();
  const n = Number(clean);
  return clean !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}

/** A quantity kept in thousandths, as it is read: 12500 → «12.5» */
export const qtyOf = (thousandths: number): string => String(Number((thousandths / 1000).toFixed(3)));

/** «خط»: counted in a list of routes */
export const ROUTE_NOUN = { one: 'خط واحد', two: 'خطان', few: 'خطوط', many: 'خطاً' } as const;
