import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CurrencyCode } from '@serva/core';
import {
  Badge,
  Button,
  ClockIcon,
  cn,
  DataTable,
  EmptyState,
  exactDecimals,
  Money,
  useDigits,
  type Digits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { useIsPhone } from '../../lib/useIsPhone';
import { dayText, isoDay, zonedClock, zonedDateTime } from '../../lib/dates';
import { seesDifference, SHIFTS_ACCESS } from './access';
import { getShift, listShifts } from './api';
import type { ShiftCurrencyRow, ShiftReport, ShiftSummary } from './contracts';
import { BranchSelect, DayField, defaultBranch, PageHead, ReportFilters, ReportScreen } from './parts';
import { useReport } from './useReport';

export function ShiftStatus({ status }: { status: ShiftSummary['status'] }) {
  return status === 'open' ? <Badge tone="success">مفتوحة</Badge> : <Badge>مغلقة</Badge>;
}

/** An amount with its half shown («28,372.50»), a whole one without a fraction: the same figure as the close report */
function Amount({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  return <Money minor={minor} currency={currency} decimals={exactDecimals(minor, currency)} />;
}

/** «عجز 1,500 ل.س», «زيادة 500 ل.س», «لا فرق» (print/ShiftReport › الفرق). */
export function Difference({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  if (minor === 0) return <span className="text-ink-muted">لا فرق</span>;
  return (
    <span className={cn('font-semibold', minor < 0 ? 'text-danger-ink' : 'text-ink')}>
      {minor < 0 ? 'عجز' : 'زيادة'}{' '}
      <Money
        minor={minor}
        currency={currency}
        signDisplay="never"
        decimals={exactDecimals(minor, currency)}
      />
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

const DAY_MS = 86_400_000;

/** «منذ 3 أيام» / «منذ 30 ساعة»: how long a shift has been open */
function ageText(openedAt: string, now: number): string {
  const hours = Math.max(1, Math.floor((now - Date.parse(openedAt)) / 3_600_000));
  return hours >= 48 ? `منذ ${Math.floor(hours / 24)} يوماً` : `منذ ${hours} ساعة`;
}

/**
 * Shifts still open more than 24 hours after they opened, of any day, above the day's list: who opened
 * each one and on which device. Display only; a shift is closed from its own till or by a manager there.
 */
function StaleOpenShifts({ branchId, tz, digits }: { branchId: string | null; tz: string; digits: Digits }) {
  const { data } = useReport(`open|${branchId ?? ''}`, () => listShifts({ branchId, status: 'open' }));
  const now = Date.now();
  const stale = (data?.items ?? []).filter((s) => s.openedAt && now - Date.parse(s.openedAt) > DAY_MS);
  const [all, setAll] = useState(false);
  if (stale.length === 0) return null;
  const shown = all ? stale : stale.slice(0, 5);
  return (
    <section
      aria-labelledby="stale-shifts"
      className="flex flex-col gap-2 rounded-card border border-line bg-warning-soft p-3"
    >
      <h2 id="stale-shifts" className="text-base font-semibold text-warning-ink">
        ورديات مفتوحة منذ أكثر من 24 ساعة (<span className="num">{stale.length}</span>)
      </h2>
      <p className="text-sm text-ink-muted">يقفلها الكاشير أو المدير من جهازها.</p>
      <ul className="flex flex-col">
        {shown.map((row) => (
          <li key={row.id} className="flex flex-col border-b border-line py-1 text-sm last:border-0">
            <span className="flex items-center justify-between gap-3">
              <Link
                to={`/shifts/${encodeURIComponent(row.id)}`}
                className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline-offset-4 hover:underline"
              >
                <bdi className="num" dir="ltr">
                  {row.number}
                </bdi>
              </Link>
              <span className="font-semibold text-warning-ink">
                {row.openedAt ? ageText(row.openedAt, now) : ''}
              </span>
            </span>
            <span className="pb-1 text-ink-muted">
              الجهاز <bdi className="num">{row.deviceCode}</bdi> · فتحها{' '}
              {row.openedBy?.fullName ?? 'غير معروف'}
              {row.openedAt ? ` · ${zonedDateTime(row.openedAt, tz, digits)}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {stale.length > 5 ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? 'أخفِ الباقي' : `اعرض الكل (${stale.length})`}
        </Button>
      ) : null}
    </section>
  );
}

/** One shift as a card on a phone: number and status, device and opener, times, sales, then the drawer figures */
function ShiftCard({
  row,
  base,
  tz,
  digits,
  cash,
  showsCash,
}: {
  row: ShiftSummary;
  base: CurrencyCode;
  tz: string;
  digits: Digits;
  cash: ShiftReport | undefined;
  showsCash: boolean;
}) {
  const line = (label: string, value: ReactNode) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-end font-semibold">{value}</dd>
    </div>
  );
  return (
    <li className="flex flex-col gap-2 border-b border-line p-3 text-sm last:border-0">
      <div className="flex items-center justify-between gap-2">
        <Link
          to={`/shifts/${encodeURIComponent(row.id)}`}
          className="inline-flex min-h-11 items-center font-semibold text-brand-ink underline-offset-4 hover:underline"
        >
          <bdi className="num" dir="ltr">
            {row.number}
          </bdi>
        </Link>
        <ShiftStatus status={row.status} />
      </div>
      <dl className="flex flex-col gap-1">
        {line('الجهاز', <bdi className="num">{row.deviceCode}</bdi>)}
        {line('فتحها', row.openedBy?.fullName ?? 'غير معروف')}
        {line('الفتح', row.openedAt ? zonedClock(row.openedAt, tz, digits) : '—')}
        {line('الإغلاق', row.closedAt ? zonedClock(row.closedAt, tz, digits) : '—')}
        {line('الفواتير', <span className="num">{row.salesCount}</span>)}
        {line('إجمالي المبيعات', <Amount minor={row.salesTotalMinor} currency={base} />)}
        {showsCash
          ? [
              line(
                'المتوقع بالدرج',
                cashCell(cash, (c) =>
                  c.expectedMinor === null ? null : <Amount minor={c.expectedMinor} currency={c.currency} />,
                ),
              ),
              line(
                'المعدود',
                cashCell(cash, (c) =>
                  c.countedMinor === null ? null : <Amount minor={c.countedMinor} currency={c.currency} />,
                ),
              ),
              line(
                'الفرق',
                cashCell(cash, (c) =>
                  c.differenceMinor === null ? null : (
                    <Difference minor={c.differenceMinor} currency={c.currency} />
                  ),
                ),
              ),
            ].map((node, i) => <Fragment key={i}>{node}</Fragment>)
          : null}
      </dl>
    </li>
  );
}

/**
 * «الورديات» (11 › الورديات; admin/ReturnsShifts › الورديات): the day's shifts in a branch, each
 * with its device, who opened it, when it opened and closed, and its sales; each opens its close
 * report.
 */
export function ShiftsPage() {
  const me = useMe();
  const phone = useIsPhone();
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
      cell: (row) => <Amount minor={row.salesTotalMinor} currency={base} />,
      total: <Amount minor={salesTotal} currency={base} />,
    },
    ...(showsCash
      ? ([
          {
            key: 'expected',
            header: 'المتوقع بالدرج',
            numeric: true,
            cell: (row) =>
              cashCell(cash[row.id], (c) =>
                c.expectedMinor === null ? null : <Amount minor={c.expectedMinor} currency={c.currency} />,
              ),
          },
          {
            key: 'counted',
            header: 'المعدود',
            numeric: true,
            cell: (row) =>
              cashCell(cash[row.id], (c) =>
                c.countedMinor === null ? null : <Amount minor={c.countedMinor} currency={c.currency} />,
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
      <StaleOpenShifts branchId={branchId} tz={tz} digits={digits} />
      {phone && rows.length > 0 && !loading ? (
        <ul
          aria-label={`ورديات ${dayText(date, digits)}`}
          className="overflow-hidden rounded-card border border-line bg-surface shadow-e1"
        >
          {rows.map((row) => (
            <ShiftCard
              key={row.id}
              row={row}
              base={base}
              tz={tz}
              digits={digits}
              cash={cash[row.id]}
              showsCash={showsCash}
            />
          ))}
          <li className="flex items-baseline justify-between gap-3 bg-surface-total p-3 text-sm font-bold">
            <span>المجموع</span>
            <span>
              <span className="num">{salesCount}</span> فاتورة · <Amount minor={salesTotal} currency={base} />
            </span>
          </li>
        </ul>
      ) : (
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
      )}
    </ReportScreen>
  );
}
