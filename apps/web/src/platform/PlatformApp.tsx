import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  PaymentMethodInfo,
  PlanRow,
  PlatformPayment,
  PlatformSettings,
  PlatformStore,
} from '@serva/core';
import {
  AdminShell,
  Alert,
  Badge,
  Button,
  CalendarIcon,
  Card,
  CardHeader,
  CardIcon,
  CashIcon,
  Checkbox,
  CheckCircleIcon,
  CheckIcon,
  cn,
  CONTROL_HEIGHT,
  DataTable,
  DensityProvider,
  EmptyState,
  GiftIcon,
  IconButton,
  IconChip,
  initialsOf,
  Logo,
  LogoutIcon,
  MenuIcon,
  Money,
  NavGroup,
  NavItem,
  NextIcon,
  PageHeader,
  ShieldCheckIcon,
  Skeleton,
  SkeletonText,
  SparklesIcon,
  StatTile,
  StoreIcon,
  TextField,
  ThemeToggle,
  useDensity,
  type BadgeTone,
  type DataColumn,
  type Icon,
} from '@serva/ui';
import { apiFetch, errorMessage } from '../lib/api';
import { counted } from '../pos/format';
import { PlatformLogin } from './PlatformLogin';
import { PlatformSecurity } from './PlatformSecurity';

/**
 * The platform panel (07 › لوحة مدير المنصة), apart from the stores: its own sign-in (email and
 * password of a platform account, eight hours), then the stores and their subscriptions, the
 * payments waiting to be confirmed, the plans and their prices, and how stores pay.
 */

const TOKEN_KEY = 'servaPlatformToken';
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const keepToken = (token: string | null) => {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private window: the session lasts as long as the page
  }
};

const STATUS_TEXT: Record<string, string> = {
  trialing: 'تجربة',
  active: 'مشترك',
  past_due: 'متأخر',
  suspended: 'موقوف',
  cancelled: 'ملغى',
};
/** The subscription's state as a badge: the word and its colour (هوية 4 › Badge). */
const STATUS_TONE: Record<string, BadgeTone> = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-SY-u-nu-latn') : '—');
/** A calendar day («2026-11-04») in the same words as dateText, read as that day where the panel is. */
const dayText = (day: string | null) => {
  const parts = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!parts) return day ?? '—';
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).toLocaleDateString(
    'ar-SY-u-nu-latn',
  );
};

export function PlatformApp() {
  const [token, setToken] = useState<string | null>(readToken);
  const signOut = () => {
    keepToken(null);
    setToken(null);
  };
  return (
    <div dir="rtl" className="min-h-dvh bg-canvas">
      <title>لوحة المنصة · Serva</title>
      {token ? (
        <Panel token={token} onSignOut={signOut} />
      ) : (
        <PlatformLogin
          onSignedIn={(t) => {
            keepToken(t);
            setToken(t);
          }}
        />
      )}
    </div>
  );
}

function usePlatform(token: string, onSignOut: () => void) {
  return useCallback(
    async <T,>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}): Promise<T> => {
      try {
        return await apiFetch<T>(path, { ...init, authorization: `Bearer ${token}` });
      } catch (e) {
        if ((e as { status?: number }).status === 401) onSignOut();
        throw e;
      }
    },
    [token, onSignOut],
  );
}

/** The panel's four parts, in the sidebar: their names, pictures and the line under each title. */
const SECTIONS: readonly { value: string; label: string; icon: Icon; description: string }[] = [
  {
    value: 'payments',
    label: 'الدفعات',
    icon: CardIcon,
    description: 'ما حوّلته المتاجر لاشتراكاتها: أكّد ما وصل، أو ارفضه مع السبب.',
  },
  {
    value: 'stores',
    label: 'المتاجر',
    icon: StoreIcon,
    description: 'كل متجر على المنصة، وباقته، وحالة اشتراكه، وآخر بيع فيه.',
  },
  {
    value: 'plans',
    label: 'الباقات والأسعار',
    icon: SparklesIcon,
    description: 'أسماء الباقات وأسعارها بالدولار وأيام التجربة.',
  },
  {
    value: 'settings',
    label: 'طرق الدفع',
    icon: CashIcon,
    description: 'الحسابات التي تحوّل إليها المتاجر، وسعر الدولار الذي تُحسب به فواتيرها.',
  },
  {
    value: 'security',
    label: 'الأمان',
    icon: ShieldCheckIcon,
    description: 'التحقق بخطوتين لدخول اللوحة، ورموز الاسترداد.',
  },
];

