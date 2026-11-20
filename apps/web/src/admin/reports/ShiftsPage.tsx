import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { CurrencyCode, ShiftCashSummary } from '@serva/core';
import {
  Alert,
  Button,
  CheckIcon,
  ClockIcon,
  cn,
  EmptyState,
  LockIcon,
  WarningIcon,
  useDigits,
  type Digits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { useIsPhone } from '../../lib/useIsPhone';
import { dayText, isoDay, zonedClock, zonedDateTime } from '../../lib/dates';
import {
  Amt,
  DayStepper,
  PageTop,
  Panel,
  PeriodChips,
  SalesPage,
  StatusPill,
  SxTable,
  type SxColumn,
} from '../sales/ui';
import { seesDifference, SHIFTS_ACCESS } from './access';
import { listShifts } from './api';
import type { ShiftSummary } from './contracts';
import type { DayRange } from './periods';
import { BranchSelect, DayField, defaultBranch, ReportScreen } from './parts';
import { useReport } from './useReport';

/** A shift's status: open is the one exception worth a fill, closed is quiet with its lock */
export function ShiftStatus({ status }: { status: ShiftSummary['status'] }) {
  return status === 'open' ? (
    <StatusPill kind="open">● مفتوحة</StatusPill>
  ) : (
    <StatusPill kind="ok" icon={<LockIcon size={16} />}>
      مغلقة
    </StatusPill>
  );
}

/** An amount with its half shown («28,372.50»), a whole one without a fraction: the same figure as the close report */
function Amount({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  return <Amt minor={minor} currency={currency} exact />;
}

/** «عجز 1,500 ل.س», «زيادة 500 ل.س», «لا فرق» (print/ShiftReport › الفرق). */
export function Difference({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  if (minor === 0) return <span className="text-ink-muted">لا فرق</span>;
  return (
    <span className={cn('font-semibold', minor < 0 ? 'text-danger-ink' : 'text-ink')}>
      {minor < 0 ? 'عجز' : 'زيادة'} <Amt minor={minor} currency={currency} signDisplay="never" exact />
    </span>
  );
}

/**
 * The difference of a shift's drawer as one badge per currency: «مطابق» quietly when every counted
 * currency is exact, a filled «عجز» or «زيادة» for each one that is not; «—» while nothing is counted.
 */
function DiffBadges({ cash }: { cash: ShiftCashSummary[] | undefined }) {
  const counted = (cash ?? []).filter((row) => row.differenceMinor !== null);
  if (counted.length === 0) return <span className="sx-z">—</span>;
  const off = counted.filter((row) => row.differenceMinor !== 0);
  if (off.length === 0) {
    return (
      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
        مطابق
      </StatusPill>
    );
  }
  return (
    <span className="sx-diff">
      {off.map((row) => {
        const diff = row.differenceMinor ?? 0;
        return (
          <StatusPill key={row.currency} kind={diff < 0 ? 'danger' : 'warn'} icon={<WarningIcon size={16} />}>
            {diff < 0 ? 'عجز' : 'زيادة'}{' '}
            <Amt minor={diff} currency={row.currency} signDisplay="never" exact />
          </StatusPill>
        );
      })}
    </span>
  );
}

const DAY_MS = 86_400_000;

/** «منذ 3 أيام» / «منذ 30 ساعة»: how long a shift has been open */
function ageText(openedAt: string, now: number): string {
  const hours = Math.max(1, Math.floor((now - Date.parse(openedAt)) / 3_600_000));
  const days = Math.floor(hours / 24);
  if (hours < 48) return `منذ ${hours} ساعة`;
  // 3 to 10 take the plural «أيام», 11 and more the singular «يوماً»
  return days <= 10 ? `منذ ${days} أيام` : `منذ ${days} يوماً`;
}

/**
 * One quiet line above the list when shifts have stayed open for more than a day, with a link to the
 * list filtered to them. Nothing here closes a shift: the server takes a close only from the till that
 * opened the shift (the close arrives as that till's document), so it is said once, in the filtered list.
 */
function StaleOpenLine({ branchId }: { branchId: string | null }) {
  const { data } = useReport(`open|${branchId ?? ''}`, () => listShifts({ branchId, status: 'open' }));
  const now = Date.now();
  const stale = (data?.items ?? []).filter((s) => s.openedAt && now - Date.parse(s.openedAt) > DAY_MS);
  if (stale.length === 0) return null;
  return (
    <p className="sx-quiet print:hidden">
      <ClockIcon size={16} />
      <span>
        فيه <span className="num">{stale.length}</span> ورديات مفتوحة من أكثر من يوم.
      </span>{' '}
      <Link to="/shifts?open=1">اعرضها</Link>
    </p>
  );
}

/** What one cashier's closed shifts came to in a currency: the shortages, the surpluses and what is left */
interface CashierFigures {
  shortMinor: number;
  overMinor: number;
}

interface CashierRow {
  key: string;
  name: string;
  /** Closed shifts that have a counted drawer */
  shifts: number;
  /** Per currency, in the currency's own units */
  byCurrency: Map<CurrencyCode, CashierFigures>;
}

/**
 * The shortage of each cashier over the shifts on the list: for every closed shift with a counted
 * drawer, the difference added to the cashier's shortage (below zero) or surplus (above), per
 * currency, since a Syrian pound and a dollar do not add up.
 */
export function cashierShortages(rows: readonly ShiftSummary[]): CashierRow[] {
  const byCashier = new Map<string, CashierRow>();
  for (const row of rows) {
    const diffs = (row.cash ?? []).filter((c) => c.differenceMinor !== null);
    if (diffs.length === 0) continue;
    const key = row.openedBy?.id ?? '—';
    let entry = byCashier.get(key);
    if (!entry) {
      entry = { key, name: row.openedBy?.fullName ?? 'غير معروف', shifts: 0, byCurrency: new Map() };
      byCashier.set(key, entry);
    }
    entry.shifts += 1;
    for (const c of diffs) {
      const figures = entry.byCurrency.get(c.currency) ?? { shortMinor: 0, overMinor: 0 };
      const diff = c.differenceMinor ?? 0;
      if (diff < 0) figures.shortMinor += -diff;
      else figures.overMinor += diff;
      entry.byCurrency.set(c.currency, figures);
    }
  }
  return [...byCashier.values()];
}

/** «وردية واحدة / ورديتان / 5 ورديات / 12 وردية» */
function shiftsNoun(n: number): string {
  if (n === 1) return 'وردية واحدة';
  if (n === 2) return 'ورديتان';
  return n >= 3 && n <= 10 ? `${n} ورديات` : `${n} وردية`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');

/** «فروق الصندوق لكل كاشير»: the owner's view of who is short, most short first */
function CashierShortagePanel({ rows, base }: { rows: readonly ShiftSummary[]; base: CurrencyCode }) {
  const cashiers = cashierShortages(rows).sort((a, b) => {
    const short = (r: CashierRow) =>
      (r.byCurrency.get(base)?.shortMinor ?? 0) - (r.byCurrency.get(base)?.overMinor ?? 0);
    return short(b) - short(a) || a.name.localeCompare(b.name, 'ar');
  });
  if (cashiers.length === 0) return null;
  return (
    <Panel title="فروق الصندوق لكل كاشير" aside="من الورديات المغلقة في القائمة أدناه" flush>
      <div className="sx-cslab">
        {cashiers.map((row) => {
          const nets = [...row.byCurrency.entries()].filter(([, f]) => f.overMinor - f.shortMinor !== 0);
          const bad = nets.some(([, f]) => f.overMinor - f.shortMinor < 0);
          const shorts = [...row.byCurrency.entries()].filter(([, f]) => f.shortMinor !== 0);
          const overs = [...row.byCurrency.entries()].filter(([, f]) => f.overMinor !== 0);
          return (
            <div key={row.key} className="sx-cs">
              <div className="who">
                <span className="sx-av" aria-hidden="true">
                  {initials(row.name)}
                </span>
                {row.name}
              </div>
              {nets.length === 0 ? (
                <span className="res">
                  <span className="sx-mute">لا فرق</span>
                </span>
              ) : (
                <span className={cn('res', bad && 'bad')}>
                  {nets.map(([currency, f]) => (
                    <Difference key={currency} minor={f.overMinor - f.shortMinor} currency={currency} />
                  ))}
                </span>
              )}
              <span className="sx-sub">
                {shiftsNoun(row.shifts)} مغلقة
                {shorts.length > 0 ? (
                  <>
                    {' · العجز '}
                    {shorts.map(([currency, f], i) => (
                      <span key={currency}>
                        {i > 0 ? ' + ' : ''}
                        <Amount minor={f.shortMinor} currency={currency} />
                      </span>
                    ))}
                  </>
                ) : null}
                {overs.length > 0 ? (
                  <>
                    {' · الزيادة '}
                    {overs.map(([currency, f], i) => (
                      <span key={currency}>
                        {i > 0 ? ' + ' : ''}
                        <Amount minor={f.overMinor} currency={currency} />
                      </span>
                    ))}
                  </>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** One shift as a card on a phone: cashier and number, sales and difference, times and invoices */
function ShiftCard({
  row,
  base,
  tz,
  digits,
  showsCash,
  long,
}: {
  row: ShiftSummary;
  base: CurrencyCode;
  tz: string;
  digits: Digits;
  showsCash: boolean;
  /** The list spans days: the date shows with the time */
  long: boolean;
}) {
  const when = (iso: string | null) =>
    iso ? (long ? zonedDateTime(iso, tz, digits) : zonedClock(iso, tz, digits)) : null;
  const opened = when(row.openedAt);
  const closed = when(row.closedAt);
  return (
    <li>
      <Link to={`/shifts/${encodeURIComponent(row.id)}`} className="sx-scard">
        <span className="font-semibold">{row.openedBy?.fullName ?? 'غير معروف'}</span>
        <span className="n sx-n">{row.number}</span>
        <span className="sx-n font-bold">
          <Amount minor={row.salesTotalMinor} currency={base} />
        </span>
        <span className="justify-self-end">
          {showsCash && row.status === 'closed' ? (
            <DiffBadges cash={row.cash} />
          ) : (
            <ShiftStatus status={row.status} />
          )}
        </span>
        <span className="x">
          <span className="sx-n">
            {opened ?? '—'}
            {closed ? ` – ${closed}` : ''}
          </span>
          <span>
            <span className="sx-n">{row.salesCount}</span> فاتورة · جهاز{' '}
            <bdi className="sx-n">{row.deviceCode}</bdi>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * «الورديات» (11 › الورديات; admin/ReturnsShifts › الورديات): the shifts of a day or a range in a
 * branch, each with its device, who opened it, when it opened and closed, its sales and its drawer's
 * difference (from the list itself, not one report per shift); each opens its close report.
 * «?open=1» lists the shifts still open, of any day.
 */
export function ShiftsPage() {
  const me = useMe();
  const phone = useIsPhone();
  const digits = useDigits();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const openOnly = params.get('open') === '1';
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [branchId, setBranchId] = useState<string | null>(() => defaultBranch(me));
  const [range, setRange] = useState<DayRange>({ from: today, to: today });
  const single = range.from === range.to;
  const date = range.from;
  const query = openOnly
    ? { branchId, status: 'open' as const }
    : single
      ? { branchId, date }
      : { branchId, from: range.from, to: range.to };
  const key = openOnly
    ? `open|${branchId ?? ''}|all`
    : `${branchId ?? ''}|${single ? date : `${range.from}|${range.to}`}`;
  const { data, error, loading, retry } = useReport(key, () => listShifts(query));
  const base: CurrencyCode = me.settings.baseCurrency;
  const tz = me.tenant.timezone;
  const rows = data?.items ?? [];
  const salesTotal = rows.reduce((sum, row) => sum + row.salesTotalMinor, 0);
  const salesCount = rows.reduce((sum, row) => sum + row.salesCount, 0);
  const showsCash = seesDifference(me);
  const long = openOnly || !single;
  const label = openOnly
    ? 'الورديات المفتوحة'
    : single
      ? `ورديات ${dayText(date, digits)}`
      : `ورديات من ${dayText(range.from, digits)} إلى ${dayText(range.to, digits)}`;
  const now = Date.now();
  const pick = (next: DayRange) => setRange(next);

  const columns: SxColumn<ShiftSummary>[] = [
    {
      key: 'number',
      header: 'الوردية',
      lead: true,
      total: 'المجموع',
      cell: (row) => (
        <>
          <Link
            to={`/shifts/${encodeURIComponent(row.id)}`}
            className="sx-rowbtn inline-flex items-center hover:underline"
          >
            <bdi className="sx-n sx-no" dir="ltr">
              {row.number}
            </bdi>
          </Link>
          <span className="sx-subline">
            جهاز <bdi className="sx-n">{row.deviceCode}</bdi>
          </span>
        </>
      ),
    },
    { key: 'openedBy', header: 'الكاشير', cell: (row) => row.openedBy?.fullName ?? 'غير معروف' },
    {
      key: 'openedAt',
      header: 'الفتح',
      cell: (row) =>
        row.openedAt ? (
          <>
            <span className="sx-n sx-mute">
              {long ? zonedDateTime(row.openedAt, tz, digits) : zonedClock(row.openedAt, tz, digits)}
            </span>
            {openOnly && row.status === 'open' ? (
              <span className="sx-subline text-warning-ink">{ageText(row.openedAt, now)}</span>
            ) : null}
          </>
        ) : (
          <span className="sx-z">—</span>
        ),
    },
    {
      key: 'closedAt',
      header: 'الإغلاق',
      cell: (row) =>
        row.closedAt ? (
          <span className="sx-n sx-mute">
            {long ? zonedDateTime(row.closedAt, tz, digits) : zonedClock(row.closedAt, tz, digits)}
          </span>
        ) : (
          <span className="sx-z">—</span>
        ),
    },
    {
      key: 'count',
      header: 'الفواتير',
      numeric: true,
      cell: (row) => <span className="sx-n">{row.salesCount}</span>,
      total: <span className="sx-n">{salesCount}</span>,
    },
    {
      key: 'total',
      header: 'إجمالي المبيعات',
      numeric: true,
      strong: true,
      cell: (row) => <Amount minor={row.salesTotalMinor} currency={base} />,
      total: <Amount minor={salesTotal} currency={base} />,
    },
    {
      key: 'difference',
      header: showsCash ? 'الفرق' : 'الحالة',
      cell: (row) =>
        showsCash && row.status === 'closed' ? (
          <DiffBadges cash={row.cash} />
        ) : (
          <ShiftStatus status={row.status} />
        ),
    },
  ];

  return (
    <ReportScreen me={me} access={SHIFTS_ACCESS} title="الورديات">
      <SalesPage>
        <PageTop title="الورديات" subtitle="سجل الورديات وتقارير إغلاقها" />
        <div className="sx-toolbar print:hidden">
          {openOnly ? (
            <Button
              variant="secondary"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('open');
                setParams(next);
              }}
            >
              ورديات اليوم
            </Button>
          ) : (
            <>
              {single ? (
                <DayStepper date={date} today={today} onPick={(day) => pick({ from: day, to: day })} />
              ) : (
                <>
                  <DayField
                    label="من"
                    value={range.from}
                    max={range.to}
                    onChange={(day) => setRange({ from: day, to: range.to })}
                  />
                  <DayField
                    label="إلى"
                    value={range.to}
                    max={today}
                    onChange={(day) => setRange({ from: range.from <= day ? range.from : day, to: day })}
                  />
                </>
              )}
              <PeriodChips name="shifts-period" range={range} today={today} scroll onPick={pick} />
            </>
          )}
          <div className="sx-push">
            <BranchSelect me={me} value={branchId} onChange={setBranchId} hideLabel className="min-w-44" />
          </div>
        </div>
        {openOnly ? (
          <p className="sx-quiet">
            <ClockIcon size={16} />
            <span>
              يقفل الكاشير وردية جهازه من الكاشير نفسه، ولا يوجد إغلاق من لوحة الإدارة. ادخل على الوردية لترى
              نقدها ومبيعاتها.
            </span>
          </p>
        ) : (
          <StaleOpenLine branchId={branchId} />
        )}
        {data?.truncated ? (
          <Alert tone="info">القائمة طويلة، وهذه أول 500 وردية فقط. اختر مدة أقصر لترى الباقي.</Alert>
        ) : null}
        {showsCash && !loading && !error ? <CashierShortagePanel rows={rows} base={base} /> : null}
        {phone && rows.length > 0 && !loading && !error ? (
          <ul aria-label={label} className="sx-cards">
            {rows.map((row) => (
              <ShiftCard
                key={row.id}
                row={row}
                base={base}
                tz={tz}
                digits={digits}
                showsCash={showsCash}
                long={long}
              />
            ))}
            <li className="sx-sumcard">
              <span>المجموع</span>
              <span>
                <span className="sx-n">{salesCount}</span> فاتورة ·{' '}
                <Amount minor={salesTotal} currency={base} />
              </span>
            </li>
          </ul>
        ) : (
          <SxTable
            caption={label}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={loading}
            error={error ?? undefined}
            onRetry={retry}
            onRowClick={(row) => void navigate(`/shifts/${encodeURIComponent(row.id)}`)}
            empty={
              <EmptyState
                icon={ClockIcon}
                title={
                  openOnly
                    ? 'لا ورديات مفتوحة.'
                    : single
                      ? 'لا ورديات في هذا اليوم.'
                      : 'لا ورديات في هذه المدة.'
                }
                description="تظهر الوردية هنا حين يفتحها الكاشير على جهازه وتصل."
              />
            }
          />
        )}
      </SalesPage>
    </ReportScreen>
  );
}
