import { useEffect, useState } from 'react';
import type { CustomerPurchases } from '@serva/core/contracts/customers';
import { cn, Money, OfflineIcon, Skeleton } from '@serva/ui';
import { APP_VERSION } from '../../offline/sync';
import { usePos } from '../services';

/** GET /v1/device/customers/{id}/purchases (`Authorization: Device <token>`); null without an answer */
export async function fetchPurchases(
  id: string,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<CustomerPurchases | null> {
  try {
    const res = await fetchFn(`/v1/device/customers/${encodeURIComponent(id)}/purchases`, {
      headers: { Accept: 'application/json', Authorization: `Device ${token}`, 'X-App-Version': APP_VERSION },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as CustomerPurchases;
  } catch {
    return null;
  }
}

/**
 * «مشترياته» (03 › الألبسة: سجل الزبون ومقاسه): the sizes the picked customer buys most and the
 * latest invoices, to advise («ريم تلبس M») and to find a sale for an exchange without its receipt.
 * Read from the server; a till offline says so.
 */
export function CustomerHistory({ customerId }: { customerId: string }) {
  const pos = usePos();
  const [data, setData] = useState<CustomerPurchases | null | 'none'>(null);

  useEffect(() => {
    let alive = true;
    const token = pos.device.token;
    if (!pos.online() || !token) {
      setData('none');
      return;
    }
    void fetchPurchases(customerId, token, pos.fetch).then((got) => alive && setData(got ?? 'none'));
    return () => {
      alive = false;
    };
  }, [customerId, pos]);

  if (data === null) {
    return (
      <div
        aria-busy="true"
        className="flex flex-col gap-2 rounded-card border border-line bg-surface-muted/50 p-3"
      >
        <p className="text-sm text-ink-muted">جارٍ تحميل مشتريات الزبون…</p>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (data === 'none') {
    return (
      <p className="flex items-center gap-2 rounded-card border border-line bg-surface-muted/50 px-3 py-2.5 text-sm text-ink-muted">
        <OfflineIcon size={16} className="shrink-0 text-ink-subtle" />
        سجل الزبون يحتاج اتصالاً بالخادم.
      </p>
    );
  }
  return (
    <section
      aria-label="مشتريات الزبون"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface-muted/50 p-3"
    >
      {data.sizes.length > 0 ? (
        <ul aria-label="مقاساته" className="flex flex-col gap-2">
          {data.sizes.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-ink-muted">{s.name}: </span>
              {s.values.map((v, i) => (
                <span
                  key={v.value}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-small border px-2 py-0.5 font-semibold',
                    i === 0
                      ? 'border-brand/30 bg-brand-soft text-brand-ink'
                      : 'border-line bg-surface text-ink',
                  )}
                >
                  {/* «، » stays in the text for screen readers and copying; the chips draw the gap */}
                  {i > 0 ? <span className="sr-only">، </span> : null}
                  {v.value} <span className="num text-xs font-normal text-ink-muted">×{v.qty / 1000}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {data.invoices.length === 0 ? (
        <p className="text-sm text-ink-muted">لم يشترِ شيئاً بعد.</p>
      ) : (
        <ul aria-label="فواتيره" className="flex max-h-48 flex-col overflow-y-auto text-sm">
          {data.invoices.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-col gap-0.5 border-b border-line py-2 first:pt-0 last:border-0 last:pb-0"
            >
              <span className="flex items-center justify-between gap-2">
                <bdi dir="ltr" className="num font-semibold text-ink">
                  {inv.number}
                </bdi>
                <span className="num text-xs text-ink-subtle">{inv.date}</span>
                <Money minor={inv.totalMinor} currency={inv.currency} className="font-semibold text-ink" />
              </span>
              <span className="text-ink-muted">
                {inv.lines
                  .map(
                    (l) =>
                      `${l.name} ×${l.qty / 1000}${l.returnedQty > 0 ? ` (رجع ${l.returnedQty / 1000})` : ''}`,
                  )
                  .join('، ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
