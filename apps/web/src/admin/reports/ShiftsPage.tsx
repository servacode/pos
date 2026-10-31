import { useState } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode } from '@serva/core';
import { Badge, Card, ClockIcon, DataTable, EmptyState, Money, useDigits, type DataColumn } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay, zonedClock } from '../../lib/dates';
import { SHIFTS_ACCESS } from './access';
import { listShifts } from './api';
import type { ShiftSummary } from './contracts';
import { BranchSelect, DayField, defaultBranch, PageHead, ReportScreen } from './parts';
import { useReport } from './useReport';

export function ShiftStatus({ status }: { status: ShiftSummary['status'] }) {
  return status === 'open' ? <Badge tone="success">مفتوحة</Badge> : <Badge>مغلقة</Badge>;
}

/**
 * «الورديات» (11 › الورديات; admin/ReturnsShifts › الورديات): the day's shifts in a branch, each
 * with its device, who opened it, when it opened and closed, and its sales; each opens its close
 * report.
 */
export function ShiftsPage() {
  const me = useMe();
  const digits = useDigits();
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const [date, setDate] = useState(today);
  const { data, error, loading, retry } = useReport(`${branchId ?? ''}|${date}`, () =>
    listShifts({ branchId, date }),
  );
  const base: CurrencyCode = me.settings.baseCurrency;
  const tz = me.tenant.timezone;
  const rows = data?.items ?? [];
  const salesTotal = rows.reduce((sum, row) => sum + row.salesTotalMinor, 0);
  const salesCount = rows.reduce((sum, row) => sum + row.salesCount, 0);

  const columns: DataColumn<ShiftSummary>[] = [
    {
      key: 'number',
      header: 'الوردية',
      cell: (row) => (
        <Link
          to={`/shifts/${encodeURIComponent(row.id)}`}
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          <bdi className="num" dir="ltr">
            {row.number}
          </bdi>
        </Link>
      ),
      total: 'المجموع',
    },
    { key: 'device', header: 'الجهاز', cell: (row) => <bdi className="num">{row.deviceCode}</bdi> },
    { key: 'openedBy', header: 'فتحها', cell: (row) => row.openedBy?.fullName ?? 'غير معروف' },
    {
      key: 'openedAt',
      header: 'الفتح',
      cell: (row) => (row.openedAt ? zonedClock(row.openedAt, tz, digits) : '—'),
    },
    {
      key: 'closedAt',
      header: 'الإغلاق',
      cell: (row) =>
        row.closedAt ? zonedClock(row.closedAt, tz, digits) : <ShiftStatus status={row.status} />,
    },
    { key: 'count', header: 'الفواتير', numeric: true, cell: (row) => row.salesCount, total: salesCount },
    {
      key: 'total',
      header: 'المبيعات',
      numeric: true,
      cell: (row) => <Money minor={row.salesTotalMinor} currency={base} />,
      total: <Money minor={salesTotal} currency={base} />,
    },
  ];

  return (
    <ReportScreen me={me} access={SHIFTS_ACCESS} title="الورديات">
      <PageHead crumbs={['البيع', 'المبيعات']} title="الورديات" subtitle="سجل الورديات وتقارير إغلاقها" />
      <Card className="flex flex-wrap items-end gap-4">
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
        <DayField label="اليوم" value={date} max={today} onChange={setDate} />
      </Card>
      <DataTable
        caption={`ورديات ${dayText(date, digits)}`}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        error={error ?? undefined}
        onRetry={retry}
        empty={
          <EmptyState
            icon={ClockIcon}
            title="لا ورديات في هذا اليوم."
            description="تظهر الوردية هنا حين يفتحها الكاشير على جهازه وتصل."
          />
        }
      />
    </ReportScreen>
  );
}
