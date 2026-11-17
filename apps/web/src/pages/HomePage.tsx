import { useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import {
  CURRENCIES,
  formatMoney,
  getCurrency,
  sectorLabel,
  type CurrencyCode,
  type MeResponse,
  type OnlineOrder,
  type SalesBreakdown,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  AreaChart,
  Badge,
  Button,
  CalendarIcon,
  Card,
  CardHeader,
  CartIcon,
  CloseIcon,
  CustomersIcon,
  cn,
  compactNumber,
  EmptyState,
  ExpandIcon,
  formatQuantity,
  GiftIcon,
  IconChip,
  InboxIcon,
  Money,
  NextIcon,
  PageHeader,
  PrintIcon,
  ProductsIcon,
  RetryIcon,
  SalesIcon,
  SegmentedControl,
  ShareBar,
  SnapRow,
  Skeleton,
  StatTile,
  StoreIcon,
  Tabs,
  TrendDownIcon,
  TrendUpIcon,
  TruckIcon,
  WarningIcon,
  type StatTileProps,
  type TabItem,
} from '@serva/ui';
import { ButtonLink } from '../admin/products/parts';
import { getProfit, listExpiry, listSuppliers } from '../admin/purchases/api';
import { listCustomers } from '../admin/customers/api';
import { listCheques } from '../admin/cheques/api';
import { getSummary as getInstalmentSummary } from '../admin/installments/api';
import { listProducts } from '../admin/catalog/api';
import { dueSoon } from '../admin/cheques/ChequesPage';
import { holdsAny, DAY_REPORT_ACCESS } from '../admin/reports/access';
import { ContractAttention, seesContractAttention } from './ContractAttention';
import { getDayReport, getDayTotals } from '../admin/reports/api';
import {
  EARLY_HOUR,
  hourIn,
  useOpenShiftFromYesterday,
  type OpenFromYesterday,
} from '../admin/reports/openShift';
import { getSalesBreakdown } from '../admin/reports/SalesReportPage';
import { daysAgo, getMerchandise } from '../admin/reports/MerchandisePage';
import type { DayReport } from '../admin/reports/contracts';
import { methodLabel } from '../admin/reports/labels';
import { useReport, type ReportState } from '../admin/reports/useReport';
import { useMe } from '../auth/useAuth';
import { AppShell } from '../layout/AppShell';
import { apiFetch } from '../lib/api';
import { dayText, isoDay } from '../lib/dates';
import { products } from '../lib/plural';
import { firstName, formatDays, formatNumber, type NumberFormat } from '../lib/format';

function trialMessage(daysLeft: number, numberFormat: MeResponse['settings']['numberFormat']): string {
  if (daysLeft <= 0) return 'تنتهي الباقة المجانية اليوم';
  return `باقي ${formatDays(daysLeft, numberFormat)} من الباقة المجانية`;
}

const TRIAL_DISMISSED_KEY = 'serva.trialBannerDismissed';

/** Whether this device has hidden the trial banner (per device; a banner about the last days always shows) */
function trialDismissed(): boolean {
  try {
    return localStorage.getItem(TRIAL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function TrialBanner({ me }: { me: MeResponse }) {
  const { status, daysLeft } = me.subscription;
  const [hidden, setHidden] = useState(trialDismissed);
  if (status !== 'trialing') return null;
  const endingSoon = daysLeft !== null && daysLeft <= 3;
  // The last days are said once, by the warning bar of every page (SubscriptionBanner)
  if (endingSoon || hidden) return null;

  return (
    <div
      // Said once: from 1024 px the sidebar's plan card carries these days, so this is for phones
      className="flex items-center gap-4 rounded-card border border-brand/20 bg-brand-soft px-4 py-2 text-brand-ink shadow-e1 sm:px-5 sm:py-4 lg:hidden"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface/70">
        <GiftIcon />
      </span>
      <div className="flex min-w-0 flex-col">
        <p className="font-semibold">
          {daysLeft === null ? 'أنت على الباقة المجانية' : trialMessage(daysLeft, me.settings.numberFormat)}
        </p>
        <p className="text-sm opacity-85 max-sm:hidden">كل المزايا متاحة لك خلال التجربة.</p>
      </div>
      <button
        type="button"
        aria-label="أخفِ هذا الشريط"
        className="ms-auto grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface/60 pointer-coarse:size-12"
        onClick={() => {
          try {
            localStorage.setItem(TRIAL_DISMISSED_KEY, '1');
          } catch {
            // The banner just comes back next time
          }
          setHidden(true);
        }}
      >
        <CloseIcon size={20} />
      </button>
    </div>
  );
}

// ─── Days and numbers ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The ISO day `back` days before `day` («2026-10-31», 1 → «2026-10-30»). */
function shiftDay(day: string, back: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - back * DAY_MS).toISOString().slice(0, 10);
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;

function weekdayOf(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? '';
}

/** The day's sales after the returns of the day (the report's total is before them), tax included */
const netOfReturns = (report: DayReport): number => report.totalMinor - (report.returns?.totalMinor ?? 0);

/** One day of sales: null where that day's report did not load. */
interface DayPoint {
  date: string;
  total: number | null;
  count: number | null;
}

/** The days from `from` to `to` in one request; a day without sales is a day of zero. A failure is a gap. */
const loadDays = (from: string, to: string): Promise<DayPoint[]> =>
  getDayTotals({ from, to }).then(
    ({ items }) => {
      const byDate = new Map(items.map((d) => [d.date, d]));
      const points: DayPoint[] = [];
      for (let date = from; date <= to; date = shiftDay(date, -1)) {
        const day = byDate.get(date);
        points.push({
          date,
          total: day ? day.totalMinor - day.returnsMinor : 0,
          count: day?.invoiceCount ?? 0,
        });
      }
      return points;
    },
    () => [],
  );

/** The change of `current` against `previous` as a tile's pill; none when it cannot be told. */
function changeOf(
  current: number,
  previous: number | null | undefined,
  digits: NumberFormat,
  thin = false,
): StatTileProps['trend'] {
  if (previous === null || previous === undefined || previous <= 0) return undefined;
  // A base under a tenth of the figure says «+900%»: a jump from almost nothing, not a trend
  if (previous < current / 10) return undefined;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return undefined;
  const direction = percent > 0 ? 'up' : 'down';
  // A figure more than doubled says so in words, in grey: «+484%» in a loud green pill is a
  // jump from a small base, not good news to celebrate. The same on thin data (a few days of sales).
  if (percent >= 100)
    return { direction, value: 'أكثر من الضعف', comparison: 'عن أمس كاملاً', tone: 'neutral' };
  // Today is still running while yesterday is whole: a lower figure now is not a loss, so a fall is
  // a plain grey note (never a red alarm, never green), and the words say what it is measured against.
  return {
    direction,
    value: `${formatNumber(Math.abs(percent), digits)}%`,
    comparison: 'عن أمس كاملاً',
    ...(thin || direction === 'down' ? { tone: 'neutral' as const } : {}),
  };
}

type DayState = ReportState<DayReport>;

// ─── Header ──────────────────────────────────────────────────────────────────

function QuickActions({ me }: { me: MeResponse }) {
  const canCatalog = holdsAny(me, ['catalog.manage']);
  return (
    <>
      {canCatalog ? (
        <ButtonLink to="/products/new" icon={<AddIcon />} className="max-sm:hidden">
          منتج جديد
        </ButtonLink>
      ) : null}
      {canCatalog ? (
        <ButtonLink to="/labels" icon={<PrintIcon />} className="max-sm:hidden">
          اطبع ملصقات
        </ButtonLink>
      ) : null}
      <ButtonLink to="/pos" reloadDocument variant="primary" icon={<CartIcon />} className="max-sm:w-full">
        افتح الكاشير
      </ButtonLink>
    </>
  );
}

/** A card's title with its picture in a soft square (هوية 3). */
function SectionTitle({
  icon,
  tone = 'brand',
  children,
}: {
  icon: ReactNode;
  tone?: 'brand' | 'warning' | 'danger' | 'neutral';
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
      <IconChip tone={tone}>{icon}</IconChip>
      {children}
    </h2>
  );
}

// ─── The KPI band ────────────────────────────────────────────────────────────

/**
 * The last seven days as small columns on the hero: the oldest at the right, today solid. A day
 * without sales is a thin baseline tick, not a column; when only today has sold there is no week to
 * compare, and it says so instead of drawing one tall column among dashes.
 */
function WeekBars({ values }: { values: readonly number[] }) {
  const top = Math.max(...values, 1);
  const today = values.length - 1;
  const noHistory = values.slice(0, today).every((v) => v <= 0);
  return (
    <div className="flex flex-col gap-2 max-sm:hidden">
      <div aria-hidden="true" className="flex h-16 items-end gap-1.5 border-b border-on-brand/25">
        {values.map((value, index) => (
          <span
            key={index}
            className={cn(
              'w-3 sm:w-4',
              value <= 0
                ? 'h-0.5 rounded-full bg-on-brand/30'
                : cn('rounded-t-small', index === today ? 'bg-on-brand' : 'bg-on-brand/45'),
            )}
            style={
              value <= 0
                ? undefined
                : { height: `${noHistory ? 56 : Math.max(10, Math.round((value / top) * 100))}%` }
            }
          />
        ))}
      </div>
      <span className="text-xs opacity-80">{noHistory ? 'لا بيانات قبل اليوم' : 'آخر 7 أيام'}</span>
    </div>
  );
}

function HeroTile({
  data,
  trend,
  week,
  noHistory = false,
  zeroMorning = false,
  openShift = null,
  digits,
}: {
  /** A shift opened yesterday and still open: its invoices are dated yesterday, said in words */
  openShift?: OpenFromYesterday | null;
  /** No sales in the days before today: say it once here instead of on every tile */
  noHistory?: boolean;
  digits: NumberFormat;
  /** Nothing sold yet today though earlier days did: «لا مبيعات بعد» instead of a fall of 100% */
  zeroMorning?: boolean;
  data: DayReport | null;
  trend: StatTileProps['trend'];
  week: readonly number[] | null;
}) {
  const TrendIcon = trend?.direction === 'down' ? TrendDownIcon : TrendUpIcon;
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-5 overflow-hidden rounded-panel bg-brand bg-[radial-gradient(120%_120%_at_0%_0%,color-mix(in_oklab,var(--color-brand-hover)_80%,transparent),transparent_60%)] p-5 text-on-brand shadow-e2 max-sm:gap-y-2 max-sm:p-4 sm:p-7 dark:[--color-brand-hover:var(--color-mark-to)] dark:[--color-brand:var(--color-mark-from)] dark:[--color-on-brand:var(--color-on-mark)]">
      <div className="flex min-w-0 flex-col gap-3 max-sm:gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold opacity-90">
            <SalesIcon size={20} />
            <span>
              مبيعات اليوم <span className="font-normal opacity-85">(صافي)</span>
            </span>
          </p>
          <Link
            to="/sales/today"
            className="inline-flex min-h-8 items-center gap-1 rounded-control bg-on-brand/15 px-2.5 text-sm font-semibold transition-colors duration-120 hover:bg-on-brand/25 pointer-coarse:min-h-12"
          >
            التفاصيل
            <NextIcon size={16} />
          </Link>
        </div>
        {data ? (
          <>
            <p className="num text-total font-bold tracking-tight [&_[data-money-unit]]:text-base [&_[data-money-unit]]:font-semibold [&_[data-money-unit]]:opacity-80">
              <Money minor={netOfReturns(data)} currency={data.baseCurrency} />
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {zeroMorning ? (
                <span className="opacity-85">لا مبيعات بعد</span>
              ) : trend ? (
                // A fall is amber (never green on the green hero), a rise stays the hero's own white
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                    trend.direction === 'down' ? 'bg-warning-soft text-warning-ink' : 'bg-on-brand/15',
                  )}
                >
                  <TrendIcon size={16} />
                  <span className="sr-only">{trend.direction === 'up' ? 'ارتفاع' : 'انخفاض'}</span>
                  <bdi className="num">{trend.value}</bdi>
                  <span className="font-normal opacity-85">{trend.comparison}</span>
                </span>
              ) : null}
              {data.returns && data.returns.totalMinor > 0 ? (
                <span className="opacity-85">
                  المرتجعات{' '}
                  <Money
                    minor={data.returns.totalMinor}
                    currency={data.baseCurrency}
                    className="font-semibold"
                  />
                </span>
              ) : null}
              {noHistory ? <span className="opacity-85">لا بيانات قبل اليوم</span> : null}
              {openShift ? (
                <span className="opacity-85">
                  وردية مفتوحة منذ أمس: {formatNumber(openShift.count, digits)} فاتورة
                  {openShift.count > 0 ? (
                    <>
                      {' '}
                      <Money
                        minor={openShift.netMinor}
                        currency={data.baseCurrency}
                        className="font-semibold"
                      />
                    </>
                  ) : null}
                </span>
              ) : null}
              <span className="opacity-85">
                الحسم{' '}
                <Money minor={data.discountMinor} currency={data.baseCurrency} className="font-semibold" />
              </span>
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-10 w-56 bg-on-brand/20" />
            <Skeleton className="h-5 w-40 bg-on-brand/20" />
          </>
        )}
      </div>
      {week && week.length > 1 ? <WeekBars values={week} /> : null}
    </div>
  );
}

function TileSkeleton() {
  return (
    <Card className="flex flex-col gap-3 max-sm:gap-1 max-sm:p-2 max-sm:last:odd:col-span-2 sm:min-w-0">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-32 max-sm:h-6" />
      <Skeleton className="h-9 max-sm:hidden" />
    </Card>
  );
}

/** On a phone two tiles across (an odd last one takes the row, no tile cut at the edge); from 640 px they share the row. */
const TILE_CLASS = 'max-sm:last:odd:col-span-2 sm:min-w-0';

function KpiBand({
  me,
  day,
  points,
  profit,
  seesProfit,
  openShift,
}: {
  me: MeResponse;
  day: DayState;
  /** What a shift opened yesterday and still open has sold */
  openShift: OpenFromYesterday | null;
  /** The last seven days, oldest first, today last. */
  points: readonly DayPoint[];
  profit: ReportState<{
    grossProfitMinor: number;
    netSalesMinor: number;
    costOfSalesMinor?: number;
    belowCostCount?: number;
    baseCurrency: CurrencyCode;
  }>;
  seesProfit: boolean;
}) {
  const digits = me.settings.numberFormat;
  const data = day.data;
  if (day.error) {
    return (
      <section aria-label="مبيعات اليوم">
        <Alert tone="error" title="تعذّر تحميل مبيعات اليوم">
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {day.error}
            <Button size="xs" variant="secondary" icon={<RetryIcon size={16} />} onClick={day.retry}>
              حاول مرة ثانية
            </Button>
          </span>
        </Alert>
      </section>
    );
  }

  const yesterday = points.length > 1 ? points[points.length - 2] : undefined;
  const totals = points.map((p) => p.total ?? 0);
  const counts = points.map((p) => p.count ?? 0);
  const averages = points.map((p) => (p.count ? Math.round((p.total ?? 0) / p.count) : 0));
  // The week's lines are drawn only when every earlier day loaded; a gap would lie about the trend.
  const weekReady = points.slice(0, -1).every((p) => p.total !== null);
  // Nothing sold in the days before today: the tiles say so rather than draw a climb from zero
  const noHistory = weekReady && points.slice(0, -1).every((p) => !p.total);
  // Under three days with sales there is no line to draw: no sparklines or week bars until there is
  const thin = !weekReady || points.filter((p) => (p.total ?? 0) > 0).length < 3;
  // A zero morning says «لا مبيعات بعد» once, not a fall of 100% on every tile
  const zeroMorning =
    !!data && data.invoiceCount === 0 && points.slice(0, -1).some((p) => (p.total ?? 0) > 0);
  // Early in the day, or with last night's shift still open, today is a few hours against a whole
  // yesterday: no comparison at all (it would say «-98%» at 1 am)
  const partialDay = openShift !== null || hourIn(me.tenant.timezone) < EARLY_HOUR;
  const average = data && data.invoiceCount > 0 ? Math.round(netOfReturns(data) / data.invoiceCount) : 0;

  return (
    <section aria-label="مبيعات اليوم" className="flex flex-col gap-4">
      <HeroTile
        data={data}
        trend={data && !partialDay ? changeOf(netOfReturns(data), yesterday?.total, digits, thin) : undefined}
        openShift={openShift}
        digits={digits}
        week={weekReady && data && !noHistory && !thin ? totals : null}
        noHistory={noHistory}
        zeroMorning={zeroMorning}
      />
      <SnapRow
        label="مؤشرات اليوم"
        className="relative grid grid-cols-2 gap-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none sm:gap-4"
      >
        {data ? (
          <>
            <StatTile
              className={TILE_CLASS}
              label="الفواتير"
              value={<span className="num">{formatNumber(data.invoiceCount, digits)}</span>}
              sparkline={!thin ? counts : undefined}
            />
            <StatTile
              className={TILE_CLASS}
              label="متوسط الفاتورة"
              value={<Money minor={average} currency={data.baseCurrency} />}
              sparkline={!thin ? averages : undefined}
            />
          </>
        ) : (
          <>
            <TileSkeleton />
            <TileSkeleton />
          </>
        )}
        {seesProfit && !profit.error ? (
          profit.data ? (
            <StatTile
              className={TILE_CLASS}
              label="الربح الإجمالي"
              value={<Money minor={profit.data.grossProfitMinor} currency={profit.data.baseCurrency} />}
              footnote={
                profit.data.netSalesMinor > 0 &&
                profit.data.costOfSalesMinor !== undefined &&
                profit.data.costOfSalesMinor < profit.data.netSalesMinor / 50
                  ? 'التكلفة غير مكتملة بعد، لذلك لا يُعرض الهامش'
                  : profit.data.netSalesMinor > 0
                    ? (() => {
                        // The net sales sit in their own isolate (an Arabic sentence must not flip the brackets)
                        const note = (
                          <>
                            هامش{' '}
                            <bdi dir="ltr" className="num">
                              {formatNumber(
                                Math.round((profit.data.grossProfitMinor / profit.data.netSalesMinor) * 100),
                                digits,
                              )}
                              %
                            </bdi>{' '}
                            من صافي المبيعات بعد المرتجع وبدون الضريبة{' '}
                            <bdi dir="rtl">
                              (<Money minor={profit.data.netSalesMinor} currency={profit.data.baseCurrency} />
                              )
                            </bdi>
                          </>
                        );
                        const below = profit.data.belowCostCount ?? 0;
                        // A negative margin says why and where to look
                        return profit.data.grossProfitMinor < 0 && below > 0 ? (
                          <>
                            {note}
                            <br />
                            <Link
                              to="/reports/below-cost"
                              title="الأصناف التي بيعت بأقل من كلفتها اليوم"
                              className="font-semibold text-danger-ink underline"
                            >
                              {below === 1
                                ? 'صنف واحد'
                                : below === 2
                                  ? 'صنفين'
                                  : `${formatNumber(below, digits)} ${below <= 10 ? 'أصناف' : 'صنفاً'}`}{' '}
                              تحت الكلفة — اعرض
                            </Link>
                          </>
                        ) : (
                          note
                        );
                      })()
                    : undefined
              }
            />
          ) : (
            <TileSkeleton />
          )
        ) : null}
      </SnapRow>
    </section>
  );
}

// ─── Trend ───────────────────────────────────────────────────────────────────

type Range = '7' | '30';

function SalesTrend({
  me,
  points,
  base,
  loading,
  range,
  onRange,
}: {
  me: MeResponse;
  points: readonly DayPoint[];
  base: CurrencyCode;
  loading: boolean;
  range: Range;
  onRange: (range: Range) => void;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const digits = me.settings.numberFormat;
  const factor = 10 ** getCurrency(base).decimals;
  const loaded = points.filter((p) => p.total !== null);
  const allZero = loaded.length > 0 && loaded.every((p) => p.total === 0);
  // A store with no days before today: a single point, not a line falling from today to zero.
  const todayOnly =
    points.length > 1 && points.slice(0, -1).every((p) => p.total === 0) && !!points.at(-1)?.total;
  // A single point is not a trend: with nothing before today the card waits until there is a second day
  if (todayOnly && range === '7') return null;
  // Under three days with sales a line says nothing: the card waits until it has a shape
  if (loaded.length === points.length && points.filter((p) => (p.total ?? 0) > 0).length < 3) return null;
  return (
    <Card className="flex flex-col gap-1">
      <CardHeader
        className="mb-2 flex-wrap"
        icon={<TrendUpIcon size={20} />}
        title="اتجاه المبيعات"
        description={range === '7' ? 'مبيعات آخر 7 أيام' : 'مبيعات آخر 30 يوماً'}
        action={
          <>
            <SegmentedControl
              label="العرض"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'chart', label: 'رسم' },
                { value: 'table', label: 'جدول' },
              ]}
            />
            <SegmentedControl
              label="الفترة"
              value={range}
              onValueChange={onRange}
              options={[
                { value: '7', label: '7 أيام' },
                { value: '30', label: '30 يوماً' },
              ]}
            />
          </>
        }
      />
      <AreaChart
        label={range === '7' ? 'المبيعات آخر 7 أيام' : 'المبيعات آخر 30 يوماً'}
        labels={points.map((p) => `${weekdayOf(p.date)} ${dayText(p.date, digits)}`)}
        axisLabels={points.map((p, i) => {
          const [, month, date] = p.date.split('-').map(Number);
          const text = `${formatNumber(date ?? 0, digits)}/${formatNumber(month ?? 0, digits)}`;
          return i === points.length - 1 ? `اليوم ${text}` : text;
        })}
        series={[
          {
            key: 'sales',
            label: 'المبيعات',
            values: points.map((p, i) =>
              p.total === null || (todayOnly && i < points.length - 1) ? null : p.total / factor,
            ),
          },
        ]}
        formatValue={(value) => formatMoney(Math.round(value * factor), base, { digits })}
        formatTick={(value) => compactNumber(value, digits)}
        view={view}
        labelHeader="اليوم"
        loading={loading}
        empty={
          <p className="py-10 text-center text-sm text-ink-muted">
            {allZero ? 'لا مبيعات في هذه الفترة بعد.' : 'تعذّر تحميل أيام هذه الفترة.'}
          </p>
        }
      />
      {points.at(-1)?.total !== null && points.at(-1)?.total !== undefined && !loading ? (
        <p className="text-sm text-ink-muted">
          آخر نقطة هي اليوم، وما بيع حتى الآن:{' '}
          <Money minor={points.at(-1)!.total!} currency={base} className="font-semibold text-ink" />
        </p>
      ) : null}
    </Card>
  );
}