/**
 * The panel (هوية 4, compact): the deep-emerald sidebar with the four parts, the top bar with
 * where you are, the theme and the way out, and the open part under its title.
 */
function Panel({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const call = usePlatform(token, onSignOut);
  const [tab, setTab] = useState('payments');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const section = SECTIONS.find((s) => s.value === tab) ?? SECTIONS[0]!;
  const choose = (value: string) => {
    setTab(value);
    setDrawerOpen(false);
  };
  return (
    <DensityProvider density="compact">
      <AdminShell
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        drawerLabel="أقسام اللوحة"
        sidebar={<Sidebar tab={tab} onChoose={choose} />}
        topBar={
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <IconButton
                label="افتح القائمة"
                icon={<MenuIcon />}
                className="-ms-2 lg:hidden"
                onClick={() => setDrawerOpen(true)}
              />
              <nav aria-label="أنت هنا" className="min-w-0">
                <ol className="flex min-w-0 items-center gap-1.5 text-[0.9375rem]">
                  <li className="flex min-w-0 items-center gap-2.5 font-semibold text-ink">
                    <IconChip size="sm">
                      <ShieldCheckIcon size={16} />
                    </IconChip>
                    <span className="truncate">لوحة المنصة</span>
                  </li>
                  <li className="hidden min-w-0 items-center gap-1.5 sm:flex">
                    <NextIcon size={16} className="shrink-0 text-ink-subtle" />
                    <span aria-current="page" className="truncate font-semibold text-ink-muted">
                      {section.label}
                    </span>
                  </li>
                </ol>
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ThemeToggle />
              <span aria-hidden="true" className="mx-1.5 h-6 w-px shrink-0 bg-line" />
              <Button variant="ghost" icon={<LogoutIcon />} onClick={onSignOut}>
                اخرج
              </Button>
            </div>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <PageHeader title={section.label} description={section.description} />
          {tab === 'stores' ? (
            <Stores call={call} />
          ) : tab === 'plans' ? (
            <Plans call={call} />
          ) : tab === 'settings' ? (
            <Settings call={call} />
          ) : tab === 'security' ? (
            <PlatformSecurity call={call} />
          ) : (
            <Payments call={call} />
          )}
        </div>
      </AdminShell>
    </DensityProvider>
  );
}

/** The deep-emerald sidebar: the logo, the four parts, and a note on the session at its foot. */
function Sidebar({ tab, onChoose }: { tab: string; onChoose: (value: string) => void }) {
  return (
    <>
      <div className="flex h-8 shrink-0 items-center px-1.5">
        <Logo tone="sidebar" />
      </div>
      <nav aria-label="أقسام اللوحة" className="mt-6 flex flex-col">
        <NavGroup>
          {SECTIONS.map((s) => {
            const SectionIcon = s.icon;
            return (
              <li key={s.value}>
                <NavItem
                  as="button"
                  type="button"
                  active={tab === s.value}
                  icon={<SectionIcon size={20} />}
                  onClick={() => onChoose(s.value)}
                  className="w-full text-start"
                >
                  {s.label}
                </NavItem>
              </li>
            );
          })}
        </NavGroup>
      </nav>
      <div className="mt-auto pt-4">
        <div className="flex items-center gap-2.5 rounded-card border border-sidebar-line bg-sidebar-hover p-3">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-small bg-sidebar-active text-sidebar-brand"
          >
            <ShieldCheckIcon size={16} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-sidebar-strong">إدارة المنصة</span>
            <span className="text-xs text-sidebar-muted">جلسة لثماني ساعات</span>
          </div>
        </div>
      </div>
    </>
  );
}

type Call = ReturnType<typeof usePlatform>;

function useList<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load()
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [load]);
  useEffect(reload, [reload]);
  return { data, error, reload, setError };
}

