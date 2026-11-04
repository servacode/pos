import type { ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { CURRENCIES, sectorLabel, type CurrencyCode, type MeResponse } from '@serva/core';
import {
  Badge,
  Card,
  CardHeader,
  CartIcon,
  CashIcon,
  cn,
  CustomersIcon,
  DeviceIcon,
  EmptyState,
  formatQuantity,
  GiftIcon,
  InventoryIcon,
  KeyIcon,
  Money,
  OpenIcon,
  ProductsIcon,
  ReportsIcon,
  SalesIcon,
  SettingsIcon,
  Skeleton,
  StatTile,
  StoreIcon,
  TrendUpIcon,
  UndoIcon,
  type Icon,
} from '@serva/ui';
import { useMe } from '../auth/useAuth';
import { AppShell } from '../layout/AppShell';
import { DAY_REPORT_ACCESS, holdsAny, type AccessRule } from '../admin/reports/access';
import { getDayReport } from '../admin/reports/api';
import type { DayReport } from '../admin/reports/contracts';
import { methodLabel } from '../admin/reports/labels';
import { defaultBranch } from '../admin/reports/parts';
import { useReport } from '../admin/reports/useReport';
import { isoDay } from '../lib/dates';
import { firstName, formatDays } from '../lib/format';

const DAY_MS = 86_400_000;

function trialMessage(daysLeft: number, numberFormat: MeResponse['settings']['numberFormat']): string {
  if (daysLeft <= 0) return 'تنتهي الباقة المجانية اليوم';
  return `باقي ${formatDays(daysLeft, numberFormat)} من الباقة المجانية`;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour >= 4 && hour < 12 ? 'صباح الخير' : 'مساء الخير';
}

function todayText(): string {
  return new Intl.DateTimeFormat('ar-SY-u-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

// ─── The welcome band ────────────────────────────────────────────────────────

interface QuickAction {
  to: string;
  label: string;
  icon: Icon;
  permission?: AccessRule;
}

const QUICK_ACTIONS: QuickAction[] = [
  { to: '/pos', label: 'افتح الكاشير', icon: KeyIcon },
  { to: '/products', label: 'المنتجات', icon: ProductsIcon, permission: ['catalog.manage'] },
  { to: '/purchases', label: 'سجّل مشتريات', icon: CartIcon, permission: ['purchases.manage'] },
];

function WelcomeBand({ me }: { me: MeResponse }) {
  const actions = QUICK_ACTIONS.filter((a) => !a.permission || holdsAny(me, a.permission));
  return (
    <section className="relative overflow-hidden rounded-card bg-brand p-6 text-on-brand shadow-e2 sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--color-on-brand)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.07]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-on-brand/10 blur-2xl"
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold opacity-85">
            {greeting()} · {todayText()}
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            متجرك جاهز، {firstName(me.user.fullName)}
          </h1>
          <p className="opacity-85">هذا يومك في {me.tenant.name}: المبيعات، والأكثر مبيعاً، وطرق الدفع.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map(({ to, label, icon: ActionIcon }, i) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'inline-flex min-h-12 items-center gap-2 rounded-control px-4 font-semibold transition-colors',
                i === 0
                  ? 'bg-surface text-brand-ink shadow-e2 hover:bg-brand-soft'
                  : 'bg-on-brand/12 ring-1 ring-on-brand/20 hover:bg-on-brand/20',
              )}
            >
              <ActionIcon />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrialBanner({ me }: { me: MeResponse }) {
  const { status, daysLeft } = me.subscription;
  if (status !== 'trialing') return null;
  const endingSoon = daysLeft !== null && daysLeft <= 3;

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-card border px-4 py-3.5 sm:px-5',
        endingSoon
          ? 'border-warning-ink/20 bg-warning-soft text-warning-ink'
          : 'border-brand/15 bg-surface text-ink shadow-e1',
      )}
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-xl',
          endingSoon ? 'bg-surface/70' : 'bg-brand-soft text-brand-ink',
        )}
      >
        <GiftIcon />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="font-semibold">
          {daysLeft === null ? 'أنت على الباقة المجانية' : trialMessage(daysLeft, me.settings.numberFormat)}
        </p>
        <p className={cn('text-sm', endingSoon ? 'opacity-85' : 'text-ink-muted')}>
          كل المزايا متاحة لك خلال التجربة.
        </p>
      </div>
      {holdsAny(me, ['subscription.manage']) ? (
        <Link
          to="/subscription"
          className="hidden min-h-11 shrink-0 items-center rounded-control px-3 text-sm font-semibold text-brand-ink hover:bg-brand-soft sm:inline-flex"
        >
          اختر باقتك
        </Link>
      ) : null}
    </div>
  );
}

// ─── Today's numbers ─────────────────────────────────────────────────────────

