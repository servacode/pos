import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  BillingCycle,
  PlanRow,
  SubscriptionInvoice,
  SubscriptionPage as Page,
  SubscriptionPayment,
} from '@serva/core';
import { COUNT_NOUNS, countNoun, type CountForms } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardIcon,
  CheckIcon,
  ChoiceCard,
  DataTable,
  IconChip,
  Money,
  PageHeader,
  ProgressBar,
  SegmentedControl,
  Skeleton,
  SkeletonText,
  SparklesIcon,
  StatusChip,
  TextField,
  type BadgeTone,
  type DataColumn,
  type Status,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { formatDays } from '../../lib/format';

const STATUS_TEXT: Record<Page['status'], string> = {
  trialing: 'فترة التجربة',
  active: 'مشترك',
  past_due: 'متأخر عن الدفع',
  suspended: 'موقوف',
  cancelled: 'ملغى',
};
const STATUS_TONE: Record<Page['status'], BadgeTone> = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};
const PAYMENT_STATUS: Record<'pending' | 'confirmed' | 'rejected', string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكدة',
  rejected: 'مرفوضة',
};
const PAYMENT_TONE: Record<SubscriptionPayment['status'], BadgeTone> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
};
const INVOICE_STATUS: Record<SubscriptionInvoice['status'], Status> = {
  open: 'awaitingPayment',
  paid: 'paid',
  cancelled: 'cancelled',
};
const CYCLE_TEXT: Record<BillingCycle, string> = { monthly: 'شهري', yearly: 'سنوي' };

/** What a plan allows, in the platform's limit keys, as the plan card lists them. */
const LIMITS: readonly { key: string; forms: CountForms; unlimited: string }[] = [
  { key: 'branches', forms: COUNT_NOUNS.branch, unlimited: 'فروع بلا حد' },
  {
    key: 'registers',
    forms: { one: 'جهاز كاشير واحد', two: 'جهازان للكاشير', few: 'أجهزة كاشير', many: 'جهازاً للكاشير' },
    unlimited: 'أجهزة كاشير بلا حد',
  },
  { key: 'users', forms: COUNT_NOUNS.user, unlimited: 'مستخدمون بلا حد' },
  { key: 'products', forms: COUNT_NOUNS.item, unlimited: 'أصناف بلا حد' },
];

const count = new Intl.NumberFormat('ar-u-nu-latn');

function limitLines(plan: PlanRow): string[] {
  return LIMITS.flatMap((limit) => {
    if (!(limit.key in plan.limits)) return [];
    const value = plan.limits[limit.key];
    if (value === null || value === undefined) return [limit.unlimited];
    return [
      value === 1 ? limit.forms.one : `حتى ${countNoun(value, limit.forms, count.format(value), true)}`,
    ];
  });
}

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-SY-u-nu-latn') : '—');

/** A label over its value, in the plan card's facts. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{children}</dd>
    </div>
  );
}

/**
 * «باقتك الحالية»: the plan and its state, when it ends and how long is left, and what the store
 * uses of what the plan allows (the branches, against the plan's limit when it is known).
 */
