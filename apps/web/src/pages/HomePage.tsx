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
  cn,
  compactNumber,
  EmptyState,
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
  WarningIcon,
  type StatTileProps,
  type TabItem,
} from '@serva/ui';
import { ButtonLink } from '../admin/products/parts';
import { getProfit, listExpiry } from '../admin/purchases/api';
import { listCheques } from '../admin/cheques/api';
import { listProducts } from '../admin/catalog/api';
import { dueSoon } from '../admin/cheques/ChequesPage';
import { holdsAny, DAY_REPORT_ACCESS } from '../admin/reports/access';
import { ContractAttention, seesContractAttention } from './ContractAttention';
import { getDayReport, getDayTotals } from '../admin/reports/api';
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
      className="flex items-center gap-4 rounded-card border border-brand/20 bg-brand-soft px-4 py-4 text-brand-ink shadow-e1 sm:px-5 lg:hidden"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface/70">
        <GiftIcon />
      </span>
      <div className="flex min-w-0 flex-col">
        <p className="font-semibold">
          {daysLeft === null ? 'أنت على الباقة المجانية' : trialMessage(daysLeft, me.settings.numberFormat)}
        </p>
        <p className="text-sm opacity-85">كل المزايا متاحة لك خلال التجربة.</p>
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
  if (percent >= 100) return { direction, value: 'أكثر من الضعف', comparison: 'عن أمس', tone: 'neutral' };
  return {
    direction,
    value: `${formatNumber(Math.abs(percent), digits)}%`,
    comparison: 'عن أمس',
    ...(thin ? { tone: 'neutral' as const } : {}),
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
}: {
  /** No sales in the days before today: say it once here instead of on every tile */
  noHistory?: boolean;
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
            مبيعات اليوم
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
                <span className="inline-flex items-center gap-1 rounded-full bg-on-brand/15 px-2 py-0.5 text-xs font-semibold">
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
              <span className="opacity-85">
                الخصومات{' '}
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
    <Card className="flex shrink-0 snap-start flex-col gap-3 max-sm:w-[calc((100%-0.5rem)/2.3)] max-sm:min-w-36 max-sm:gap-1 max-sm:p-2 sm:min-w-0">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-32 max-sm:h-6" />
      <Skeleton className="h-9 max-sm:hidden" />
    </Card>
  );
}

/** On a phone the tiles scroll sideways, one snapping into place; from 640 px they share the row. */
const TILE_CLASS = 'shrink-0 snap-start max-sm:w-[calc((100%-0.5rem)/2.3)] max-sm:min-w-36 sm:min-w-0';