/** The change against yesterday, as the tile shows it; none when yesterday had nothing. */
function trendOf(today: number, yesterday: number) {
  if (yesterday <= 0 || today === yesterday) return undefined;
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  return {
    direction: pct >= 0 ? ('up' as const) : ('down' as const),
    value: `${Math.abs(pct)}%`,
    comparison: 'عن أمس',
  };
}

function KpiRow({
  today,
  yesterday,
  base,
}: {
  today: DayReport;
  yesterday: DayReport | null;
  base: CurrencyCode;
}) {
  const average = today.invoiceCount > 0 ? Math.round(today.totalMinor / today.invoiceCount) : 0;
  const yAverage =
    yesterday && yesterday.invoiceCount > 0 ? Math.round(yesterday.totalMinor / yesterday.invoiceCount) : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="صافي مبيعات اليوم"
        icon={TrendUpIcon}
        value={<Money minor={today.netSalesMinor} currency={base} />}
        trend={yesterday ? trendOf(today.netSalesMinor, yesterday.netSalesMinor) : undefined}
      />
      <StatTile
        label="الفواتير"
        icon={SalesIcon}
        tone="info"
        value={today.invoiceCount}
        trend={yesterday ? trendOf(today.invoiceCount, yesterday.invoiceCount) : undefined}
      />
      <StatTile
        label="متوسط الفاتورة"
        icon={ReportsIcon}
        tone="neutral"
        value={<Money minor={average} currency={base} />}
        trend={yesterday ? trendOf(average, yAverage) : undefined}
      />
      <StatTile
        label="المرتجعات"
        icon={UndoIcon}
        tone={today.returns.count > 0 ? 'warning' : 'neutral'}
        value={<Money minor={today.returns.totalMinor} currency={base} />}
        footnote={today.returns.count > 0 ? `${today.returns.count} مرتجع` : 'لا مرتجعات اليوم'}
      />
    </div>
  );
}