function CurrentPlan({ page }: { page: Page }) {
  const me = useMe();
  const trial = page.status === 'trialing';
  const ends = trial ? page.trialEndsAt : page.currentPeriodEnd;
  const daysLeft = me.subscription.daysLeft;
  const plan = page.plans.find((p) => p.code === page.planCode);
  const branchLimit = plan?.limits.branches;
  const branches = me.branches.length;
  const cycleDays = page.billingCycle === 'yearly' ? 365 : page.billingCycle === 'monthly' ? 30 : null;

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <IconChip size="lg">
            <SparklesIcon size={24} />
          </IconChip>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm text-ink-muted">باقتك الحالية</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-2xl font-bold text-ink">{page.planName}</span>
              <Badge tone={STATUS_TONE[page.status]}>{STATUS_TEXT[page.status]}</Badge>
            </span>
          </div>
        </div>
        {daysLeft !== null && ends ? (
          <p className="text-end">
            <span className="num block text-kpi font-bold text-ink">
              {formatDays(daysLeft, me.settings.numberFormat)}
            </span>
            <span className="text-sm text-ink-muted">{trial ? 'باقية من التجربة' : 'باقية من الاشتراك'}</span>
          </p>
        ) : null}
      </div>

      {daysLeft !== null && cycleDays !== null ? (
        <ProgressBar
          label="الأيام الباقية من الاشتراك"
          value={Math.min(daysLeft, cycleDays)}
          max={cycleDays}
          valueText={`${formatDays(daysLeft, me.settings.numberFormat)} باقية`}
          tone={daysLeft <= 3 ? 'warning' : 'brand'}
        />
      ) : null}

      <dl className="grid gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={trial ? 'تنتهي التجربة' : 'ينتهي الاشتراك'}>
          <span className="num">{dateText(ends)}</span>
        </Fact>
        {page.billingCycle ? <Fact label="المدة">{CYCLE_TEXT[page.billingCycle]}</Fact> : null}
        {page.graceEndsAt ? (
          <Fact label="يعمل متجرك حتى تأكيد الدفعة">
            <span className="num">{dateText(page.graceEndsAt)}</span>
          </Fact>
        ) : null}
        <Fact label="الفروع">
          {typeof branchLimit === 'number' ? (
            <div className="flex flex-col gap-2">
              <span className="num">
                {branches} من {branchLimit}
              </span>
              <ProgressBar
                label="الفروع المستعملة من الباقة"
                value={branches}
                max={branchLimit}
                tone={branches >= branchLimit ? 'warning' : 'brand'}
              />
            </div>
          ) : (
            <span className="num">{branches}</span>
          )}
        </Fact>
      </dl>
    </Card>
  );
}

/** One plan to choose (هوية 4 › Card): its price for the cycle, what it allows, and the button. */
function PlanCard({
  plan,
  cycle,
  current,
  onChoose,
}: {
  plan: PlanRow;
  cycle: BillingCycle;
  current: boolean;
  onChoose: () => void;
}) {
  const price = cycle === 'yearly' ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
  return (
    <li className="flex">
      <Card selected={current} className="flex w-full flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-semibold text-ink">{plan.name}</span>
          {current ? <Badge tone="brand">باقتك الحالية</Badge> : null}
        </div>
        <p className="flex items-baseline gap-1.5">
          <Money
            minor={price ?? 0}
            currency="USD"
            className="text-kpi font-bold tracking-tight text-ink"
            unitClassName="text-base font-semibold text-ink-subtle"
          />
          <span className="text-sm text-ink-muted">/ {cycle === 'yearly' ? 'سنة' : 'شهر'}</span>
        </p>
        <ul className="flex flex-1 flex-col gap-2.5 border-t border-line pt-5">
          {limitLines(plan).map((line) => (
            <li key={line} className="flex items-center gap-2.5 text-sm text-ink">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-ink">
                <CheckIcon size={16} strokeWidth={3} className="size-3" />
              </span>
              {line}
            </li>
          ))}
        </ul>
        <Button variant="secondary" fullWidth onClick={onChoose}>
          {current ? 'جدّد هذه الباقة' : 'اختر هذه الباقة'}
        </Button>
      </Card>
    </li>
  );
}

/** The page's shape while it loads. */
function SubscriptionLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">نحمّل اشتراكك…</span>
      <Card className="flex items-center gap-4">
        <Skeleton className="size-12" />
        <SkeletonText lines={2} className="flex-1" />
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} className="flex flex-col gap-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-9 w-32" />
            <SkeletonText lines={3} />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * «الاشتراك» (07 › فوترة الاشتراكات): the store's plan and when it ends, the plans to choose
 * from, an invoice to pay with its reference, how to pay, and the payment the owner reports
 * (which keeps the store working 72 hours while the platform confirms it).
 */
