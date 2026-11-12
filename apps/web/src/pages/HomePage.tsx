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
  Skeleton,
  StatTile,
  StoreIcon,
  TrendDownIcon,
  TrendUpIcon,
  WarningIcon,
  type StatTileProps,
} from '@serva/ui';
import { ButtonLink } from '../admin/products/parts';
import { getProfit, listExpiry } from '../admin/purchases/api';
import { holdsAny, DAY_REPORT_ACCESS } from '../admin/reports/access';
import { getDayReport } from '../admin/reports/api';
import { daysAgo, getMerchandise } from '../admin/reports/MerchandisePage';
import type { DayReport } from '../admin/reports/contracts';
import { methodLabel } from '../admin/reports/labels';
import { useReport, type ReportState } from '../admin/reports/useReport';
import { useMe } from '../auth/useAuth';
import { AppShell } from '../layout/AppShell';
import { apiFetch } from '../lib/api';
import { dayText, isoDay } from '../lib/dates';
import { firstName, formatDays, formatNumber, type NumberFormat } from '../lib/format';

function trialMessage(daysLeft: number, numberFormat: MeResponse['settings']['numberFormat']): string {
  if (daysLeft <= 0) return 'تنتهي الباقة المجانية اليوم';
  return `باقي ${formatDays(daysLeft, numberFormat)} من الباقة المجانية`;
}

function TrialBanner({ me }: { me: MeResponse }) {
  const { status, daysLeft } = me.subscription;
  if (status !== 'trialing') return null;
  const endingSoon = daysLeft !== null && daysLeft <= 3;

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-card border px-4 py-4 shadow-e1 sm:px-5',
        endingSoon
          ? 'border-warning-ink/20 bg-warning-soft text-warning-ink'
          : 'border-brand/20 bg-brand-soft text-brand-ink',
      )}
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

/** One day of sales: null where that day's report did not load. */
interface DayPoint {
  date: string;
  total: number | null;
  count: number | null;
}

const loadDays = (dates: readonly string[]) =>
  Promise.all(
    dates.map((date): Promise<DayPoint> =>
      getDayReport({ branchId: null, date }).then(
        (report) => ({ date, total: report.totalMinor, count: report.invoiceCount }),
        () => ({ date, total: null, count: null }),
      ),
    ),
  );

/** The change of `current` against `previous` as a tile's pill; none when it cannot be told. */
function changeOf(
  current: number,
  previous: number | null | undefined,
  digits: NumberFormat,
): StatTileProps['trend'] {
  if (previous === null || previous === undefined || previous <= 0) return undefined;
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return undefined;
  return {
    direction: percent > 0 ? 'up' : 'down',
    value: `${formatNumber(Math.abs(percent), digits)}%`,
    comparison: 'عن أمس',
  };
}

type DayState = ReportState<DayReport>;

// ─── Header ──────────────────────────────────────────────────────────────────

