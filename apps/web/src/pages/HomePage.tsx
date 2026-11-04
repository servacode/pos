import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { CURRENCIES, sectorLabel, type MeResponse, type OnlineOrder } from '@serva/core';
import {
  AddIcon,
  Badge,
  Card,
  CartIcon,
  cn,
  formatQuantity,
  GiftIcon,
  IconChip,
  InboxIcon,
  Money,
  NextIcon,
  PrintIcon,
  ProductsIcon,
  SalesIcon,
  Skeleton,
  StoreIcon,
  TrendUpIcon,
  WarningIcon,
} from '@serva/ui';
import { holdsAny, DAY_REPORT_ACCESS } from '../admin/reports/access';
import { getDayReport } from '../admin/reports/api';
import { daysAgo, getMerchandise } from '../admin/reports/MerchandisePage';
import type { DayReport } from '../admin/reports/contracts';
import { useReport, type ReportState } from '../admin/reports/useReport';
import { useMe } from '../auth/useAuth';
import { AppShell } from '../layout/AppShell';
import { apiFetch } from '../lib/api';
import { dayText, isoDay } from '../lib/dates';
import { firstName, formatDays } from '../lib/format';

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

// The home page (هوية 2): today's sales, what waits for the owner, what is about to run out, and
// the next steps, each block only for whoever may open what it links to.
function Greeting({ me }: { me: MeResponse }) {
  const today = isoDay(Date.now(), me.tenant.timezone);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">أهلاً، {firstName(me.user.fullName)}</h1>
        <p className="text-ink-muted">{dayText(today, me.settings.numberFormat)} · هذه صورة متجرك اليوم.</p>
      </div>
      <QuickActions me={me} />
    </div>
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
    <h2 className="flex items-center gap-3 text-lg font-bold text-ink">
      <IconChip tone={tone}>{icon}</IconChip>
      {children}
    </h2>
  );
}

const quickActionClass =
  'inline-flex min-h-12 items-center gap-2 rounded-full px-5 font-semibold transition-colors duration-120';

function QuickActions({ me }: { me: MeResponse }) {
  const canCatalog = holdsAny(me, ['catalog.manage']);
  return (
    <div className="flex flex-wrap gap-2">
      {canCatalog ? (
        <Link
          to="/products/new"
          className={cn(
            quickActionClass,
            'border border-line-control/60 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
          )}
        >
          <AddIcon />
          منتج جديد
        </Link>
      ) : null}
      {canCatalog ? (
        <Link
          to="/labels"
          className={cn(
            quickActionClass,
            'border border-line-control/60 bg-surface text-ink shadow-e1 hover:bg-surface-muted',
          )}
        >
          <PrintIcon />
          اطبع ملصقات
        </Link>
      ) : null}
      <a
        href="/pos"
        className={cn(quickActionClass, 'bg-brand text-on-brand shadow-e1 hover:bg-brand-hover')}
      >
        <CartIcon />
        افتح الكاشير
      </a>
    </div>
  );
}

type DayState = ReportState<DayReport>;

function TodaySales({ report }: { report: DayState }) {
  const data = report.data;
  return (
    <section
      aria-label="مبيعات اليوم"
      className="relative flex flex-col gap-5 overflow-hidden rounded-[1.75rem] bg-brand bg-[radial-gradient(120%_120%_at_0%_0%,color-mix(in_oklab,var(--color-brand-hover)_80%,transparent),transparent_60%)] p-6 text-on-brand shadow-e2 sm:p-8"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold opacity-90">
          <SalesIcon />
          مبيعات اليوم
        </p>
        <Link
          to="/sales/today"
          className="inline-flex min-h-10 items-center gap-1 rounded-full bg-on-brand/15 px-3 text-sm font-semibold hover:bg-on-brand/25"
        >
          التفاصيل
          <NextIcon size={16} />
        </Link>
      </div>
      {report.error ? (
        <p>{report.error}</p>
      ) : data ? (
        <>
          <p className="text-total font-bold">
            <Money minor={data.totalMinor} currency={data.baseCurrency} />
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-on-brand/10 px-4 py-3 ring-1 ring-on-brand/10">
              <dt className="text-sm opacity-85">الفواتير</dt>
              <dd className="num text-xl font-bold">{data.invoiceCount}</dd>
            </div>
            <div className="rounded-2xl bg-on-brand/10 px-4 py-3 ring-1 ring-on-brand/10">
              <dt className="text-sm opacity-85">متوسط الفاتورة</dt>
              <dd className="text-xl font-bold">
                <Money
                  minor={data.invoiceCount > 0 ? Math.round(data.totalMinor / data.invoiceCount) : 0}
                  currency={data.baseCurrency}
                />
              </dd>
            </div>
            <div className="col-span-2 rounded-2xl bg-on-brand/10 px-4 py-3 ring-1 ring-on-brand/10 sm:col-span-1">
              <dt className="text-sm opacity-85">الخصومات</dt>
              <dd className="text-xl font-bold">
                <Money minor={data.discountMinor} currency={data.baseCurrency} />
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <Skeleton className="h-12 w-56 bg-on-brand/20" />
      )}
    </section>
  );
}