const PAYMENT_STATUSES = [
  { value: 'pending', label: 'بانتظار التأكيد' },
  { value: 'confirmed', label: 'مؤكدة' },
  { value: 'rejected', label: 'مرفوضة' },
] as const;

/** What the empty queue says for each status: why nothing is there yet. */
const NO_PAYMENTS: Record<(typeof PAYMENT_STATUSES)[number]['value'], string> = {
  pending: 'حين يحوّل متجر قيمة اشتراكه ويكتب رقم العملية، تظهر دفعته هنا لتؤكدها.',
  confirmed: 'الدفعات التي تؤكدها تبقى هنا، مع فواتيرها.',
  rejected: 'الدفعات التي ترفضها تبقى هنا، مع سبب الرفض.',
};

function Payments({ call }: { call: Call }) {
  const density = useDensity();
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'rejected'>('pending');
  const load = useCallback(
    () => call<{ items: PlatformPayment[] }>(`/v1/platform/payments?status=${status}`),
    [call, status],
  );
  const { data, error, reload, setError } = useList(load);
  const act = async (id: string, confirm: boolean) => {
    const reason = confirm ? null : window.prompt('سبب الرفض؟');
    if (!confirm && !reason) return;
    try {
      await call(`/v1/platform/payments/${id}/${confirm ? 'confirm' : 'reject'}`, {
        method: 'POST',
        ...(confirm ? {} : { body: { reason } }),
      });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const columns: DataColumn<PlatformPayment>[] = [
    {
      key: 'store',
      header: 'المتجر',
      cell: (p) => (
        <span className="flex flex-col py-1.5 whitespace-nowrap">
          <span className="font-semibold">{p.storeName}</span>
          <span className="num text-xs text-ink-subtle">{dateText(p.submittedAt)}</span>
        </span>
      ),
    },
    {
      key: 'invoice',
      header: 'الفاتورة',
      cell: (p) => (
        <bdi dir="ltr" className="num">
          {p.invoiceNumber}
        </bdi>
      ),
    },
    {
      key: 'plan',
      header: 'الباقة',
      cell: (p) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          {p.planName}
          <Badge dot={false}>{p.billingCycle === 'yearly' ? 'سنوي' : 'شهري'}</Badge>
        </span>
      ),
    },
    {
      key: 'ref',
      header: 'رقم العملية',
      cell: (p) => (
        <bdi dir="ltr" className="num whitespace-nowrap">
          <span className="text-ink-muted">{p.method}</span> · {p.transactionRef}
        </bdi>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (p) => (
        <span className="flex flex-col items-end py-1.5">
          <Money minor={p.amountMinor} currency={p.currency} className="font-semibold" />
          <span className="text-xs text-ink-subtle">
            المطلوب{' '}
            <Money
              minor={p.currency === 'SYP' ? p.invoiceSypMinor : p.invoiceUsdMinor}
              currency={p.currency}
            />
          </span>
        </span>
      ),
    },
    {
      key: 'act',
      header: '',
      className: 'w-px',
      cell: (p) =>
        p.status === 'pending' ? (
          <span className="flex justify-end gap-1.5">
            <Button variant="secondary" icon={<CheckIcon size={16} />} onClick={() => void act(p.id, true)}>
              أكّد
            </Button>
            <Button variant="ghost" onClick={() => void act(p.id, false)}>
              ارفض
            </Button>
          </span>
        ) : (
          <span className="block max-w-64 text-ink-muted">{p.reason ?? ''}</span>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="الحالة"
          className={cn(
            CONTROL_HEIGHT[density],
            'scrollbar-none inline-flex max-w-full gap-1 overflow-x-auto rounded-control bg-surface-muted p-1',
          )}
        >
          {PAYMENT_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={status === s.value}
              onClick={() => setStatus(s.value)}
              className={cn(
                'shrink-0 rounded-small px-3 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-120 ease-standard',
                status === s.value
                  ? 'bg-surface text-ink shadow-e1 ring-1 ring-line'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {data && data.items.length > 0 ? (
          <p className="text-sm font-semibold text-ink-muted">
            {counted(data.items.length, ['دفعة واحدة', 'دفعتان', 'دفعات', 'دفعة'])}
          </p>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="الدفعات"
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(p) => p.id}
        loading={!data && !error}
        empty={<EmptyState icon={CardIcon} title="لا دفعات هنا." description={NO_PAYMENTS[status]} />}
      />
    </div>
  );
}

function Stores({ call }: { call: Call }) {
  const load = useCallback(() => call<{ items: PlatformStore[] }>('/v1/platform/stores'), [call]);
  const { data, error, reload, setError } = useList(load);
  const extend = async (s: PlatformStore) => {
    const days = Number(window.prompt('كم يوماً تضيف؟', '30'));
    if (!days || days < 1) return;
    const from = Math.max(Date.now(), s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : 0);
    try {
      await call(`/v1/platform/stores/${s.tenantId}/subscription`, {
        method: 'PUT',
        body: {
          planCode: s.planCode ?? 'free',
          status: s.status === 'trialing' ? 'trialing' : 'active',
          currentPeriodEnd: new Date(from + days * 86_400_000).toISOString(),
        },
      });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const columns: DataColumn<PlatformStore>[] = [
    {
      key: 'name',
      header: 'المتجر',
      cell: (s) => (
        <span className="flex items-center gap-3 py-1.5 whitespace-nowrap">
          <IconChip size="sm">
            <span className="text-xs font-bold">{initialsOf(s.name)}</span>
          </IconChip>
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{s.name}</span>
            <span className="text-xs text-ink-subtle">
              <bdi dir="ltr" className="num">
                {s.ownerPhone ?? ''} · {s.storeCode}
              </bdi>
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'plan',
      header: 'الباقة',
      cell: (s) => <span className="whitespace-nowrap">{s.planName ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'الاشتراك',
      cell: (s) =>
        s.status ? (
          <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{STATUS_TEXT[s.status] ?? s.status}</Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'end',
      header: 'تنتهي',
      cell: (s) => <span className="num whitespace-nowrap">{dateText(s.currentPeriodEnd)}</span>,
    },
    {
      key: 'sale',
      header: 'آخر بيع',
      cell: (s) => <span className="num whitespace-nowrap">{dayText(s.lastSale)}</span>,
    },
    {
      key: 'pending',
      header: 'دفعات معلّقة',
      numeric: true,
      cell: (s) =>
        s.pendingPayments > 0 ? (
          <Badge tone="warning">{s.pendingPayments}</Badge>
        ) : (
          <span className="text-ink-subtle">{s.pendingPayments}</span>
        ),
    },
    {
      key: 'act',
      header: '',
      className: 'w-px',
      cell: (s) => (
        <Button variant="secondary" icon={<CalendarIcon size={16} />} onClick={() => void extend(s)}>
          مدّد
        </Button>
      ),
    },
  ];
  const items = data?.items;
  const counted = (status: PlatformStore['status']) => items?.filter((s) => s.status === status).length ?? 0;
  const pending = items?.reduce((sum, s) => sum + s.pendingPayments, 0) ?? 0;
  return (
    <div className="flex flex-col gap-6">
      {items ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="المتاجر" value={items.length} icon={<StoreIcon size={16} />} />
          <StatTile
            label="اشتراكات فعّالة"
            value={counted('active')}
            icon={<CheckCircleIcon size={16} />}
            iconTone="success"
          />
          <StatTile
            label="في التجربة"
            value={counted('trialing')}
            icon={<GiftIcon size={16} />}
            iconTone="info"
          />
          <StatTile
            label="دفعات معلّقة"
            value={pending}
            icon={<CardIcon size={16} />}
            iconTone={pending > 0 ? 'warning' : 'neutral'}
          />
        </div>
      ) : !error ? (
        <div aria-hidden="true" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="flex flex-col gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-14" />
            </Card>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      <DataTable
        caption="المتاجر"
        columns={columns}
        rows={items ?? []}
        rowKey={(s) => s.tenantId}
        loading={!data && !error}
        empty={
          <EmptyState
            icon={StoreIcon}
            title="لا متاجر بعد."
            description="حين يفتح صاحب محل متجره على سيرفا، يظهر هنا مع باقته."
          />
        }
      />
    </div>
  );
}

const centsText = (v: number | null) => (v === null ? '' : String(v / 100));
const centsOf = (t: string) => (t.trim() === '' ? null : Math.round(Number(t) * 100) || null);

/** What a plan allows, in the platform's limit keys, in the words of the store's plan card. */
const LIMITS: readonly { key: string; one: string; many: (count: string) => string; unlimited: string }[] = [
  { key: 'branches', one: 'فرع واحد', many: (n) => `حتى ${n} فروع`, unlimited: 'فروع بلا حد' },
  {
    key: 'registers',
    one: 'جهاز كاشير واحد',
    many: (n) => `حتى ${n} أجهزة كاشير`,
    unlimited: 'أجهزة كاشير بلا حد',
  },
  { key: 'users', one: 'مستخدم واحد', many: (n) => `حتى ${n} مستخدمين`, unlimited: 'مستخدمون بلا حد' },
  { key: 'products', one: 'صنف واحد', many: (n) => `حتى ${n} صنف`, unlimited: 'أصناف بلا حد' },
];

const countText = new Intl.NumberFormat('ar-u-nu-latn');

function limitLines(plan: PlanRow): string[] {
  return LIMITS.flatMap((limit) => {
    if (!(limit.key in plan.limits)) return [];
    const value = plan.limits[limit.key];
    if (value === null || value === undefined) return [limit.unlimited];
    return [value === 1 ? limit.one : limit.many(countText.format(value))];
  });
}

function Plans({ call }: { call: Call }) {
  const load = useCallback(() => call<{ items: PlanRow[] }>('/v1/platform/plans'), [call]);
  const { data, error, reload, setError } = useList(load);
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">حُفظت باقة {saved}.</Alert> : null}
      {data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.items.map((plan) => (
            <PlanForm
              key={plan.code}
              plan={plan}
              onSave={async (input) => {
                try {
                  await call(`/v1/platform/plans/${plan.code}`, { method: 'PUT', body: input });
                  setSaved(input.name);
                  reload();
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            />
          ))}
        </div>
      ) : !error ? (
        <div aria-hidden="true" className="grid gap-4 xl:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="flex flex-col gap-6">
              <Skeleton className="h-6 w-40" />
              <SkeletonText lines={2} />
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A unit at the end of a field («$», «يوم», «ل.س»), in the field's subtle ink (هوية 4 › الحقول). */
function Unit({ children }: { children: ReactNode }) {
  return <span className="me-3 shrink-0 text-sm">{children}</span>;
}

function PlanForm({
  plan,
  onSave,
}: {
  plan: PlanRow;
  onSave: (input: {
    name: string;
    priceMonthlyMinor: number | null;
    priceYearlyMinor: number | null;
    trialDays: number | null;
    isActive: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(plan.name);
  const [monthly, setMonthly] = useState(centsText(plan.priceMonthlyMinor));
  const [yearly, setYearly] = useState(centsText(plan.priceYearlyMinor));
  const [trial, setTrial] = useState(plan.trialDays === null ? '' : String(plan.trialDays));
  const limits = limitLines(plan);
  return (
    <Card>
      <form
        aria-label={`باقة ${plan.name}`}
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({
            name,
            priceMonthlyMinor: centsOf(monthly),
            priceYearlyMinor: centsOf(yearly),
            trialDays: trial.trim() === '' ? null : Number(trial),
            isActive: plan.isActive,
          });
        }}
      >
        <CardHeader
          icon={plan.isFree ? <GiftIcon /> : <SparklesIcon />}
          title={plan.name}
          description={limits.length > 0 ? limits.join(' · ') : undefined}
          action={
            <>
              {plan.isFree ? <Badge tone="brand">مجانية</Badge> : null}
              <Badge tone={plan.isActive ? 'success' : 'neutral'}>
                {plan.isActive ? 'مفعّلة' : 'موقوفة'}
              </Badge>
            </>
          }
        />
        <div className="grid flex-1 content-start gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <TextField label="الاسم" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="أيام التجربة"
            dir="ltr"
            value={trial}
            onChange={(e) => setTrial(e.target.value)}
            endAdornment={<Unit>يوم</Unit>}
          />
          <TextField
            label="شهرياً بالدولار"
            dir="ltr"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            endAdornment={<Unit>$</Unit>}
          />
          <TextField
            label="سنوياً بالدولار"
            dir="ltr"
            value={yearly}
            onChange={(e) => setYearly(e.target.value)}
            endAdornment={<Unit>$</Unit>}
          />
        </div>
        <div className="mt-5 flex items-center justify-end">
          <Button type="submit" variant="secondary">
            احفظ
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Settings({ call }: { call: Call }) {
  const load = useCallback(() => call<PlatformSettings>('/v1/platform/settings'), [call]);
  const { data, error, setError } = useList(load);
  const [methods, setMethods] = useState<PaymentMethodInfo[] | null>(null);
  const [rate, setRate] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data) {
      setMethods(data.paymentMethods);
      setRate(data.sypPerUsd);
    }
  }, [data]);
  if (!methods) {
    return error ? (
      <Alert tone="error">{error}</Alert>
    ) : (
      <div aria-hidden="true" className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <Card key={i} className="flex flex-col gap-6">
            <Skeleton className="h-6 w-40" />
            <SkeletonText lines={2} />
          </Card>
        ))}
      </div>
    );
  }
  const edit = (i: number, patch: Partial<PaymentMethodInfo>) =>
    setMethods((all) => all!.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        call('/v1/platform/settings', { method: 'PUT', body: { paymentMethods: methods, sypPerUsd: rate } })
          .then(() => setSaved(true))
          .catch((err: unknown) => setError(errorMessage(err)));
      }}
    >
      <Card>
        <CardHeader
          icon={<CashIcon />}
          title="سعر الصرف"
          description="الدولار بالليرة، تُحسب به فواتير الاشتراك بالليرة."
        />
        <TextField
          label="سعر الدولار للفواتير (ليرة)"
          hint="من نشرة المصرف المركزي، يُحدَّث أسبوعياً"
          dir="ltr"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          endAdornment={<Unit>ل.س</Unit>}
          className="max-w-sm"
        />
      </Card>
      {methods.map((m, i) => (
        <fieldset
          key={m.key}
          className="min-w-0 rounded-card border border-line bg-surface p-5 shadow-e1 sm:p-6"
        >
          <legend className="float-start mb-4 flex items-center gap-3">
            <IconChip>
              <CardIcon />
            </IconChip>
            <span className="text-lg font-semibold text-ink">{m.label}</span>
          </legend>
          <div className="float-end mb-4">
            <Checkbox
              label="مفعّلة"
              checked={m.enabled}
              onChange={(e) => edit(i, { enabled: e.target.checked })}
            />
          </div>
          <div className="clear-both grid gap-4 md:grid-cols-2">
            <TextField
              label={`رقم حساب ${m.label}`}
              dir="ltr"
              value={m.account}
              onChange={(e) => edit(i, { account: e.target.value })}
            />
            <TextField
              label={`المستفيد في ${m.label}`}
              value={m.beneficiary}
              onChange={(e) => edit(i, { beneficiary: e.target.value })}
            />
            <TextField
              label={`تعليمات ${m.label}`}
              value={m.instructions}
              onChange={(e) => edit(i, { instructions: e.target.value })}
              className="md:col-span-2"
            />
          </div>
        </fieldset>
      ))}
      {/* هوية 4 › a long form keeps its action in reach: a bar that stays at the foot of the view. */}
      <div className="sticky bottom-4 z-10 mt-2 flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface/90 p-3 shadow-e2 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {saved ? <Alert tone="success">حُفظت طرق الدفع وسعر الصرف.</Alert> : null}
          {!error && !saved ? (
            <p className="px-1 text-sm text-ink-muted">تظهر هذه الحسابات للمتاجر حين تدفع اشتراكها.</p>
          ) : null}
        </div>
        <Button type="submit">احفظ</Button>
      </div>
    </form>
  );
}
