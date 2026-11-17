import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode } from '@serva/core';
import { Badge, ClockIcon, cn, DataTable, EmptyState, Money, useDigits, type DataColumn } from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, isoDay, zonedClock } from '../../lib/dates';
import { seesDifference, SHIFTS_ACCESS } from './access';
import { getShift, listShifts } from './api';
import type { ShiftCurrencyRow, ShiftReport, ShiftSummary } from './contracts';
import { BranchSelect, DayField, defaultBranch, PageHead, ReportFilters, ReportScreen } from './parts';
import { useReport } from './useReport';

export function ShiftStatus({ status }: { status: ShiftSummary['status'] }) {
  return status === 'open' ? <Badge tone="success">مفتوحة</Badge> : <Badge>مغلقة</Badge>;
}

/** «عجز 1,500 ل.س», «زيادة 500 ل.س», «لا فرق» (print/ShiftReport › الفرق). */
export function Difference({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  if (minor === 0) return <span className="text-ink-muted">لا فرق</span>;
  return (
    <span className={cn('font-semibold', minor < 0 ? 'text-danger-ink' : 'text-ink')}>
      {minor < 0 ? 'عجز' : 'زيادة'} <Money minor={minor} currency={currency} signDisplay="never" />
    </span>
  );
}

/** One line per currency of a shift's drawer, or a dash while the figure does not exist yet */
function cashCell(report: ShiftReport | undefined, pick: (row: ShiftCurrencyRow) => ReactNode) {
  const lines = (report?.byCurrency ?? []).map((row) => ({ currency: row.currency, node: pick(row) }));
  const shown = lines.filter((line) => line.node !== null);
  if (shown.length === 0) return '—';
  return (
    <span className="flex flex-col">
      {shown.map((line) => (
        <span key={line.currency}>{line.node}</span>
      ))}
    </span>
  );
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

  // Expected, counted and the difference of every shift on the list: each one's close report, which
  // the server only fills for those who may see the difference.
  const showsCash = seesDifference(me);
  const [cash, setCash] = useState<Record<string, ShiftReport>>({});
  useEffect(() => {
    if (!showsCash || !data) return;
    let live = true;
    for (const row of data.items) {
      getShift(row.id)
        .then((report) => {
          if (live) setCash((all) => ({ ...all, [row.id]: report }));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [data, showsCash]);

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
      header: 'إجمالي المبيعات',
      numeric: true,
      cell: (row) => <Money minor={row.salesTotalMinor} currency={base} />,
      total: <Money minor={salesTotal} currency={base} />,
    },
    ...(showsCash
      ? ([
          {
            key: 'expected',
            header: 'المتوقع بالدرج',
            numeric: true,
            cell: (row) =>
              cashCell(cash[row.id], (c) =>
                c.expectedMinor === null ? null : <Money minor={c.expectedMinor} currency={c.currency} />,
              ),
          },
          {
            key: 'counted',
            header: 'المعدود',
            numeric: true,
            cell: (row) =>
              cashCell(cash[row.id], (c) =>
                c.countedMinor === null ? null : <Money minor={c.countedMinor} currency={c.currency} />,
              ),
          },
          {
            key: 'difference',
            header: 'الفرق',
            numeric: true,
            cell: (row) =>
              cashCell(cash[row.id], (c) =>
                c.differenceMinor === null ? null : (
                  <Difference minor={c.differenceMinor} currency={c.currency} />
                ),
              ),
          },
        ] satisfies DataColumn<ShiftSummary>[])
      : []),
  ];

  return (
    <ReportScreen me={me} access={SHIFTS_ACCESS} title="الورديات">
      <PageHead icon={<ClockIcon />} title="الورديات" subtitle="سجل الورديات وتقارير إغلاقها" />
      <ReportFilters>
        <BranchSelect me={me} value={branchId} onChange={setBranchId} />
        <DayField label="اليوم" value={date} max={today} onChange={setDate} />
      </ReportFilters>
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