function KpiBand({
  me,
  day,
  points,
  profit,
  seesProfit,
}: {
  me: MeResponse;
  day: DayState;
  /** The last seven days, oldest first, today last. */
  points: readonly DayPoint[];
  profit: ReportState<{
    grossProfitMinor: number;
    netSalesMinor: number;
    costOfSalesMinor?: number;
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
  const average = data && data.invoiceCount > 0 ? Math.round(netOfReturns(data) / data.invoiceCount) : 0;
  const yesterdayAverage = yesterday?.count ? Math.round((yesterday.total ?? 0) / yesterday.count) : null;

  return (
    <section aria-label="مبيعات اليوم" className="flex flex-col gap-4">
      <HeroTile
        data={data}
        trend={data ? changeOf(netOfReturns(data), yesterday?.total, digits, thin) : undefined}
        week={weekReady && data && !noHistory && !thin ? totals : null}
        noHistory={noHistory}
        zeroMorning={zeroMorning}
      />
      <SnapRow
        label="مؤشرات اليوم"
        className="scrollbar-none relative flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4 sm:grid sm:auto-cols-fr sm:grid-flow-col sm:gap-4 sm:overflow-visible sm:pb-0"
      >
        {data ? (
          <>
            <StatTile
              className={TILE_CLASS}
              label="الفواتير"
              value={<span className="num">{formatNumber(data.invoiceCount, digits)}</span>}
              trend={zeroMorning ? undefined : changeOf(data.invoiceCount, yesterday?.count, digits, thin)}
              sparkline={!thin ? counts : undefined}
            />
            <StatTile
              className={TILE_CLASS}
              label="متوسط الفاتورة"
              value={<Money minor={average} currency={data.baseCurrency} />}
              trend={zeroMorning ? undefined : changeOf(average, yesterdayAverage, digits, thin)}
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
                    ? `هامش ${formatNumber(Math.round((profit.data.grossProfitMinor / profit.data.netSalesMinor) * 100), digits)}% من صافي المبيعات بعد المرتجع وبدون الضريبة (${formatMoney(profit.data.netSalesMinor, profit.data.baseCurrency, { digits })})`
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
}

/** A product with pieces that ran low: all its pieces in one group, one row on the home page */
interface LowGroup<T extends LowItem> {
  productId: string;
  items: T[];
  /** Every piece is gone: the only case shown in red */
  allOut: boolean;
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
    allOut: list.every((item) => item.stockQty <= 0),
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
  const unit = (n: number) =>
    sized
      ? n === 2
        ? 'مقاسان'
        : n >= 3 && n <= 10
          ? `${n} مقاسات`
          : `${n} مقاساً`
      : n === 2
        ? 'صنفان'
        : n >= 3 && n <= 10
          ? `${n} أصناف`
          : `${n} صنفاً`;
  const parts: string[] = [];
  if (out > 0) parts.push(`${unit(out)} ${out === 2 ? 'نفدا' : 'نفدت'}`);
  if (lowOnes > 0) parts.push(`${unit(lowOnes)} ${lowOnes === 2 ? 'يوشكان' : 'يوشك'} على النفاد`);
  return `${name}: ${parts.join(' و')}`;
}

type OrdersState = ReportState<{ items: OnlineOrder[] }>;
type MerchState = ReportState<Awaited<ReturnType<typeof getMerchandise>>>;
type ExpiryState = ReportState<Awaited<ReturnType<typeof listExpiry>>>;
type ChequesState = ReportState<Awaited<ReturnType<typeof listCheques>>>;

interface WaitingArgs {
  orders: OrdersState;
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
  merch,
  expiry,
  seesOrders,
  seesStock,
  seesExpiry,
  cheques,
  today,
  noPhoto = 0,
}: WaitingArgs) {
  const count = orders.data?.items.length ?? 0;
  const holds = orders.data?.items.filter((order) => order.source === 'hold').length ?? 0;
  const online = count - holds;
  // Every low product is one group, whatever the store sells; a piece below zero is named once, in
  // «المخزون», where its chip opens the count
  const stock = lowGroups(merch.data?.lowStock ?? []);
  const expiring = expiry.data?.items.length ?? 0;
  // A recalled batch no till sells (استدعاء دفعة): it waits for the owner's decision
  const recalled = expiry.data?.items.filter((row) => row.blocked).length ?? 0;
  const loading =
    (seesOrders && orders.loading) || (seesStock && merch.loading) || (seesExpiry && expiry.loading);
  const chequesDue = cheques?.data && today ? dueSoon(cheques.data.items, today).length : 0;
  const chequesOut = cheques?.data && today ? dueSoon(cheques.data.items, today, 'out').length : 0;
  // The tab counts rows, as the list shows them; «بلا صورة» is a suggestion, shown but not counted
  const total =
    (online > 0 ? 1 : 0) +
    (holds > 0 ? 1 : 0) +
    stock.length +
    (expiring > 0 ? 1 : 0) +
    (recalled > 0 ? 1 : 0) +
    (chequesDue > 0 ? 1 : 0) +
    (chequesOut > 0 ? 1 : 0);
  return {
    holds,
    online,
    stock,
    expiring,
    recalled,
    loading,
    chequesDue,
    chequesOut,
    noPhoto,
    total,
    empty: total === 0 && noPhoto === 0,
  };
}

/** How many rows «تحتاج انتباهك» shows before «عرض الكل» */
const WAITING_ROWS = 3;

function Waiting({ bare = false, ...args }: WaitingArgs & { bare?: boolean }) {
  const [all, setAll] = useState(false);
  const { holds, online, stock, expiring, recalled, loading, chequesDue, chequesOut, noPhoto, empty } =
    waitingFigures(args);
  // Red only for what blocks (a recalled batch) or is wholly gone; everything else is amber or calm.
  // Most serious first, so the three rows shown are the three that matter.
  const rows: ReactNode[] = [];
  if (recalled > 0)
    rows.push(
      <WaitingRow key="recalled" to="/recall" count={recalled} tone="danger" icon={<WarningIcon />}>
        {recalled === 1 ? 'دفعة موقوفة عن البيع (استدعاء)' : 'دفعات موقوفة عن البيع (استدعاء)'}
      </WaitingRow>,
    );
  const rowOf = (group: (typeof stock)[number]) => {
    const [item] = group.items;
    if (!item) return null;
    const single = group.items.length === 1;
    const colour = item.attributes?.find((a) => a.name === 'اللون')?.value;
    const size = sizeOf(item);
    const state = item.stockQty <= 0 ? 'نفد' : 'يوشك على النفاد';
    return (
      <WaitingRow
        key={group.productId}
        to={`/products/${group.productId}`}
        // «نفد» is in the sentence: no second «نفد» beside it
        count={single ? (item.stockQty <= 0 ? null : stockChip(item.stockQty)) : group.items.length}
        tone={group.allOut ? 'danger' : 'warning'}
        icon={<WarningIcon />}
      >
        {single ? (
          size ? (
            <>
              المقاس {size}
              {colour ? ` (${colour})` : ''} من {item.name} {state}
            </>
          ) : (
            <>
              {item.name} {state}
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
      <WaitingRow key="online" to="/online-store" count={online} tone="warning" icon={<StoreIcon />}>
        {online === 1 ? 'طلب جديد من المتجر الإلكتروني' : 'طلبات جديدة من المتجر الإلكتروني'}
      </WaitingRow>,
    );
  if (holds > 0)
    rows.push(
      <WaitingRow key="holds" to="/online-store" count={holds} tone="brand" icon={<GiftIcon />}>
        {holds === 1 ? 'قطعة محجوزة بعربون' : 'قطع محجوزة بعربون'}
      </WaitingRow>,
    );
  for (const group of stock.filter((g) => !g.allOut)) rows.push(rowOf(group));
  if (chequesDue > 0)
    rows.push(
      <WaitingRow key="due" to="/cheques" count={chequesDue} tone="warning" icon={<CalendarIcon />}>
        {chequesDue === 1 ? 'شيك يستحق خلال 7 أيام' : 'شيكات تستحق خلال 7 أيام'}
      </WaitingRow>,
    );
  if (chequesOut > 0)
    rows.push(
      <WaitingRow key="out" to="/cheques" count={chequesOut} tone="warning" icon={<CalendarIcon />}>
        {chequesOut === 1 ? 'شيك صادر للمورد يستحق خلال 7 أيام' : 'شيكات صادرة للموردين تستحق خلال 7 أيام'}
      </WaitingRow>,
    );
  if (expiring > 0)
    rows.push(
      <WaitingRow key="expiring" to="/expiry" count={expiring} tone="warning" icon={<CalendarIcon />}>
        {expiring === 1 ? 'دفعة يقترب انتهاؤها' : 'دفعات يقترب انتهاؤها'}
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

/** A low piece's chip: «نفد» for none, «ناقص 3» for a stock that went below zero, else the count */
function stockChip(qty: number): string {
  if (qty < 0) return `ناقص ${formatQuantity(-qty)}`;
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
          <SectionTitle icon={<WarningIcon size={20} />} tone="danger">
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
                      ? 'bg-danger-soft text-danger-ink'
                      : 'bg-warning-soft text-warning-ink',
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
              «ناقص» يعني أنك بعت أكثر من المسجّل. استلم البضاعة أو{' '}
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
function AttentionPanel({
  waiting,
  merch,
  skip,
  showStock,
}: {
  waiting: WaitingArgs;
  merch: MerchState;
  skip?: ReadonlySet<string> | undefined;
  showStock: boolean;
}) {
  const [picked, setPicked] = useState<'now' | 'stock' | null>(null);
  const figures = waitingFigures(waiting);
  const stockRows = showStock ? lowRows(merch, skip).length : 0;
  const stockTab = showStock && (stockRows > 0 || merch.loading || merch.error !== null);
  const tab = picked ?? (figures.empty && stockRows > 0 ? 'stock' : 'now');
  const active = tab === 'stock' && stockTab ? 'stock' : 'now';
  const items: TabItem<'now' | 'stock'>[] = [
    {
      value: 'now',
      label: 'المطلوب الآن',
      ...(figures.total > 0 ? { count: figures.total } : {}),
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
  const seesSales = holdsAny(me, DAY_REPORT_ACCESS);
  const seesOrders = holdsAny(me, ['customers.view']);
  const seesStock = holdsAny(me, ['report.view']);
  const seesProfit = holdsAny(me, ['reports.financial']);
  const seesExpiry = holdsAny(me, ['purchases.manage']);
  const seesCheques = holdsAny(me, ['customers.view']);
  const today = isoDay(Date.now(), me.tenant.timezone);

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
              <div className="min-w-0 max-xl:order-[-2]">
                <KpiBand me={me} day={day} points={weekPoints} profit={profit} seesProfit={seesProfit} />
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
            <div className="flex min-w-0 flex-col gap-6 empty:hidden max-xl:order-[-1] xl:order-none">
              {showWaiting ? (
                <AttentionPanel
                  waiting={{
                    orders,
                    merch,
                    expiry,
                    seesOrders,
                    seesStock,
                    seesExpiry,
                    cheques,
                    noPhoto,
                    today,
                  }}
                  merch={merch}
                  showStock={seesStock}
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
