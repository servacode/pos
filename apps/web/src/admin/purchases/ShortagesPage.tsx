import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ShortageRow, ShortagesResponse } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CheckIcon,
  EmptyState,
  formatQuantity,
  InboxIcon,
  PageHeader,
  Skeleton,
  useDigits,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { listShortages, resolveShortages } from './shortagesApi';

const NO_SUPPLIER = 'بلا مورد معروف';

/** The list grouped by the supplier each item was last bought from, so one tap starts that supplier's order */
export function groupShortages(items: readonly ShortageRow[]) {
  const groups = new Map<string, { supplierId: string | null; name: string; rows: ShortageRow[] }>();
  for (const row of items) {
    const key = row.lastSupplierId ?? '';
    const group = groups.get(key) ?? {
      supplierId: row.lastSupplierId,
      name: row.lastSupplierName ?? NO_SUPPLIER,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  // The known suppliers first, the rest last
  return [...groups.values()].sort((a, b) => Number(a.supplierId === null) - Number(b.supplierId === null));
}

/** Sent or part-received orders already owe it: the card says so and does not push a second order */
const isOrdered = (r: ShortageRow) => (r.orderNumbers?.length ?? 0) > 0 && (r.onOrderQty ?? 0) > 0;
const allOrdered = (rows: readonly ShortageRow[]) => rows.length > 0 && rows.every(isOrdered);

const REASON: Record<ShortageRow['reason'], { text: string; tone: 'warning' | 'info' | 'danger' }> = {
  below_min: { text: 'تحت الحد الأدنى', tone: 'warning' },
  requested: { text: 'طلبه زبون', tone: 'info' },
  both: { text: 'تحت الحد وطلبه زبون', tone: 'danger' },
};

/**
 * «النواقص» (round 38, pharmacy): what is at or under its minimum, and what customers asked for while the shelf had
 * none («طلبو زبون وما كان موجود»). It feeds the order suggestion: «اطلب من المورد» opens a new order for the
 * supplier it was last bought from, with the suggestion already made. «تم توفيره» closes the customers' requests
 * (a purchase received afterwards closes them by itself).
 */
export function ShortagesPage() {
  const digits = useDigits();
  const navigate = useNavigate();
  const [data, setData] = useState<ShortagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listShortages()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const groups = useMemo(() => groupShortages(data?.items ?? []), [data]);

  async function resolve(row: ShortageRow) {
    setBusy(row.name);
    setError(null);
    try {
      setData(await resolveShortages(row.requestIds));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell>
      <title>النواقص · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="النواقص"
          description="أصناف وصلت حدها الأدنى، وأصناف طلبها زبائن وما كانت موجودة. منها تبدأ طلبية المورد."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!data && !error ? (
          <Skeleton className="h-40 w-full" />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="لا نواقص الآن."
            description="يظهر هنا الصنف إذا وصل حده الأدنى، أو سجّل الكاشير أن زبوناً طلبه وما كان موجوداً."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <Card key={group.supplierId ?? 'none'} aria-label={group.name}>
                <CardHeader
                  title={group.name}
                  description={`${formatQuantity(group.rows.length * 1000, digits)} من الأصناف`}
                  action={
                    group.supplierId ? (
                      <Button
                        variant={allOrdered(group.rows) ? 'secondary' : 'primary'}
                        size="md"
                        onClick={() =>
                          void navigate(`/purchase-orders/new?supplier=${group.supplierId}&suggest=1`)
                        }
                      >
                        {allOrdered(group.rows) ? 'اطلب مرة تانية' : 'اطلب من المورد'}
                      </Button>
                    ) : null
                  }
                />
                <ul aria-label={`نواقص ${group.name}`} className="flex flex-col divide-y divide-line">
                  {group.rows.map((r) => (
                    <li
                      key={r.variantId ?? r.name}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5"
                    >
                      <span className="flex min-w-0 flex-1 basis-44 flex-col">
                        <span className="font-semibold text-ink">{r.name}</span>
                        {r.genericName ? (
                          <span className="text-sm text-ink-muted">{r.genericName}</span>
                        ) : null}
                      </span>
                      <Badge tone={REASON[r.reason].tone}>{REASON[r.reason].text}</Badge>
                      {isOrdered(r) ? (
                        <Badge tone="success">{`انطلبت ب${(r.orderNumbers ?? []).join('، ')}`}</Badge>
                      ) : null}
                      <span className="text-sm text-ink-muted">
                        {r.stockQty === null ? (
                          'غير معرَّف في الأصناف'
                        ) : (
                          <>
                            المتوفر{' '}
                            <bdi className="num font-semibold text-ink">
                              {formatQuantity(r.stockQty, digits)}
                            </bdi>
                            {r.minStockQty !== null ? (
                              <>
                                {' '}
                                · الحد <bdi className="num">{formatQuantity(r.minStockQty, digits)}</bdi>
                              </>
                            ) : null}
                          </>
                        )}
                        {r.expiredQty ? (
                          <>
                            {' '}
                            · منتهي أو موقوف <bdi className="num">{formatQuantity(r.expiredQty, digits)}</bdi>
                          </>
                        ) : null}
                        {r.requestCount > 0 ? (
                          <>
                            {' '}
                            · طُلب <bdi className="num">
                              {formatQuantity(r.requestCount * 1000, digits)}
                            </bdi>{' '}
                            مرة
                            {r.lastRequestedAt ? (
                              <> · آخرها {dayText(r.lastRequestedAt.slice(0, 10), digits)}</>
                            ) : null}
                          </>
                        ) : null}
                      </span>
                      {r.requestIds.length > 0 ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<CheckIcon size={20} />}
                          loading={busy === r.name}
                          aria-label={`تم توفيره: ${r.name}`}
                          onClick={() => void resolve(r)}
                        >
                          تم توفيره
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