/** A ranked line with a bar for its share of the largest one. */
function ShareRow({
  rank,
  label,
  sub,
  value,
  share,
}: {
  rank?: number;
  label: ReactNode;
  sub?: ReactNode;
  value: ReactNode;
  share: number;
}) {
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        {rank !== undefined ? (
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-lg text-xs font-bold',
              rank === 1 ? 'bg-brand text-on-brand' : 'bg-surface-muted text-ink-muted',
            )}
          >
            {rank}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-ink">{label}</span>
          {sub ? <span className="text-xs text-ink-muted">{sub}</span> : null}
        </div>
        <span className="shrink-0 font-semibold text-ink">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, share * 100)}%` }} />
      </div>
    </li>
  );
}

function TopProducts({ report, base }: { report: DayReport; base: CurrencyCode }) {
  const top = report.topProducts.slice(0, 6);
  const max = Math.max(1, ...top.map((p) => p.totalMinor));
  return (
    <Card>
      <CardHeader
        icon={ProductsIcon}
        title="الأكثر مبيعاً اليوم"
        description="بقيمة المبيعات، والضريبة ضمنها"
        action={
          <Link to="/reports/merchandise" className="text-sm font-semibold text-brand-ink hover:underline">
            حركة الأصناف
          </Link>
        }
      />
      <ol className="divide-y divide-line">
        {top.map((p, i) => (
          <ShareRow
            key={p.productId}
            rank={i + 1}
            label={p.name}
            sub={`الكمية ${formatQuantity(p.qty)}`}
            value={<Money minor={p.totalMinor} currency={base} />}
            share={p.totalMinor / max}
          />
        ))}
      </ol>
    </Card>
  );
}

function PaymentMethods({ report, base }: { report: DayReport; base: CurrencyCode }) {
  const total = Math.max(
    1,
    report.byMethod.reduce((sum, m) => sum + m.baseAmountMinor, 0),
  );
  return (
    <Card>
      <CardHeader icon={CashIcon} title="طرق الدفع" description="ما دخل الصندوق اليوم" />
      <ul className="divide-y divide-line">
        {report.byMethod.map((m) => (
          <ShareRow
            key={`${m.method}-${m.currency}`}
            label={methodLabel(m.method, m.currency, base)}
            sub={`${m.count} فاتورة · ${Math.round((m.baseAmountMinor / total) * 100)}%`}
            value={<Money minor={m.amountMinor} currency={m.currency} />}
            share={m.baseAmountMinor / total}
          />
        ))}
      </ul>
    </Card>
  );
}

function Cashiers({ report, base }: { report: DayReport; base: CurrencyCode }) {
  const max = Math.max(1, ...report.byCashier.map((c) => c.totalMinor));
  return (
    <Card>
      <CardHeader icon={CustomersIcon} title="حسب الكاشير" />
      <ul className="divide-y divide-line">
        {report.byCashier.map((c) => (
          <ShareRow
            key={c.userId}
            label={c.fullName}
            sub={`${c.invoiceCount} فاتورة`}
            value={<Money minor={c.totalMinor} currency={base} />}
            share={c.totalMinor / max}
          />
        ))}
      </ul>
    </Card>
  );
}

function TodaySection({ me }: { me: MeResponse }) {
  const branchId = defaultBranch(me);
  const now = Date.now();
  const today = isoDay(now, me.tenant.timezone);
  const yesterday = isoDay(now - DAY_MS, me.tenant.timezone);
  const base = me.settings.baseCurrency;
  const report = useReport(`home:${branchId ?? 'all'}:${today}`, () =>
    Promise.all([
      getDayReport({ branchId, date: today }),
      getDayReport({ branchId, date: yesterday }).catch(() => null),
    ]),
  );

  if (report.error) {
    return (
      <Card className="flex items-center justify-between gap-4">
        <p className="text-ink-muted">تعذّر تحميل أرقام اليوم. {report.error}</p>
        <button type="button" onClick={report.retry} className="font-semibold text-brand-ink hover:underline">
          حاول مرة أخرى
        </button>
      </Card>
    );
  }
  if (!report.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
          </Card>
        ))}
      </div>
    );
  }

  const [day, before] = report.data;
  return (
    <div className="flex flex-col gap-6">
      <KpiRow today={day} yesterday={before} base={base} />
      {day.invoiceCount === 0 ? (
        <Card>
          <EmptyState
            icon={SalesIcon}
            title="لا مبيعات اليوم بعد."
            description="تظهر هنا أرقام اليوم مع أول فاتورة على الكاشير."
            action={
              <Link
                to="/pos"
                className="inline-flex min-h-12 items-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand hover:bg-brand-hover"
              >
                <KeyIcon />
                افتح الكاشير
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <TopProducts report={day} base={base} />
          <div className="flex flex-col gap-6">
            <PaymentMethods report={day} base={base} />
            {day.byCashier.length > 1 ? <Cashiers report={day} base={base} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shortcuts and the store ─────────────────────────────────────────────────

const SHORTCUTS: (QuickAction & { text: string })[] = [
  {
    to: '/products',
    label: 'المنتجات',
    text: 'الأسعار والباركود والمقاسات',
    icon: ProductsIcon,
    permission: ['catalog.manage'],
  },
  {
    to: '/customers',
    label: 'الزبائن',
    text: 'الديون والتحصيل',
    icon: CustomersIcon,
    permission: ['customers.view'],
  },
  {
    to: '/inventory',
    label: 'المخزون والأرباح',
    text: 'الكميات والكلفة والهدر',
    icon: InventoryIcon,
    permission: ['cost.view'],
  },
  {
    to: '/purchases',
    label: 'المشتريات',
    text: 'الموردون والفواتير',
    icon: CartIcon,
    permission: ['purchases.manage'],
  },
  {
    to: '/devices',
    label: 'الأجهزة',
    text: 'ربط كاشير جديد',
    icon: DeviceIcon,
    permission: ['devices.view'],
  },
  {
    to: '/settings',
    label: 'إعدادات المتجر',
    text: 'الإيصال والعملة',
    icon: SettingsIcon,
    permission: ['settings.manage'],
  },
];

function Shortcuts({ me }: { me: MeResponse }) {
  const items = SHORTCUTS.filter((s) => !s.permission || holdsAny(me, s.permission));
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="shortcuts-title" className="flex flex-col gap-3">
      <h2 id="shortcuts-title" className="text-lg font-bold text-ink">
        اختصارات
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(({ to, label, text, icon: ItemIcon }) => (
          <li key={to}>
            <Link
              to={to}
              className="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-e1 transition-[border-color,box-shadow] duration-120 hover:border-brand/30 hover:shadow-e2"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-ink transition-colors group-hover:bg-brand group-hover:text-on-brand">
                <ItemIcon size={24} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold text-ink">{label}</span>
                <span className="truncate text-sm text-ink-muted">{text}</span>
              </span>
              <OpenIcon className="text-ink-subtle transition-colors group-hover:text-brand-ink" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function StoreCard({ me }: { me: MeResponse }) {
  const base = CURRENCIES[me.settings.baseCurrency];
  return (
    <Card>
      <CardHeader icon={StoreIcon} title="متجرك" />
      <dl className="flex flex-col gap-4">
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
  // A new store starts in the wizard (04 › معالج البداية); the owner can leave it and come back.
  if (!me.onboarding.done && me.user.permissions.includes('settings.manage')) {
    return <Navigate to="/welcome" replace />;
  }
  const seesSales = holdsAny(me, DAY_REPORT_ACCESS);
  return (
    <AppShell>
      <div className="flex flex-col gap-6 motion-safe:animate-rise">
        <WelcomeBand me={me} />
        <TrialBanner me={me} />
        {seesSales ? <TodaySection me={me} /> : null}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Shortcuts me={me} />
          <StoreCard me={me} />
        </div>
      </div>
    </AppShell>
  );
}
