import { useCallback, useEffect, useState } from 'react';
import type { ExpiryResponse, ExpiryRow } from '@serva/core';
import {
  Alert,
  Badge,
  CalendarIcon,
  DataTable,
  EmptyState,
  formatQuantity,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatTile,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { listExpiry } from './api';
import { SectionHead } from './parts';

type Urgency = 'all' | 'expired' | 'week' | 'month';

/** How soon a batch ends: gone, within the week, within the month (days from today). */
const IN_URGENCY: Record<Exclude<Urgency, 'all'>, (r: ExpiryRow) => boolean> = {
  expired: (r) => r.daysLeft < 0,
  week: (r) => r.daysLeft >= 0 && r.daysLeft <= 7,
  month: (r) => r.daysLeft >= 0 && r.daysLeft <= 30,
};

/**
 * «الصلاحية» (03 › الصيدليات): batches on the shelf that have expired or soon will, earliest first,
 * from the expiry typed on each purchase line. What is left of a batch is estimated: the stock is
 * taken from the newest receipts first, as the oldest sell first.
 */
export function ExpiryPage() {
  const digits = useDigits();
  const [days, setDays] = useState<'30' | '90' | '180'>('90');
  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urgency, setUrgency] = useState<Urgency>('all');

  const load = useCallback(() => {
    setError(null);
    listExpiry(Number(days))
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [days]);
  useEffect(load, [load]);

  const items = data?.items ?? [];
  const expired = items.filter(IN_URGENCY.expired);
  const week = items.filter(IN_URGENCY.week);
  const month = items.filter(IN_URGENCY.month);
  const shown = urgency === 'all' ? items : items.filter(IN_URGENCY[urgency]);

  const columns: DataColumn<ExpiryRow>[] = [
    { key: 'name', className: 'whitespace-nowrap', header: 'الصنف', cell: (r) => r.name },
    {
      key: 'left',
      className: 'whitespace-nowrap',
      header: 'الحالة',
      cell: (r) =>
        r.daysLeft < 0 ? (
          <Badge tone="danger">منتهٍ منذ {-r.daysLeft} يوماً</Badge>
        ) : r.daysLeft <= 30 ? (
          <Badge tone="warning">باقٍ {r.daysLeft} يوماً</Badge>
        ) : (
          <Badge tone="neutral">باقٍ {r.daysLeft} يوماً</Badge>
        ),
    },
    {
      key: 'expiry',
      className: 'whitespace-nowrap',
      header: 'تاريخ الانتهاء',
      cell: (r) => <bdi className="num">{r.expiryDate}</bdi>,
    },
    {
      key: 'batch',
      className: 'whitespace-nowrap',
      header: 'الدفعة',
      cell: (r) =>
        r.batchNo ? (
          <bdi dir="ltr" className="num">
            {r.batchNo}
          </bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      key: 'qty',
      header: 'على الرف (تقديراً)',
      numeric: true,
      cell: (r) => formatQuantity(r.qty, digits),
    },
    {
      key: 'purchase',
      className: 'whitespace-nowrap',
      header: 'الاستلام',
      cell: (r) => (
        <span className="flex flex-col items-start">
          <bdi dir="ltr" className="num text-sm">
            {r.purchaseNumber}
          </bdi>
          <span className="num text-xs text-ink-subtle">{r.receivedOn}</span>
        </span>
      ),
    },
  ];

  const count = (n: number) => (data ? n : <Skeleton className="h-9 w-12" />);
  return (
    <AppShell>
      <title>الصلاحية · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="الصلاحية"
          description="الدفعات على الرف التي انتهت أو تقترب من نهايتها، الأقرب أولاً."
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatTile
            label="منتهية"
            value={count(expired.length)}
            footnote={expired[0] ? `أقدمها: ${expired[0].name}` : data ? 'لا شيء منتهٍ على الرف' : undefined}
          />
          <StatTile
            label="تنتهي خلال 7 أيام"
            value={count(week.length)}
            footnote={week[0] ? `أقربها: ${week[0].name}` : data ? 'لا شيء هذا الأسبوع' : undefined}
          />
          <StatTile
            label="تنتهي خلال 30 يوماً"
            value={count(month.length)}
            footnote={month[0] ? `أقربها: ${month[0].name}` : data ? 'لا شيء هذا الشهر' : undefined}
          />
        </div>
        <section aria-label="الدفعات" className="flex flex-col gap-3">
          <SectionHead title="الدفعات" description="ما بقي من كل دفعة تقديري: الأقدم يُباع أولاً.">
            <SegmentedControl
              label="اعرض"
              value={urgency}
              onValueChange={setUrgency}
              options={[
                { value: 'all', label: 'الكل' },
                { value: 'expired', label: <UrgencyLabel text="منتهية" n={data ? expired.length : null} /> },
                { value: 'week', label: <UrgencyLabel text="هذا الأسبوع" n={data ? week.length : null} /> },
                { value: 'month', label: <UrgencyLabel text="هذا الشهر" n={data ? month.length : null} /> },
              ]}
            />
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="text-sm text-ink-muted">
                خلال
              </span>
              <SegmentedControl
                label="خلال"
                value={days}
                onValueChange={setDays}
                options={[
                  { value: '30', label: '30 يوماً' },
                  { value: '90', label: '3 أشهر' },
                  { value: '180', label: '6 أشهر' },
                ]}
              />
            </span>
          </SectionHead>
          <DataTable
            caption="الدفعات حسب الصلاحية"
            columns={columns}
            rows={shown}
            rowKey={(r) => `${r.purchaseNumber}-${r.variantId}`}
            loading={!data && !error}
            {...(error ? { onRetry: load } : {})}
            empty={
              items.length > 0 ? (
                <EmptyState
                  icon={CalendarIcon}
                  title="لا دفعات في هذه المجموعة."
                  description="اختر «الكل» لترى الباقي."
                />
              ) : (
                <EmptyState
                  icon={CalendarIcon}
                  title="لا شيء ينتهي في هذه المدة."
                  description="اكتب الدفعة وتاريخ الانتهاء في فاتورة الشراء ليظهر هنا."
                />
              )
            }
          />
        </section>
      </div>
    </AppShell>
  );
}

/** A group's name with how many batches it holds. */
function UrgencyLabel({ text, n }: { text: string; n: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {n !== null ? <span className="num text-xs text-ink-subtle">{n}</span> : null}
    </span>
  );
}