// ─── Best sellers, payments ──────────────────────────────────────────────────

function BestSellers({ report }: { report: DayState }) {
  const top = report.data?.topProducts.slice(0, 5) ?? [];
  const biggest = Math.max(...top.map((p) => p.totalMinor), 1);
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle icon={<TrendUpIcon size={20} />}>الأكثر مبيعاً اليوم</SectionTitle>
      {report.loading && !report.data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : top.length === 0 ? (
        <p className="text-ink-muted">لا مبيعات بعد اليوم. ستظهر هنا أول فاتورة.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {top.map((product, index) => (
            <li key={product.productId} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <span className="num grid size-6 shrink-0 place-items-center rounded-small bg-surface-muted text-xs font-bold text-ink-muted">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{product.name}</span>
                <span className="num text-sm text-ink-muted">×{formatQuantity(product.qty)}</span>
                <Money
                  minor={product.totalMinor}
                  currency={report.data?.baseCurrency ?? 'SYP'}
                  className="text-sm font-semibold"
                />
              </div>
              <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="block h-full rounded-full bg-chart-1"
                  style={{ width: `${Math.max(3, Math.round((product.totalMinor / biggest) * 100))}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** «الأكثر مبيعاً هذا الأسبوع»: the five products that sold most in the last seven days, net of returns */
function BestSellersWeek({ report }: { report: ReportState<SalesBreakdown> }) {
  const top = (report.data?.rows ?? []).filter((r) => r.totalMinor > 0).slice(0, 5);
  // Nothing to show (still loading, failed, or no sales): the card stays out of the way
  if (top.length === 0) return null;
  const biggest = Math.max(...top.map((p) => p.totalMinor), 1);
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle icon={<TrendUpIcon size={20} />}>الأكثر مبيعاً هذا الأسبوع</SectionTitle>
      <ol aria-label="الأكثر مبيعاً هذا الأسبوع" className="flex flex-col gap-4">
        {top.map((row, index) => (
          <li key={row.key} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <span className="num grid size-6 shrink-0 place-items-center rounded-small bg-surface-muted text-xs font-bold text-ink-muted">
                {index + 1}
              </span>
              <Link
                to={`/products/${row.key}`}
                className="min-w-0 flex-1 truncate font-semibold text-ink hover:text-brand-ink"
              >
                {row.name}
              </Link>
              <span className="num text-sm text-ink-muted">×{formatQuantity(row.qty)}</span>
              <Money
                minor={row.totalMinor}
                currency={report.data!.baseCurrency}
                className="text-sm font-semibold"
              />
            </div>
            <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <span
                className="block h-full rounded-full bg-chart-2"
                style={{ width: `${Math.max(3, Math.round((row.totalMinor / biggest) * 100))}%` }}
              />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function PaymentMix({ me, report }: { me: MeResponse; report: DayState }) {
  const data = report.data;
  const digits = me.settings.numberFormat;
  const base = data?.baseCurrency ?? me.settings.baseCurrency;
  const factor = 10 ** getCurrency(base).decimals;
  const parts = (data?.byMethod ?? [])
    .filter((m) => m.baseAmountMinor > 0)
    .map((m) => ({
      key: `${m.method}:${m.currency}`,
      label: methodLabel(m.method, m.currency, base),
      value: m.baseAmountMinor / factor,
    }))
    .sort((a, b) => b.value - a.value);
  // The methods are what customers paid: the day's returns are not taken off them
  const returnedMinor = data?.returns?.totalMinor ?? 0;
  // Vouchers are not money taken today: they pay for what an earlier voucher was bought with
  const voucherMinor = (data?.byMethod ?? [])
    .filter((m) => m.method === 'voucher')
    .reduce((sum, m) => sum + m.baseAmountMinor, 0);
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle icon={<SalesIcon size={20} />}>طرق الدفع اليوم</SectionTitle>
      {returnedMinor > 0 ? (
        <p className="text-sm text-ink-muted">
          المبالغ قبل المرتجعات؛ المرتجعات اليوم{' '}
          <Money minor={returnedMinor} currency={base} className="font-semibold" />
        </p>
      ) : null}
      <ShareBar
        label="حصة كل طريقة دفع من مبيعات اليوم"
        parts={parts}
        loading={report.loading && !report.data}
        formatValue={(value) => formatMoney(Math.round(value * factor), base, { digits })}
        empty={<p className="text-ink-muted">لا دفعات بعد اليوم.</p>}
      />
      {voucherMinor > 0 ? (
        <p className="text-sm text-ink-muted">
          منها قسائم مستردّة <Money minor={voucherMinor} currency={base} className="font-semibold" />
        </p>
      ) : null}
    </Card>
  );
}

// ─── What waits ──────────────────────────────────────────────────────────────

const getPendingOrders = () =>
  apiFetch<{ items: OnlineOrder[] }>('/v1/online-orders?status=pending', { auth: true });
// The orders already accepted and waiting to be sold on a till: the number the till's «طلبات المتجر» chip shows
const getAcceptedOrders = () =>
  apiFetch<{ items: OnlineOrder[] }>('/v1/online-orders?status=accepted', { auth: true });

type WaitingTone = 'warning' | 'brand' | 'danger';

const WAITING_TONES: Record<WaitingTone, string> = {
  warning: 'bg-warning-soft text-warning-ink',
  brand: 'bg-brand-soft text-brand-ink',
  danger: 'bg-danger-soft text-danger-ink',
};

function WaitingRow({
  to,
  count,
  tone,
  icon,
  children,
}: {
  to: string;
  count: number | string | null;
  tone: WaitingTone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-card px-3 font-semibold transition-opacity duration-120 hover:opacity-90',
          WAITING_TONES[tone],
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface/70">{icon}</span>
        <span className="min-w-0 flex-1">{children}</span>
        {count === null ? null : <span className="num text-lg font-bold">{count}</span>}
        <NextIcon size={16} />
      </Link>
    </li>
  );
}

/** The size a low piece is in («M» of «M · أبيض»), when it has one */
const sizeOf = (item: { attributes?: { name: string; value: string }[] }) =>
  item.attributes?.find((a) => a.name === 'المقاس')?.value ?? null;

interface LowItem {
  attributes?: { name: string; value: string }[];
  variantId: string;
  productId: string;
  name: string;
  stockQty: number;
  /** How many pieces the product has and how many still have stock (from the report; absent: only the low ones are known) */
  productPieces?: number | undefined;
  productInStock?: number | undefined;
}

/** A product with pieces that ran low: all its pieces in one group, one row on the home page */
interface LowGroup<T extends LowItem> {
  productId: string;
  items: T[];
  /** Every piece is gone: the only case shown in red */
  allOut: boolean;
}

/** A product is wholly out only when none of ALL its pieces has stock (not just the low ones listed) */
function wholeProductOut(list: readonly LowItem[]): boolean {
  const [first] = list;
  if (first?.productInStock !== undefined) return first.productInStock === 0;
  if (first?.productPieces !== undefined) return list.length >= first.productPieces;
  return true;
}

/**
 * The pieces that ran low, one group per product, for every kind of store («جاكيت شتوي: 3 مقاسات
 * نفدت», «حليب يوشك على النفاد»). A piece below zero is named once, in «المخزون», with its link to
 * the count, so it is not here.
 */
function lowGroups<T extends LowItem>(items: readonly T[]): LowGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (item.stockQty < 0) continue;
    const list = groups.get(item.productId);
    if (list) list.push(item);
    else groups.set(item.productId, [item]);
  }
  return [...groups.entries()].map(([productId, list]) => ({
    productId,
    items: list,
    allOut: list.every((item) => item.stockQty <= 0) && wholeProductOut(list),
  }));
}

/** The low pieces «تحتاج انتباهك» names per product: «المخزون» does not list them again */
const groupedLow = (items: readonly LowItem[]): Set<string> =>
  new Set(lowGroups(items).flatMap((group) => group.items.map((item) => item.variantId)));

/** «جاكيت شتوي: 3 مقاسات نفدت» for a product with several low pieces («أصناف» when they are no sizes) */
function groupText(name: string, items: readonly LowItem[]): string {
  const out = items.filter((item) => item.stockQty <= 0).length;
  const lowOnes = items.length - out;
  const sized = items.every((item) => sizeOf(item) !== null);
  // The noun and its verb agree with the number: one and two (dual), three to ten (plural, the verb
  // in the feminine plural), eleven or more (singular noun, masculine verb)
  const phrase = (
    n: number,
    noun: { one: string; two: string; few: string; many: string },
    verb: string[],
  ) => {
    const [one, two, few, many] = verb as [string, string, string, string];
    if (n === 1) return `${noun.one} ${one}`;
    if (n === 2) return `${noun.two} ${two}`;
    if (n >= 3 && n <= 10) return `${n} ${noun.few} ${few}`;
    return `${n} ${noun.many} ${many}`;
  };
  const noun = sized
    ? { one: 'مقاس واحد', two: 'مقاسان', few: 'مقاسات', many: 'مقاساً' }
    : { one: 'صنف واحد', two: 'صنفان', few: 'أصناف', many: 'صنفاً' };
  const parts: string[] = [];
  if (out > 0) parts.push(phrase(out, noun, ['نفد', 'نفدا', 'نفدت', 'نفد']));
  if (lowOnes > 0)
    parts.push(
      phrase(lowOnes, noun, ['يوشك على النفاد', 'يوشكان على النفاد', 'توشك على النفاد', 'يوشك على النفاد']),
    );
  return `${name}: ${parts.join(' و')}`;
}

type OrdersState = ReportState<{ items: OnlineOrder[] }>;
type MerchState = ReportState<Awaited<ReturnType<typeof getMerchandise>>>;
type ExpiryState = ReportState<Awaited<ReturnType<typeof listExpiry>>>;
type ChequesState = ReportState<Awaited<ReturnType<typeof listCheques>>>;

interface WaitingArgs {
  orders: OrdersState;
  /** Accepted orders not sold yet (what the till counts under «طلبات المتجر») */
  toSell?: OrdersState | null;
  merch: MerchState;
  expiry: ExpiryState;
  seesOrders: boolean;
  seesStock: boolean;
  seesExpiry: boolean;
  cheques?: ChequesState | null;
  today?: string;
  noPhoto?: number;
}

/** What «ما ينتظرك» counts, shared by its list and by the tab that carries its total */
function waitingFigures({
  orders,
  toSell,
  merch,
  expiry,
  seesOrders,
  seesStock,
  seesExpiry,
  noPhoto = 0,
}: WaitingArgs) {
  const count = orders.data?.items.length ?? 0;
  const holds = orders.data?.items.filter((order) => order.source === 'hold').length ?? 0;
  const online = count - holds;
  const accepted = toSell?.data?.items.length ?? 0;
  // Every low product is one group, whatever the store sells; a piece below zero is named once, in
  // «المخزون», where its chip opens the count
  const stock = lowGroups(merch.data?.lowStock ?? []);
  // A batch past its date is gone for sale (red); one that nears it is only a warning (amber)
  const expired =
    expiry.data?.items.filter((row) => !row.blocked && row.daysLeft !== null && row.daysLeft < 0).length ?? 0;
  const expiring = (expiry.data?.items.filter((row) => !row.blocked).length ?? 0) - expired;
  // A recalled batch no till sells (استدعاء دفعة): it waits for the owner's decision
  const recalled = expiry.data?.items.filter((row) => row.blocked).length ?? 0;
  const loading =
    (seesOrders && orders.loading) || (seesStock && merch.loading) || (seesExpiry && expiry.loading);
  // The tab counts rows, as the list shows them; «بلا صورة» is a suggestion, shown but not counted
  const total =
    (online > 0 ? 1 : 0) +
    (accepted > 0 ? 1 : 0) +
    (holds > 0 ? 1 : 0) +
    stock.length +
    (expiring > 0 ? 1 : 0) +
    (expired > 0 ? 1 : 0) +
    (recalled > 0 ? 1 : 0);
  return {
    holds,
    online,
    accepted,
    stock,
    expiring,
    expired,
    recalled,
    loading,
    noPhoto,
    total,
    // What the list shows, the grey «بلا صورة» row too: the tab's badge and «عرض الكل» say one number
    listed: total + (noPhoto > 0 ? 1 : 0),
    empty: total === 0 && noPhoto === 0,
  };
}

/** «SYR-C · حقنة 5 مل: دفعة موقوفة…»: the row says which batch it is (the first two, then «…») */
function batchNamed(rows: { name: string; batchNo: string | null }[], text: string): string {
  const names = rows.slice(0, 2).map((row) => (row.batchNo ? `${row.batchNo} · ${row.name}` : row.name));
  if (names.length === 0) return text;
  return `${names.join('، ')}${rows.length > 2 ? '…' : ''}: ${text}`;
}

/** How many rows «تحتاج انتباهك» shows before «عرض الكل» */
const WAITING_ROWS = 3;

function Waiting({ bare = false, ...args }: WaitingArgs & { bare?: boolean }) {
  const [all, setAll] = useState(false);
  const { holds, online, accepted, stock, expiring, expired, recalled, loading, noPhoto, empty } =
    waitingFigures(args);
  const batches = args.expiry.data?.items ?? [];
  const recalledRows = batches.filter((row) => row.blocked);
  const expiredRows = batches.filter((row) => !row.blocked && row.daysLeft !== null && row.daysLeft < 0);
  const expiringRows = batches.filter((row) => !row.blocked && !(row.daysLeft !== null && row.daysLeft < 0));
  // Red only for what blocks (a recalled batch) or is wholly gone; everything else is amber or calm.
  // Most serious first, so the three rows shown are the three that matter.
  const rows: ReactNode[] = [];
  if (recalled > 0)
    rows.push(
      <WaitingRow key="recalled" to="/recall" count={null} tone="danger" icon={<WarningIcon />}>
        {batchNamed(
          recalledRows,
          recalled === 1 ? 'دفعة موقوفة عن البيع (استدعاء)' : `${recalled} دفعات موقوفة عن البيع (استدعاء)`,
        )}
      </WaitingRow>,
    );
  if (expired > 0)
    rows.push(
      <WaitingRow key="expired" to="/expiry" count={null} tone="danger" icon={<WarningIcon />}>
        {batchNamed(expiredRows, expired === 1 ? 'دفعة منتهية الصلاحية' : `${expired} دفعات منتهية الصلاحية`)}
      </WaitingRow>,
    );
  const rowOf = (group: (typeof stock)[number]) => {
    const [item] = group.items;
    if (!item) return null;
    const single = group.items.length === 1;
    const colour = item.attributes?.find((a) => a.name === 'اللون')?.value;
    const size = sizeOf(item);
    const state = item.stockQty <= 0 ? 'نفد' : `يوشك على النفاد (باقي ${formatQuantity(item.stockQty)})`;
    return (
      <WaitingRow
        key={group.productId}
        to={`/products/${group.productId}`}
        // «نفد» is in the sentence: no second «نفد» beside it
        // The sentence names the pieces and their state: no bare number beside it
        count={null}
        tone="warning"
        icon={<WarningIcon />}
      >
        {single ? (
          size ? (
            <>
              {item.name}: المقاس <bdi dir="ltr">{size}</bdi>
              {colour ? ` (${colour})` : ''} {state}
            </>
          ) : (
            <>
              {item.name}: {state}
            </>
          )
        ) : (
          groupText(item.name, group.items)
        )}
      </WaitingRow>
    );
  };
  for (const group of stock.filter((g) => g.allOut)) rows.push(rowOf(group));
  if (online > 0)
    rows.push(
      <WaitingRow key="online" to="/online-store" count={online} tone="brand" icon={<StoreIcon />}>
        {online === 1 ? 'طلب جديد من المتجر الإلكتروني' : 'طلبات جديدة من المتجر الإلكتروني'}
      </WaitingRow>,
    );
  if (accepted > 0)
    rows.push(
      <WaitingRow key="accepted" to="/online-store" count={accepted} tone="brand" icon={<StoreIcon />}>
        {accepted === 1 ? 'طلب مقبول ينتظر البيع على الكاشير' : 'طلبات مقبولة تنتظر البيع على الكاشير'}
      </WaitingRow>,
    );
  if (holds > 0)
    rows.push(
      <WaitingRow key="holds" to="/online-store" count={holds} tone="brand" icon={<GiftIcon />}>
        {holds === 1 ? 'قطعة محجوزة بعربون' : 'قطع محجوزة بعربون'}
      </WaitingRow>,
    );
  for (const group of stock.filter((g) => !g.allOut)) rows.push(rowOf(group));
  if (expiring > 0)
    rows.push(
      <WaitingRow key="expiring" to="/expiry" count={expiring} tone="warning" icon={<CalendarIcon />}>
        {batchNamed(expiringRows, expiring === 1 ? 'دفعة يقترب انتهاؤها' : 'دفعات يقترب انتهاؤها')}
      </WaitingRow>,
    );
  if (noPhoto > 0)
    // A suggestion, not an alarm: grey, last, no count chip
    rows.push(
      <li key="photos">
        <Link
          to="/products"
          className="flex min-h-11 items-center gap-3 rounded-card px-3 text-sm text-ink-muted transition-colors duration-120 hover:bg-surface-muted"
        >
          <ProductsIcon size={20} />
          <span className="min-w-0 flex-1">
            {noPhoto === 1 ? 'منتج واحد بلا صورة' : `${noPhoto} ${products(noPhoto)} بلا صورة`}. أضف صوراً
            ليسهل البيع.
          </span>
          <NextIcon size={16} />
        </Link>
      </li>,
    );
  const shown = all ? rows : rows.slice(0, WAITING_ROWS);
  const body =
    loading && empty ? (
      <Skeleton className="h-14" />
    ) : empty ? (
      <p className="text-ink-muted">لا شيء ينتظرك الآن.</p>
    ) : (
      <>
        <ul className="flex flex-col gap-2">{shown}</ul>
        {rows.length > WAITING_ROWS ? (
          <button
            type="button"
            aria-expanded={all}
            className="min-h-11 self-start rounded-control px-2 text-sm font-semibold text-brand-ink hover:underline"
            onClick={() => setAll((now) => !now)}
          >
            {all ? 'عرض أقل' : `عرض الكل (${rows.length})`}
          </button>
        ) : null}
      </>
    );
  if (bare) return body;
  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle icon={<InboxIcon size={20} />} tone="warning">
        ما ينتظرك
      </SectionTitle>
      {body}
    </Card>
  );
}

/** A low piece's chip: «نفد» for none, «سالب 3» for a stock that went below zero, else the count */
function stockChip(qty: number): string {
  if (qty < 0) return `سالب ${formatQuantity(-qty)}`;
  if (qty === 0) return 'نفد';
  return formatQuantity(qty);
}

/** The low pieces «يوشك على النفاد» lists: not the ones «ما ينتظرك» already names one by one */
const lowRows = (report: MerchState, skip?: ReadonlySet<string> | undefined) =>
  (report.data?.lowStock ?? []).filter((item) => !skip?.has(item.variantId)).slice(0, 5);

function RunningLow({
  report,
  skip,
  bare = false,
}: {
  report: MerchState;
  skip?: ReadonlySet<string> | undefined;
  bare?: boolean;
}) {
  const low = lowRows(report, skip);
  // Every piece below zero, shown or not: one link opens the count with all of them
  const negativeIds = (report.data?.lowStock ?? [])
    .filter((item) => item.stockQty < 0)
    .map((i) => i.variantId);
  // Every low piece is already named in «ما ينتظرك»: the list would only repeat it
  if (low.length === 0 && (report.data?.lowStock.length ?? 0) > 0) return null;
  const allLink = (
    <Link to="/reports/merchandise" className="text-sm font-semibold text-brand-ink hover:underline">
      كل القائمة
    </Link>
  );
  const Wrap = bare ? 'div' : Card;
  return (
    <Wrap className="flex flex-col gap-3">
      {bare ? (
        <div className="flex justify-end">{allLink}</div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <SectionTitle icon={<WarningIcon size={20} />} tone="warning">
            يوشك على النفاد
          </SectionTitle>
          {allLink}
        </div>
      )}
      {report.loading && !report.data ? (
        <Skeleton className="h-20" />
      ) : report.error ? (
        <p className="text-sm text-ink-muted">تعذّر تحميل المخزون.</p>
      ) : low.length === 0 ? (
        <p className="text-ink-muted">كل الأصناف التي تبيعها عندك منها كمية كافية.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line">
            {low.map((item) => (
              <li key={item.variantId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="grid size-9 shrink-0 place-items-center rounded-small bg-surface-muted text-ink-muted">
                  <ProductsIcon size={20} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {item.name}
                  {item.label ? <span className="text-ink-muted"> · {item.label}</span> : null}
                </span>
                <span
                  className={cn(
                    'num inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full px-2 text-sm font-bold',
                    item.stockQty <= 1000
                      ? 'bg-warning-soft text-warning-ink'
                      : 'bg-surface-muted text-ink-muted',
                  )}
                >
                  {item.stockQty <= 1000 ? <WarningIcon size={16} /> : null}
                  {item.stockQty < 0 ? (
                    <Link
                      to={`/inventory?count=${item.variantId}`}
                      aria-label={`اجرد ${item.name}`}
                      className="hover:underline"
                    >
                      {stockChip(item.stockQty)}
                    </Link>
                  ) : (
                    stockChip(item.stockQty)
                  )}
                </span>
              </li>
            ))}
          </ul>
          {low.some((item) => item.stockQty < 0) ? (
            <p className="text-sm text-ink-muted">
              «سالب» يعني أنك بعت أكثر من المسجّل. استلم البضاعة أو{' '}
              <Link
                to={`/inventory?count=${negativeIds.join(',')}`}
                className="font-semibold text-brand-ink hover:underline"
              >
                اجرد المخزون
              </Link>{' '}
              ليصحّ الرقم.
            </p>
          ) : null}
        </>
      )}
    </Wrap>
  );
}

/**
 * «تحتاج انتباهك»: what waits and what runs low in one card with two tabs, so the home page has one
 * place for «what do I do now», not two look-alike cards. It opens on «المطلوب الآن», or on the
 * stock when nothing else waits.
 */
// ─── Money that waits ─────────────────────────────────────────────────────────

type CustomerDebts = ReportState<Awaited<ReturnType<typeof listCustomers>>>;
type SupplierDues = ReportState<Awaited<ReturnType<typeof listSuppliers>>>;

interface MoneyArgs {
  /** The cheques, to say which fall due within a week (in and out) */
  cheques?: ChequesState | null;
  /** الأقساط: what falls due today and what is late (absent when the person does not see them) */
  instalments?: ReportState<Awaited<ReturnType<typeof getInstalmentSummary>>> | null;
  today?: string;
  customers: CustomerDebts;
  suppliers: SupplierDues;
  seesCustomers: boolean;
  seesSuppliers: boolean;
}

/** What the store is owed and owes, from the customers' and suppliers' own lists: the rows and how many */
function moneyFigures({
  customers,
  suppliers,
  seesCustomers,
  seesSuppliers,
  cheques,
  instalments,
  today,
}: MoneyArgs) {
  const dueToday = instalments?.data?.dueTodayCount ?? 0;
  const lateInstalments = instalments?.data?.lateCount ?? 0;
  const chequesDue = seesCustomers && cheques?.data && today ? dueSoon(cheques.data.items, today).length : 0;
  const chequesOut =
    seesCustomers && cheques?.data && today ? dueSoon(cheques.data.items, today, 'out').length : 0;
  const list = seesCustomers ? (customers.data?.items ?? []) : [];
  const over = list.filter(
    (c) => !c.archived && c.creditLimitMinor !== null && c.balanceMinor > c.creditLimitMinor,
  );
  const overLimit = over.length;
  const overOne = over.length === 1 ? (over[0] ?? null) : null;
  const owedByCustomers = seesCustomers ? (customers.data?.totalOwedMinor ?? 0) : 0;
  const owedToSuppliers = seesSuppliers ? (suppliers.data?.totalOwedMinor ?? 0) : 0;
  const total =
    (overLimit > 0 ? 1 : 0) +
    (owedByCustomers > 0 ? 1 : 0) +
    (owedToSuppliers > 0 ? 1 : 0) +
    (chequesDue > 0 ? 1 : 0) +
    (chequesOut > 0 ? 1 : 0) +
    (dueToday > 0 ? 1 : 0) +
    (lateInstalments > 0 ? 1 : 0);
  return {
    dueToday,
    dueTodayMinor: instalments?.data?.dueTodayMinor ?? 0,
    lateInstalments,
    lateInstalmentsMinor: instalments?.data?.lateMinor ?? 0,
    chequesDue,
    chequesOut,
    overLimit,
    overOne,
    owedByCustomers,
    owedToSuppliers,
    total,
    loading:
      (seesCustomers && customers.loading && !customers.data) ||
      (seesSuppliers && suppliers.loading && !suppliers.data),
    customersBase: customers.data?.baseCurrency,
    suppliersBase: suppliers.data?.baseCurrency,
  };
}

function MoneyRows(args: MoneyArgs) {
  const f = moneyFigures(args);
  if (f.loading && f.total === 0) return <Skeleton className="h-14" />;
  if (f.total === 0) return <p className="text-ink-muted">لا ديون ولا مستحقات الآن.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {f.overLimit > 0 ? (
        <WaitingRow to="/customers" count={f.overLimit} tone="danger" icon={<WarningIcon />}>
          {f.overOne && f.overOne.creditLimitMinor !== null && f.customersBase ? (
            <>
              {f.overOne.name}: فوق الحدّ{' '}
              <Money minor={f.overOne.balanceMinor} currency={f.customersBase} className="font-bold" />
              {/* The limit on its own line when the row is narrow, its words and amount kept together */}
              <span className="block text-sm font-normal">
                الحدّ <Money minor={f.overOne.creditLimitMinor} currency={f.customersBase} />
              </span>
            </>
          ) : f.overLimit === 1 ? (
            'زبون تجاوز حدّ الدين'
          ) : (
            'زبائن تجاوزوا حدّ الدين'
          )}
        </WaitingRow>
      ) : null}
      {f.lateInstalments > 0 ? (
        <WaitingRow to="/installments/due" count={f.lateInstalments} tone="danger" icon={<CalendarIcon />}>
          {f.lateInstalments === 1 ? 'قسط متأخر' : 'أقساط متأخرة'}{' '}
          <Money minor={f.lateInstalmentsMinor} currency={f.customersBase ?? 'SYP'} className="font-bold" />
        </WaitingRow>
      ) : null}
      {f.dueToday > 0 ? (
        <WaitingRow to="/installments/due" count={f.dueToday} tone="warning" icon={<CalendarIcon />}>
          {f.dueToday === 1 ? 'قسط مستحق اليوم' : 'أقساط مستحقة اليوم'}{' '}
          <Money minor={f.dueTodayMinor} currency={f.customersBase ?? 'SYP'} className="font-bold" />
        </WaitingRow>
      ) : null}
      {f.chequesDue > 0 ? (
        <WaitingRow to="/cheques" count={f.chequesDue} tone="warning" icon={<CalendarIcon />}>
          {f.chequesDue === 1 ? 'شيك يستحق خلال 7 أيام' : 'شيكات تستحق خلال 7 أيام'}
        </WaitingRow>
      ) : null}
      {f.chequesOut > 0 ? (
        <WaitingRow to="/cheques" count={f.chequesOut} tone="warning" icon={<CalendarIcon />}>
          {f.chequesOut === 1
            ? 'شيك صادر للمورد يستحق خلال 7 أيام'
            : 'شيكات صادرة للموردين تستحق خلال 7 أيام'}
        </WaitingRow>
      ) : null}
      {f.owedByCustomers > 0 && f.customersBase ? (
        <WaitingRow to="/customers" count={null} tone="warning" icon={<CustomersIcon />}>
          ديون الزبائن عندنا{' '}
          <Money minor={f.owedByCustomers} currency={f.customersBase} className="font-bold" />
        </WaitingRow>
      ) : null}
      {f.owedToSuppliers > 0 && f.suppliersBase ? (
        <WaitingRow to="/suppliers" count={null} tone="warning" icon={<TruckIcon />}>
          مستحقات الموردين علينا{' '}
          <Money minor={f.owedToSuppliers} currency={f.suppliersBase} className="font-bold" />
        </WaitingRow>
      ) : null}
    </ul>
  );
}

function AttentionPanel({
  waiting,
  merch,
  skip,
  showStock,
  money,
}: {
  waiting: WaitingArgs;
  merch: MerchState;
  skip?: ReadonlySet<string> | undefined;
  showStock: boolean;
  money: MoneyArgs;
}) {
  const [picked, setPicked] = useState<'now' | 'stock' | 'money' | null>(null);
  const moneyFigs = moneyFigures(money);
  const moneyTab = (money.seesCustomers || money.seesSuppliers) && (moneyFigs.total > 0 || moneyFigs.loading);
  const figures = waitingFigures(waiting);
  const stockRows = showStock ? lowRows(merch, skip).length : 0;
  const stockTab = showStock && (stockRows > 0 || merch.loading || merch.error !== null);
  const tab =
    picked ??
    (figures.empty && stockRows > 0 ? 'stock' : figures.empty && moneyFigs.total > 0 ? 'money' : 'now');
  const active = tab === 'stock' && stockTab ? 'stock' : tab === 'money' && moneyTab ? 'money' : 'now';
  const items: TabItem<'now' | 'stock' | 'money'>[] = [
    {
      value: 'now',
      label: 'الآن',
      ...(figures.listed > 0 ? { count: figures.listed } : {}),
      content: <Waiting bare {...waiting} />,
    },
    ...(stockTab
      ? [
          {
            value: 'stock' as const,
            label: 'المخزون',
            ...(stockRows > 0 ? { count: stockRows } : {}),
            content: <RunningLow bare report={merch} skip={skip} />,
          },
        ]
      : []),
    ...(moneyTab
      ? [
          {
            value: 'money' as const,
            label: 'المال',
            ...(moneyFigs.total > 0 ? { count: moneyFigs.total } : {}),
            content: <MoneyRows {...money} />,
          },
        ]
      : []),
  ];
  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle icon={<InboxIcon size={20} />} tone="warning">
        تحتاج انتباهك
      </SectionTitle>
      {items.length > 1 ? (
        <Tabs label="تحتاج انتباهك" variant="pill" items={items} value={active} onValueChange={setPicked} />
      ) : (
        items[0]?.content
      )}
    </Card>
  );
}

// ─── The store ───────────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function StoreCard({ me }: { me: MeResponse }) {
  const base = CURRENCIES[me.settings.baseCurrency];
  return (
    <Card className="flex flex-col gap-5">
      <SectionTitle icon={<StoreIcon size={20} />} tone="neutral">
        متجرك
      </SectionTitle>
      <dl className="flex flex-col gap-5">
        <InfoRow label="نشاط المتجر">
          <ul className="flex flex-wrap gap-2" aria-label="نشاط المتجر">
            {me.tenant.sectors.map((sector) => (
              <li key={sector}>
                <Badge tone="brand" className="px-3 py-1 text-sm">
                  {sectorLabel(sector)}
                </Badge>
              </li>
            ))}
          </ul>
        </InfoRow>
        <InfoRow label="العملة الأساسية">
          <span className="font-semibold">{base.nameAr}</span>{' '}
          <span className="text-ink-muted">({base.symbolAr})</span>
        </InfoRow>
        <InfoRow label="العملات المفعّلة">
          {me.settings.enabledCurrencies.map((code) => CURRENCIES[code].nameAr).join('، ')}
        </InfoRow>
        {me.branches.length > 0 ? (
          <InfoRow label={me.branches.length > 1 ? 'الفروع' : 'الفرع'}>
            {me.branches.map((branch) => branch.name).join('، ')}
          </InfoRow>
        ) : null}
      </dl>
    </Card>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

// The owner's home (هوية 4): today's sales against yesterday's with the week behind them, the
// trend, the best sellers and the payment mix, then what waits, each block only for whoever may
// open what it links to.
export function HomePage() {
  const me = useMe();
  const [range, setRange] = useState<Range>('7');
  const [kpiOpen, setKpiOpen] = useState(false);
  const seesSales = holdsAny(me, DAY_REPORT_ACCESS);
  const seesOrders = holdsAny(me, ['customers.view']);
  const seesStock = holdsAny(me, ['report.view']);
  const seesProfit = holdsAny(me, ['reports.financial']);
  const seesExpiry = holdsAny(me, ['purchases.manage']);
  const seesCheques = holdsAny(me, ['customers.view']);
  const today = isoDay(Date.now(), me.tenant.timezone);
  // After midnight a shift that opened yesterday may still be open: its sales are said in words
  const openShift = useOpenShiftFromYesterday(seesSales, today, me.tenant.timezone, 'home');

  const day = useReport(
    seesSales ? `day:${today}` : null,
    () => getDayReport({ branchId: null, date: today }),
    { cache: 'home' },
  );
  // The six days before today feed the sparklines and the 7-day chart; the 30-day view adds the
  // 23 before them, only once asked for. A day that fails to load is a gap, never an error.
  const week = useReport(
    seesSales ? `week:${today}` : null,
    () => loadDays(shiftDay(today, 6), shiftDay(today, 1)),
    { cache: 'home' },
  );
  const month = useReport(seesSales && range === '30' ? `month:${today}` : null, () =>
    loadDays(shiftDay(today, 29), shiftDay(today, 7)),
  );
  const profit = useReport(
    seesSales && seesProfit ? `profit:${today}` : null,
    () => getProfit(today, today),
    {
      cache: 'home',
    },
  );
  const orders = useReport(seesOrders ? 'orders:pending' : null, getPendingOrders, { cache: 'home' });
  const toSell = useReport(seesOrders ? 'orders:accepted' : null, getAcceptedOrders, { cache: 'home' });
  const merch = useReport(seesStock ? 'home:low' : null, () => getMerchandise(daysAgo(30), daysAgo(0), 60), {
    cache: 'home',
  });
  // «الأكثر مبيعاً» of the last seven days, from the sales report (it needs report.view)
  const weekTop = useReport(
    seesStock ? `home:top:${today}` : null,
    () => getSalesBreakdown({ from: shiftDay(today, 6), to: today, by: 'product' }),
    { cache: 'home' },
  );
  const expiry = useReport(seesExpiry ? 'home:expiry' : null, () => listExpiry(30), { cache: 'home' });
  const canCatalogView = holdsAny(me, ['catalog.manage']);
  const catalog = useReport(canCatalogView ? 'home:photos' : null, () => listProducts({ limit: 100 }), {
    cache: 'home',
  });
  const noPhoto = (catalog.data?.items ?? []).filter((p) => p.hasImage === false).length;
  const cheques = useReport(seesCheques ? 'home:cheques' : null, () => listCheques(undefined), {
    cache: 'home',
  });
  // Money that waits: what customers owe (and who is over their limit) and what suppliers are owed
  const customers = useReport(seesCheques ? 'home:debts' : null, () => listCustomers('', true), {
    cache: 'home',
  });
  const suppliers = useReport(seesExpiry ? 'home:dues' : null, () => listSuppliers(), { cache: 'home' });
  const instalments = useReport(
    holdsAny(me, ['installments.view']) ? 'home:instalments' : null,
    () => getInstalmentSummary(),
    { cache: 'home' },
  );

  // A new store starts in the wizard (04 › معالج البداية); the owner can leave it and come back.
  if (!me.onboarding.done && me.user.permissions.includes('settings.manage')) {
    return <Navigate to="/welcome" replace />;
  }

  const known = new Map<string, DayPoint>();
  for (const point of [...(month.data ?? []), ...(week.data ?? [])]) known.set(point.date, point);
  if (day.data)
    known.set(today, { date: today, total: netOfReturns(day.data), count: day.data.invoiceCount });
  const pointsOf = (days: number): DayPoint[] =>
    Array.from({ length: days }, (_, i) => {
      const date = shiftDay(today, days - 1 - i);
      return known.get(date) ?? { date, total: null, count: null };
    });
  const weekPoints = pointsOf(7);
  const chartPoints = range === '30' ? pointsOf(30) : weekPoints;
  const chartLoading =
    (day.loading && !day.data) || (week.loading && !week.data) || (range === '30' && month.loading);
  const base = day.data?.baseCurrency ?? me.settings.baseCurrency;

  // Nothing sold yet, today or in the week behind: a brand-new store gets a way in, not empty charts.
  const brandNew =
    day.data !== null &&
    week.data !== null &&
    day.data.invoiceCount === 0 &&
    weekPoints.every((p) => !p.total);

  const canCatalog = holdsAny(me, ['catalog.manage']);
  const showWaiting = seesOrders || seesStock || seesExpiry || seesCheques || canCatalogView;
  const money: MoneyArgs = {
    customers,
    suppliers,
    seesCustomers: seesCheques,
    seesSuppliers: seesExpiry,
    cheques,
    instalments,
    today,
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6 motion-safe:animate-rise">
        {/* The last numbers are on screen while the new ones load: a thin bar says so */}
        {day.loading && day.data ? (
          <div
            role="progressbar"
            aria-label="يتحدّث"
            className="h-0.5 w-full animate-pulse overflow-hidden rounded-full bg-brand/40"
          />
        ) : null}
        {day.late && !day.slow && !day.data ? (
          <p role="status" className="text-sm text-ink-muted">
            جارٍ التحميل…
          </p>
        ) : null}
        {day.slow ? (
          <Alert tone="warning">
            الأرقام تأخّرت أكثر من المعتاد.{' '}
            <button type="button" className="font-semibold underline" onClick={day.retry}>
              أعد المحاولة
            </button>
          </Alert>
        ) : null}
        <TrialBanner me={me} />
        <PageHeader
          title={`أهلاً، ${firstName(me.user.fullName)}`}
          description={`${weekdayOf(today)} ${dayText(today, me.settings.numberFormat)} · هذه صورة متجرك اليوم.`}
          actions={<QuickActions me={me} />}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6 max-xl:contents xl:col-start-1 xl:row-start-1">
            {seesSales ? (
              // Below 1280 px the figures come first, then what needs attention, then the rest
              <div className="flex min-w-0 flex-col gap-3 max-xl:order-[-2]">
                {/* On a phone the figures fold behind one line, so «تحتاج انتباهك» comes first */}
                <button
                  type="button"
                  aria-expanded={kpiOpen}
                  onClick={() => setKpiOpen((v) => !v)}
                  className="flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-3 text-start text-sm text-ink-muted shadow-e1 md:hidden"
                >
                  <span className="min-w-0 flex-1 truncate">
                    مبيعات اليوم
                    {day.data ? (
                      <>
                        {' '}
                        <Money
                          minor={netOfReturns(day.data)}
                          currency={day.data.baseCurrency}
                          className="font-semibold text-ink"
                        />
                      </>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-brand-ink">
                    {kpiOpen ? 'أخفِ الأرقام' : 'الأرقام'}
                  </span>
                  <ExpandIcon
                    size={16}
                    className={cn('shrink-0 transition-transform', kpiOpen && 'rotate-180')}
                  />
                </button>
                <div className={cn('min-w-0', !kpiOpen && 'max-md:hidden')}>
                  <KpiBand
                    me={me}
                    day={day}
                    points={weekPoints}
                    profit={profit}
                    seesProfit={seesProfit}
                    openShift={openShift.note}
                  />
                </div>
              </div>
            ) : null}
            {seesSales && brandNew ? (
              <EmptyState
                icon={CartIcon}
                title="لا مبيعات بعد"
                description="أول فاتورة تبيعها تظهر هنا: المبيعات، الربح، الأكثر مبيعاً وطرق الدفع."
                action={
                  <ButtonLink to="/pos" reloadDocument variant="primary" icon={<CartIcon />}>
                    ابدأ أول عملية بيع
                  </ButtonLink>
                }
                secondaryAction={
                  canCatalog ? (
                    <ButtonLink to="/products/new" icon={<AddIcon />}>
                      أضف أول منتج
                    </ButtonLink>
                  ) : undefined
                }
              />
            ) : null}
            {seesSales && !brandNew ? (
              <SalesTrend
                me={me}
                points={chartPoints}
                base={base}
                loading={chartLoading}
                range={range}
                onRange={setRange}
              />
            ) : null}
            {seesStock && !brandNew ? <BestSellersWeek report={weekTop} /> : null}
            {seesSales && !brandNew ? (
              <div className="grid items-start gap-6 md:grid-cols-2">
                <BestSellers report={day} />
                <PaymentMix me={me} report={day} />
              </div>
            ) : null}
            {!seesSales ? <StoreCard me={me} /> : null}
          </div>
          <div className="contents xl:col-start-2 xl:row-start-1 xl:flex xl:min-w-0 xl:flex-col xl:gap-6">
            <div className="flex min-w-0 flex-col gap-6 empty:hidden max-xl:order-[-1] max-md:order-[-3] xl:order-none">
              {showWaiting ? (
                <AttentionPanel
                  waiting={{
                    orders,
                    toSell,
                    merch,
                    expiry,
                    seesOrders,
                    seesStock,
                    seesExpiry,
                    noPhoto,
                  }}
                  merch={merch}
                  showStock={seesStock}
                  money={money}
                  skip={groupedLow(merch.data?.lowStock ?? [])}
                />
              ) : null}
              {seesContractAttention(me) ? <ContractAttention me={me} today={today} /> : null}
            </div>
            {seesSales ? <StoreCard me={me} /> : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