function QuickActions({ me }: { me: MeResponse }) {
  const canCatalog = holdsAny(me, ['catalog.manage']);
  return (
    <>
      {canCatalog ? (
        <ButtonLink to="/products/new" icon={<AddIcon />}>
          منتج جديد
        </ButtonLink>
      ) : null}
      {canCatalog ? (
        <ButtonLink to="/labels" icon={<PrintIcon />}>
          اطبع ملصقات
        </ButtonLink>
      ) : null}
      <ButtonLink to="/pos" reloadDocument variant="primary" icon={<CartIcon />}>
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

/** The last seven days as small columns on the hero: the oldest at the right, today solid. */
function WeekBars({ values }: { values: readonly number[] }) {
  const top = Math.max(...values, 1);
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="flex h-16 items-end gap-1.5">
        {values.map((value, index) => (
          <span
            key={index}
            className={cn(
              'w-3 rounded-t-small sm:w-4',
              index === values.length - 1 ? 'bg-on-brand' : 'bg-on-brand/35',
            )}
            style={{ height: `${Math.max(8, Math.round((value / top) * 100))}%` }}
          />
        ))}
      </div>
      <span className="text-xs opacity-80">آخر 7 أيام</span>
    </div>
  );
}

function HeroTile({
  data,
  trend,
  week,
}: {
  data: DayReport | null;
  trend: StatTileProps['trend'];
  week: readonly number[] | null;
}) {
  const TrendIcon = trend?.direction === 'down' ? TrendDownIcon : TrendUpIcon;
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-5 overflow-hidden rounded-panel bg-brand bg-[radial-gradient(120%_120%_at_0%_0%,color-mix(in_oklab,var(--color-brand-hover)_80%,transparent),transparent_60%)] p-5 text-on-brand shadow-e2 sm:p-7">
      <div className="flex min-w-0 flex-col gap-3">
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
              <Money minor={data.totalMinor} currency={data.baseCurrency} />
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {trend ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-on-brand/15 px-2 py-0.5 text-xs font-semibold">
                  <TrendIcon size={16} />
                  <span className="sr-only">{trend.direction === 'up' ? 'ارتفاع' : 'انخفاض'}</span>
                  <bdi className="num">{trend.value}</bdi>
                  <span className="font-normal opacity-85">{trend.comparison}</span>
                </span>
              ) : null}
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
    <Card className="flex min-w-60 shrink-0 snap-start flex-col gap-3 sm:min-w-0">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9" />
    </Card>
  );
}

/** On a phone the tiles scroll sideways, one snapping into place; from 640 px they share the row. */
const TILE_CLASS = 'min-w-60 shrink-0 snap-start sm:min-w-0';

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
  profit: ReportState<{ grossProfitMinor: number; netSalesMinor: number; baseCurrency: CurrencyCode }>;
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
  const average = data && data.invoiceCount > 0 ? Math.round(data.totalMinor / data.invoiceCount) : 0;
  const yesterdayAverage = yesterday?.count ? Math.round((yesterday.total ?? 0) / yesterday.count) : null;

  return (
    <section aria-label="مبيعات اليوم" className="flex flex-col gap-4">
      <HeroTile
        data={data}
        trend={data ? changeOf(data.totalMinor, yesterday?.total, digits) : undefined}
        week={weekReady && data ? totals : null}
      />
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 sm:grid sm:auto-cols-fr sm:grid-flow-col sm:overflow-visible sm:pb-0">
        {data ? (
          <>
            <StatTile
              className={TILE_CLASS}
              label="الفواتير"
              value={<span className="num">{formatNumber(data.invoiceCount, digits)}</span>}
              trend={changeOf(data.invoiceCount, yesterday?.count, digits)}
              sparkline={weekReady ? counts : undefined}
            />
            <StatTile
              className={TILE_CLASS}
              label="متوسط الفاتورة"
              value={<Money minor={average} currency={data.baseCurrency} />}
              trend={changeOf(average, yesterdayAverage, digits)}
              sparkline={weekReady ? averages : undefined}
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
                profit.data.netSalesMinor > 0
                  ? `هامش ${formatNumber(Math.round((profit.data.grossProfitMinor / profit.data.netSalesMinor) * 100), digits)}% من صافي المبيعات`
                  : undefined
              }
            />
          ) : (
            <TileSkeleton />
          )
        ) : null}
      </div>
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
        axisLabels={points.map((p) => {
          const [, month, date] = p.date.split('-').map(Number);
          return `${formatNumber(date ?? 0, digits)}/${formatNumber(month ?? 0, digits)}`;
        })}
        series={[
          {
            key: 'sales',
            label: 'المبيعات',
            values: points.map((p) => (p.total === null ? null : p.total / factor)),
          },
        ]}
        formatValue={(value) => formatMoney(Math.round(value * factor), base, { digits })}
        formatTick={(value) => compactNumber(value, digits)}
        view={view}
        labelHeader="اليوم"
        loading={loading}
        empty={
          <p className="py-10 text-center text-sm text-ink-muted">
            {allZero ? 'ما في مبيعات بهالفترة بعد.' : 'تعذّر تحميل أيام هالفترة.'}
          </p>
        }
      />
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
      {report.loading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : top.length === 0 ? (
        <p className="text-ink-muted">لا مبيعات بعد اليوم. أول فاتورة بتظهر هون.</p>
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
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle icon={<SalesIcon size={20} />}>طرق الدفع اليوم</SectionTitle>
      <ShareBar
        label="حصة كل طريقة دفع من مبيعات اليوم"
        parts={parts}
        loading={report.loading}
        formatValue={(value) => formatMoney(Math.round(value * factor), base, { digits })}
        empty={<p className="text-ink-muted">ما في دفعات بعد اليوم.</p>}
      />
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
  count: number;
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
        <span className="num text-lg font-bold">{count}</span>
        <NextIcon size={16} />
      </Link>
    </li>
  );
}