export function SubscriptionPage() {
  const me = useMe();
  const canManage = me.user.permissions.includes('subscription.manage');
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [invoice, setInvoice] = useState<SubscriptionInvoice | null>(null);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [currency, setCurrency] = useState<'SYP' | 'USD'>('SYP');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!canManage) return;
    apiFetch<Page>('/v1/subscription', { auth: true })
      .then((p) => {
        setPage(p);
        setMethod((m) => m || p.paymentMethods[0]?.key || '');
        setInvoice((current) => current ?? p.invoices.find((i) => i.status === 'open') ?? null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [canManage]);
  useEffect(load, [load]);

  async function choose(planCode: string) {
    setError(null);
    try {
      setInvoice(
        await apiFetch<SubscriptionInvoice>('/v1/subscription/invoices', {
          method: 'POST',
          body: { planCode, billingCycle: cycle },
          auth: true,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function report() {
    if (!invoice) return;
    setSaving(true);
    setFields({});
    setError(null);
    try {
      await apiFetch('/v1/subscription/payments', {
        method: 'POST',
        body: {
          invoiceId: invoice.id,
          method,
          transactionRef: reference,
          amountMinor: currency === 'SYP' ? invoice.sypMinor : invoice.usdMinor,
          currency,
        },
        auth: true,
      });
      setNotice('وصلت دفعتك. يبقى متجرك يعمل 72 ساعة حتى نؤكدها، ونرسل لك حين نؤكد.');
      setReference('');
      load();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const pendingFor = (id: string) => page?.payments.some((p) => p.invoiceId === id && p.status === 'pending');
  const chosen = page?.paymentMethods.find((m) => m.key === method);

  const invoiceColumns: DataColumn<SubscriptionInvoice>[] = [
    {
      key: 'number',
      header: 'الفاتورة',
      cell: (i) => (
        <bdi dir="ltr" className="num font-semibold whitespace-nowrap">
          {i.number}
        </bdi>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (i) => <span className="num whitespace-nowrap text-ink-muted">{dateText(i.createdAt)}</span>,
    },
    {
      key: 'plan',
      header: 'الباقة',
      className: 'hidden sm:table-cell',
      cell: (i) => (
        <span>
          {i.planName} <span className="text-ink-muted">· {CYCLE_TEXT[i.billingCycle]}</span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (i) => <Money minor={i.usdMinor} currency="USD" />,
    },
    { key: 'status', header: 'الحالة', cell: (i) => <StatusChip status={INVOICE_STATUS[i.status]} /> },
  ];

  const paymentColumns: DataColumn<SubscriptionPayment>[] = [
    {
      key: 'number',
      header: 'الدفعة',
      cell: (p) => (
        <bdi dir="ltr" className="num font-semibold whitespace-nowrap">
          {p.number}
        </bdi>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (p) => <span className="num whitespace-nowrap text-ink-muted">{dateText(p.submittedAt)}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (p) => <Money minor={p.amountMinor} currency={p.currency} />,
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={PAYMENT_TONE[p.status]}>{PAYMENT_STATUS[p.status]}</Badge>
          {p.reason ? <span className="text-sm text-danger-ink">{p.reason}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <title>الاشتراك · SERFA</title>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <PageHeader
          title="الاشتراك"
          description="باقتك ومتى تنتهي، والباقات للاختيار، وفواتير الاشتراك ودفعاتها."
          icon={<CardIcon />}
        />
        {!canManage ? <Alert tone="info">الاشتراك والدفع للمالك فقط.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {canManage && !page && !error ? <SubscriptionLoading /> : null}
        {page ? (
          <>
            <CurrentPlan page={page} />

            <section aria-labelledby="plans-title" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 id="plans-title" className="text-lg font-semibold text-ink">
                    اختر باقتك
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {Number(page.sypPerUsd) > 0 ? (
                      <>
                        الأسعار بالدولار، وتدفعها بالدولار أو بالليرة بسعر اليوم{' '}
                        <bdi className="num">{count.format(Number(page.sypPerUsd))}</bdi> ل.س.
                      </>
                    ) : (
                      'الأسعار بالدولار، وتدفعها بالدولار أو بالليرة بسعر اليوم.'
                    )}
                  </p>
                </div>
                <SegmentedControl
                  label="مدة الاشتراك"
                  value={cycle}
                  onValueChange={setCycle}
                  options={[
                    { value: 'monthly', label: 'شهري' },
                    { value: 'yearly', label: 'سنوي (شهران مجاناً)' },
                  ]}
                  className="max-sm:w-full"
                  fullWidth
                />
              </div>
              <ul className="grid gap-4 md:grid-cols-3">
                {page.plans.map((plan) => (
                  <PlanCard
                    key={plan.code}
                    plan={plan}
                    cycle={cycle}
                    current={page.planCode === plan.code}
                    onChoose={() => void choose(plan.code)}
                  />
                ))}
              </ul>
            </section>

            {invoice ? (
              <section aria-label="فاتورة الاشتراك">
                <Card className="flex flex-col gap-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-semibold text-ink">
                        <span>
                          فاتورة{' '}
                          <bdi dir="ltr" className="num">
                            {invoice.number}
                          </bdi>
                        </span>
                        <StatusChip status={INVOICE_STATUS[invoice.status]} />
                      </h2>
                      <p className="text-sm text-ink-muted">
                        {invoice.planName} · {CYCLE_TEXT[invoice.billingCycle]} · اكتب رقم الفاتورة في ملاحظة
                        التحويل.
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <Money
                        minor={invoice.sypMinor}
                        currency="SYP"
                        className="text-kpi font-bold text-ink"
                        unitClassName="text-base font-semibold text-ink-subtle"
                      />
                      <span className="text-sm text-ink-muted">
                        أو{' '}
                        <Money minor={invoice.usdMinor} currency="USD" className="font-semibold text-ink" />
                      </span>
                    </div>
                  </div>
                  {pendingFor(invoice.id) ? (
                    <Alert tone="info">أرسلت دفعة لهذه الفاتورة وهي بانتظار التأكيد.</Alert>
                  ) : (
                    <>
                      <fieldset className="flex flex-col gap-3">
                        <legend className="mb-3 text-sm font-semibold text-ink-muted">طريقة الدفع</legend>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {page.paymentMethods.map((m) => (
                            <ChoiceCard
                              key={m.key}
                              name="payment-method"
                              value={m.key}
                              title={m.label}
                              checked={method === m.key}
                              onChange={() => setMethod(m.key)}
                            />
                          ))}
                        </div>
                      </fieldset>
                      {chosen ? (
                        <dl className="grid gap-4 rounded-card border border-line bg-surface-muted/60 p-4 sm:grid-cols-2">
                          <Fact label="الحساب">
                            <bdi dir="ltr" className="num">
                              {chosen.account}
                            </bdi>
                          </Fact>
                          <Fact label="المستفيد">{chosen.beneficiary}</Fact>
                          <p className="text-sm text-ink sm:col-span-2">{chosen.instructions}</p>
                        </dl>
                      ) : null}
                      <div className="grid gap-4 md:grid-cols-2 md:items-start">
                        <TextField
                          label="رقم العملية"
                          dir="ltr"
                          inputClassName="num"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          error={fields.transactionRef}
                        />
                        <div className="flex flex-col gap-1.5">
                          <span aria-hidden="true" className="text-sm font-semibold text-ink-muted">
                            العملة التي دفعت بها
                          </span>
                          <SegmentedControl
                            label="العملة التي دفعت بها"
                            value={currency}
                            onValueChange={setCurrency}
                            options={[
                              { value: 'SYP', label: 'بالليرة' },
                              { value: 'USD', label: 'بالدولار' },
                            ]}
                            fullWidth
                          />
                        </div>
                      </div>
                      <div className="flex justify-end border-t border-line pt-5">
                        <Button
                          onClick={() => void report()}
                          loading={saving}
                          disabled={reference.trim().length < 3}
                          className="max-sm:w-full"
                        >
                          أرسلت المبلغ
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              </section>
            ) : null}

            {page.invoices.length > 0 ? (
              <section aria-labelledby="invoices-title" className="flex flex-col gap-3">
                <h2 id="invoices-title" className="text-lg font-semibold text-ink">
                  فواتير الاشتراك
                </h2>
                <DataTable
                  caption="فواتير الاشتراك"
                  columns={invoiceColumns}
                  rows={page.invoices}
                  rowKey={(i) => i.id}
                />
              </section>
            ) : null}

            {page.payments.length > 0 ? (
              <section aria-labelledby="payments-title" className="flex flex-col gap-3">
                <h2 id="payments-title" className="text-lg font-semibold text-ink">
                  دفعاتك
                </h2>
                <DataTable
                  caption="دفعاتك"
                  columns={paymentColumns}
                  rows={page.payments}
                  rowKey={(p) => p.id}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
