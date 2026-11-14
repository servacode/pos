import { useState } from 'react';
import type { CancellationRow, CancellationsResponse } from '@serva/core';
import { Badge, DataTable, PageHeader, ReportsIcon, SegmentedControl, type DataColumn } from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { apiFetch } from '../../lib/api';
import { daysAgo } from './MerchandisePage';
import { useReport } from './useReport';

const PERIODS = { '1': 'اليوم', '7': 'آخر 7 أيام', '30': 'آخر 30 يوماً' } as const;

export const getCancellations = (from: string, to: string) =>
  apiFetch<CancellationsResponse>(`/v1/hall/cancellations?from=${from}&to=${to}`, { auth: true });

const timeText = (iso: string) =>
  new Date(iso).toLocaleString('ar-SY-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' });

const COLUMNS: DataColumn<CancellationRow>[] = [
  { key: 'at', header: 'الوقت', cell: (r) => <bdi dir="ltr">{timeText(r.at)}</bdi> },
  { key: 'table', header: 'الطاولة', cell: (r) => r.table },
  {
    key: 'item',
    header: 'الصنف',
    cell: (r) => (
      <span>
        {r.qty > 1 ? `${r.qty}× ` : ''}
        {r.item}
      </span>
    ),
  },
  {
    key: 'stage',
    header: 'متى',
    cell: (r) =>
      r.stage === 'after_prep' ? (
        <Badge tone="danger">بعد التحضير</Badge>
      ) : (
        <Badge tone="warning">قبل التحضير</Badge>
      ),
  },
  { key: 'reason', header: 'السبب', cell: (r) => r.reason },
  { key: 'waiter', header: 'النادل', cell: (r) => r.waiterName ?? '—' },
  { key: 'approver', header: 'وافق المدير', cell: (r) => r.approverName ?? '—' },
];

/**
 * «الإلغاءات بعد المطبخ» (03 › المطاعم): every item cancelled after it was sent to the kitchen, with
 * the reason, the waiter and the manager who approved it, so the owner sees what is thrown away.
 */
export function CancellationsPage() {
  const [period, setPeriod] = useState<keyof typeof PERIODS>('7');
  const from = daysAgo(Number(period) - 1);
  const to = daysAgo(0);
  const report = useReport(`${from}:${to}`, () => getCancellations(from, to));
  return (
    <AppShell>
      <title>الإلغاءات بعد المطبخ · SERFA</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          icon={<ReportsIcon />}
          title="الإلغاءات بعد المطبخ"
          description="كل صنف أُلغي بعد وصوله للمطبخ، بسببه واسم النادل والمدير الذي وافق."
          actions={
            <SegmentedControl
              label="الفترة"
              value={period}
              onValueChange={setPeriod}
              options={(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((value) => ({
                value,
                label: PERIODS[value],
              }))}
            />
          }
        />
        <DataTable
          caption="الإلغاءات بعد المطبخ"
          columns={COLUMNS}
          rows={report.data?.items ?? []}
          rowKey={(r) => `${r.at}:${r.table}:${r.item}`}
          loading={report.loading}
          {...(report.error ? { error: report.error, onRetry: report.retry } : {})}
          empty="لا إلغاءات في هذه الفترة."
        />
      </div>
    </AppShell>
  );
}