type OrdersState = ReportState<{ items: OnlineOrder[] }>;
type MerchState = ReportState<Awaited<ReturnType<typeof getMerchandise>>>;
type ExpiryState = ReportState<Awaited<ReturnType<typeof listExpiry>>>;

function Waiting({
  orders,
  merch,
  expiry,
  seesOrders,
  seesStock,
  seesExpiry,
}: {
  orders: OrdersState;
  merch: MerchState;
  expiry: ExpiryState;
  seesOrders: boolean;
  seesStock: boolean;
  seesExpiry: boolean;
}) {
  const count = orders.data?.items.length ?? 0;
  const holds = orders.data?.items.filter((order) => order.source === 'hold').length ?? 0;
  const online = count - holds;
  const low = merch.data?.lowStock.length ?? 0;
  const expiring = expiry.data?.items.length ?? 0;
  const loading =
    (seesOrders && orders.loading) || (seesStock && merch.loading) || (seesExpiry && expiry.loading);
  const empty = online + holds + low + expiring === 0;
  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle icon={<InboxIcon size={20} />} tone="warning">
        ما ينتظرك
      </SectionTitle>
      {loading && empty ? (
        <Skeleton className="h-14" />
      ) : empty ? (
        <p className="text-ink-muted">ما في شي ينتظرك هلق.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {online > 0 ? (
            <WaitingRow to="/online-store" count={online} tone="warning" icon={<StoreIcon />}>
              {online === 1 ? 'طلب جديد من المتجر الإلكتروني' : 'طلبات جديدة من المتجر الإلكتروني'}
            </WaitingRow>
          ) : null}
          {holds > 0 ? (
            <WaitingRow to="/online-store" count={holds} tone="brand" icon={<GiftIcon />}>
              {holds === 1 ? 'قطعة محجوزة بعربون' : 'قطع محجوزة بعربون'}
            </WaitingRow>
          ) : null}
          {low > 0 ? (
            <WaitingRow to="/reports/merchandise" count={low} tone="danger" icon={<WarningIcon />}>
              {low === 1 ? 'صنف قرّب يخلص مخزونه' : 'أصناف قرّب يخلص مخزونها'}
            </WaitingRow>
          ) : null}
          {expiring > 0 ? (
            <WaitingRow to="/expiry" count={expiring} tone="warning" icon={<CalendarIcon />}>
              {expiring === 1 ? 'دفعة قرّب انتهاؤها' : 'دفعات قرّب انتهاؤها'}
            </WaitingRow>
          ) : null}
        </ul>
      )}
    </Card>
  );
}

