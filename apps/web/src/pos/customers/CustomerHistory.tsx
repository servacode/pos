import { useEffect, useState } from 'react';
import type { CustomerPurchases } from '@serva/core/contracts/customers';
import { Money } from '@serva/ui';
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

  if (data === null) return <p className="text-sm text-ink-muted">جارٍ تحميل مشتريات الزبون…</p>;
  if (data === 'none') return <p className="text-sm text-ink-muted">سجل الزبون يحتاج اتصالاً بالخادم.</p>;
  return (
    <section aria-label="مشتريات الزبون" className="flex flex-col gap-2 rounded-control bg-surface-muted p-3">
      {data.sizes.length > 0 ? (
        <ul aria-label="مقاساته" className="flex flex-wrap gap-2">
          {data.sizes.map((s) => (
            <li key={s.name} className="text-sm">
              <span className="text-ink-muted">{s.name}: </span>
              {s.values.map((v, i) => (
                <span key={v.value} className={i === 0 ? 'font-bold text-brand-ink' : 'text-ink'}>
                  {i > 0 ? '، ' : ''}
                  {v.value} <span className="num text-xs text-ink-muted">×{v.qty / 1000}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      {data.invoices.length === 0 ? (
        <p className="text-sm text-ink-muted">لم يشترِ شيئاً بعد.</p>
      ) : (
        <ul aria-label="فواتيره" className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
          {data.invoices.map((inv) => (
            <li key={inv.id} className="flex flex-col border-b border-line pb-1 last:border-0">
              <span className="flex items-center justify-between gap-2">
                <bdi dir="ltr" className="num font-semibold">
                  {inv.number}
                </bdi>
                <span className="num text-ink-muted">{inv.date}</span>
                <Money minor={inv.totalMinor} currency={inv.currency} />
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