function TopProducts({ report }: { report: DayState }) {
  const top = report.data?.topProducts.slice(0, 5) ?? [];
  return (
    <Card className="flex flex-col gap-4">
      <SectionTitle icon={<TrendUpIcon size={20} />}>الأكثر مبيعاً اليوم</SectionTitle>
      {report.loading ? (
        <Skeleton className="h-24" />
      ) : top.length === 0 ? (
        <p className="text-ink-muted">لا مبيعات بعد اليوم. أول فاتورة بتظهر هون.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {top.map((product, index) => (
            <li key={product.productId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-sm font-bold text-ink-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{product.name}</span>
              <span className="num text-sm text-ink-muted">×{formatQuantity(product.qty)}</span>
              <Money
                minor={product.totalMinor}
                currency={report.data?.baseCurrency ?? 'SYP'}
                className="font-semibold"
              />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const getPendingOrders = () =>
  apiFetch<{ items: OnlineOrder[] }>('/v1/online-orders?status=pending', { auth: true });

function Waiting() {
  const orders = useReport('orders:pending', getPendingOrders);
  const count = orders.data?.items.length ?? 0;
  const holds = orders.data?.items.filter((order) => order.source === 'hold').length ?? 0;
  const online = count - holds;
  return (
    <Card className="flex flex-col gap-3">
      <SectionTitle icon={<InboxIcon size={20} />} tone="warning">
        ينتظرك
      </SectionTitle>
      {orders.loading ? (
        <Skeleton className="h-14" />
      ) : count === 0 ? (
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
        </ul>
      )}
    </Card>
  );
}

function WaitingRow({
  to,
  count,
  tone,
  icon,
  children,
}: {
  to: string;
  count: number;
  tone: 'warning' | 'brand';
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={cn(
          'flex min-h-14 items-center gap-3 rounded-2xl px-3 font-semibold transition-opacity duration-120 hover:opacity-90',
          tone === 'warning' ? 'bg-warning-soft text-warning-ink' : 'bg-brand-soft text-brand-ink',
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

function RunningLow() {
  const report = useReport('home:low', () => getMerchandise(daysAgo(30), daysAgo(0), 60));
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

export function HomePage() {
  const me = useMe();
  const seesSales = holdsAny(me, DAY_REPORT_ACCESS);
  const seesOrders = holdsAny(me, ['customers.view']);
  const seesStock = holdsAny(me, ['report.view']);
  const today = isoDay(Date.now(), me.tenant.timezone);
  const day = useReport(seesSales ? `day:${today}` : null, () =>
    getDayReport({ branchId: null, date: today }),
  );
  // A new store starts in the wizard (04 › معالج البداية); the owner can leave it and come back.
  if (!me.onboarding.done && me.user.permissions.includes('settings.manage')) {
    return <Navigate to="/welcome" replace />;
  }
  return (
    <AppShell>
      <div className="flex flex-col gap-6 motion-safe:animate-rise">
        <TrialBanner me={me} />
        <Greeting me={me} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            {seesSales ? <TodaySales report={day} /> : null}
            {seesSales ? <TopProducts report={day} /> : null}
            {!seesSales ? <StoreCard me={me} /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            {seesOrders ? <Waiting /> : null}
            {seesStock ? <RunningLow /> : null}
            {seesSales ? <StoreCard me={me} /> : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