function RunningLow({ report }: { report: MerchState }) {
  const low = report.data?.lowStock.slice(0, 5) ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={<WarningIcon size={20} />} tone="danger">
          قرّب يخلص
        </SectionTitle>
        <Link to="/reports/merchandise" className="text-sm font-semibold text-brand-ink hover:underline">
          كل القائمة
        </Link>
      </div>
      {report.loading ? (
        <Skeleton className="h-20" />
      ) : report.error ? (
        <p className="text-sm text-ink-muted">تعذّر تحميل المخزون.</p>
      ) : low.length === 0 ? (
        <p className="text-ink-muted">كل الأصناف يلي عم تنباع عندك منها كمية كافية.</p>
      ) : (
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
                {formatQuantity(item.stockQty)}
              </span>
            </li>
          ))}
        </ul>
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
  const today = isoDay(Date.now(), me.tenant.timezone);

  const day = useReport(seesSales ? `day:${today}` : null, () =>
    getDayReport({ branchId: null, date: today }),
  );
  // The six days before today feed the sparklines and the 7-day chart; the 30-day view adds the
  // 23 before them, only once asked for. A day that fails to load is a gap, never an error.
  const week = useReport(seesSales ? `week:${today}` : null, () =>
    loadDays([6, 5, 4, 3, 2, 1].map((back) => shiftDay(today, back))),
  );
  const month = useReport(seesSales && range === '30' ? `month:${today}` : null, () =>
    loadDays(Array.from({ length: 23 }, (_, i) => shiftDay(today, 29 - i))),
  );
  const profit = useReport(seesSales && seesProfit ? `profit:${today}` : null, () => getProfit(today, today));
  const orders = useReport(seesOrders ? 'orders:pending' : null, getPendingOrders);
  const merch = useReport(seesStock ? 'home:low' : null, () => getMerchandise(daysAgo(30), daysAgo(0), 60));
  const expiry = useReport(seesExpiry ? 'home:expiry' : null, () => listExpiry(30));

  // A new store starts in the wizard (04 › معالج البداية); the owner can leave it and come back.
  if (!me.onboarding.done && me.user.permissions.includes('settings.manage')) {
    return <Navigate to="/welcome" replace />;
  }

  const known = new Map<string, DayPoint>();
  for (const point of [...(month.data ?? []), ...(week.data ?? [])]) known.set(point.date, point);
  if (day.data) known.set(today, { date: today, total: day.data.totalMinor, count: day.data.invoiceCount });
  const pointsOf = (days: number): DayPoint[] =>
    Array.from({ length: days }, (_, i) => {
      const date = shiftDay(today, days - 1 - i);
      return known.get(date) ?? { date, total: null, count: null };
    });
  const weekPoints = pointsOf(7);
  const chartPoints = range === '30' ? pointsOf(30) : weekPoints;
  const chartLoading = day.loading || week.loading || (range === '30' && month.loading);
  const base = day.data?.baseCurrency ?? me.settings.baseCurrency;

  // Nothing sold yet, today or in the week behind: a brand-new store gets a way in, not empty charts.
  const brandNew =
    day.data !== null &&
    week.data !== null &&
    day.data.invoiceCount === 0 &&
    weekPoints.every((p) => !p.total);

  const canCatalog = holdsAny(me, ['catalog.manage']);
  const showWaiting = seesOrders || seesStock || seesExpiry;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 motion-safe:animate-rise">
        <TrialBanner me={me} />
        <PageHeader
          title={`أهلاً، ${firstName(me.user.fullName)}`}
          description={`${weekdayOf(today)} ${dayText(today, me.settings.numberFormat)} · هذه صورة متجرك اليوم.`}
          actions={<QuickActions me={me} />}
        />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            {seesSales ? (
              <KpiBand me={me} day={day} points={weekPoints} profit={profit} seesProfit={seesProfit} />
            ) : null}
            {seesSales && brandNew ? (
              <EmptyState
                icon={CartIcon}
                title="ما في مبيعات بعد"
                description="أول فاتورة بتبيعها بتظهر هون: المبيعات، الربح، الأكثر مبيعاً وطرق الدفع."
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
            {seesSales && !brandNew ? (
              <div className="grid items-start gap-6 md:grid-cols-2">
                <BestSellers report={day} />
                <PaymentMix me={me} report={day} />
              </div>
            ) : null}
            {!seesSales ? <StoreCard me={me} /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            {showWaiting ? (
              <Waiting
                orders={orders}
                merch={merch}
                expiry={expiry}
                seesOrders={seesOrders}
                seesStock={seesStock}
                seesExpiry={seesExpiry}
              />
            ) : null}
            {seesStock ? <RunningLow report={merch} /> : null}
            {seesSales ? <StoreCard me={me} /> : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
