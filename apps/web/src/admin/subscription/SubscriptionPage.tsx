import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  BillingCycle,
  SubscriptionInvoice,
  SubscriptionPayment,
  SubscriptionPage as Page,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  DataTable,
  FullScreenLoader,
  Money,
  PageHeader,
  SubscriptionIcon,
  TextField,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';

const STATUS_TEXT: Record<Page['status'], string> = {
  trialing: 'فترة التجربة',
  active: 'مشترك',
  past_due: 'متأخر عن الدفع',
  suspended: 'موقوف',
  cancelled: 'ملغى',
};
const PAYMENT_STATUS: Record<'pending' | 'confirmed' | 'rejected', string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكدة',
  rejected: 'مرفوضة',
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ar-SY-u-nu-latn') : '—');

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

  return (
    <AppShell>
      <title>الاشتراك · Serva POS</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          className="mb-0"
          icon={SubscriptionIcon}
          title="الاشتراك"
          description="باقتك الحالية، وتجديدها أو تغييرها، ودفعاتك وفواتيرك."
        />
        {!canManage ? <Alert tone="info">الاشتراك والدفع للمالك فقط.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {canManage && !page && !error ? <FullScreenLoader /> : null}
        {page ? (
          <>
            <section
              aria-label="اشتراكك الحالي"
              className="relative overflow-hidden rounded-card bg-brand p-6 text-on-brand shadow-e2 sm:p-8"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full bg-on-brand/10 blur-2xl"
              />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold opacity-85">الباقة</p>
                  <p className="text-3xl font-bold tracking-tight">{page.planName}</p>
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-on-brand/15 px-3 py-1 text-sm font-semibold ring-1 ring-on-brand/20">
                    <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                    {STATUS_TEXT[page.status]}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm opacity-85">
                      {page.status === 'trialing' ? 'تنتهي التجربة' : 'ينتهي الاشتراك'}
                    </p>
                    <p className="num text-xl font-bold">
                      {dateText(page.status === 'trialing' ? page.trialEndsAt : page.currentPeriodEnd)}
                    </p>
                  </div>
                  {page.graceEndsAt ? (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm opacity-85">يعمل متجرك حتى تأكيد الدفعة</p>
                      <p className="num text-xl font-bold">{dateText(page.graceEndsAt)}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-ink">اختر باقتك</h2>
                <div
                  role="group"
                  aria-label="مدة الاشتراك"
                  className="inline-flex gap-1 rounded-xl bg-surface-muted p-1"
                >
                  {(['monthly', 'yearly'] as const).map((c) => (
                    <PressButton key={c} pressed={cycle === c} onClick={() => setCycle(c)}>
                      {c === 'monthly' ? 'شهري' : 'سنوي (شهران مجاناً)'}
                    </PressButton>
                  ))}
                </div>
              </div>
              <ul className="grid gap-4 md:grid-cols-3">
                {page.plans.map((plan) => {
                  const price = cycle === 'yearly' ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
                  const current = page.planCode === plan.code;
                  return (
                    <li key={plan.code} className="flex">
                      <Card selected={current} interactive className="flex w-full flex-col gap-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-lg font-bold text-ink">{plan.name}</span>
                          {current ? <Badge tone="brand">باقتك الحالية</Badge> : null}
                        </div>
                        <span className="text-3xl font-bold tracking-tight text-ink">
                          <Money minor={price ?? 0} currency="USD" />
                          <span className="text-sm font-normal text-ink-muted">
                            {' '}
                            / {cycle === 'yearly' ? 'سنة' : 'شهر'}
                          </span>
                        </span>
                        <Button
                          variant={current ? 'secondary' : 'primary'}
                          className="mt-auto"
                          onClick={() => void choose(plan.code)}
                        >
                          {current ? 'جدّد هذه الباقة' : 'اختر هذه الباقة'}
                        </Button>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>

            {invoice ? (
              <section
                aria-label="فاتورة الاشتراك"
                className="flex flex-col gap-5 rounded-card border-2 border-brand bg-surface p-5 shadow-e2 sm:p-6"
              >
                <h2 className="text-lg font-bold text-ink">
                  فاتورة{' '}
                  <bdi dir="ltr" className="num">
                    {invoice.number}
                  </bdi>{' '}
                  · {invoice.planName} · {invoice.billingCycle === 'yearly' ? 'سنوي' : 'شهري'}
                </h2>
                <p className="rounded-control bg-brand-soft px-4 py-3 text-ink">
                  المبلغ: <Money minor={invoice.sypMinor} currency="SYP" className="font-bold" /> أو{' '}
                  <Money minor={invoice.usdMinor} currency="USD" className="font-bold" /> · اكتب رقم الفاتورة
                  في ملاحظة التحويل.
                </p>
                {pendingFor(invoice.id) ? (
                  <Alert tone="info">أرسلت دفعة لهذه الفاتورة وهي بانتظار التأكيد.</Alert>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <p className="text-sm font-semibold text-ink-muted">طريقة الدفع</p>
                      <div
                        role="group"
                        aria-label="طريقة الدفع"
                        className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-xl bg-surface-muted p-1"
                      >
                        {page.paymentMethods.map((m) => (
                          <PressButton
                            key={m.key}
                            pressed={method === m.key}
                            onClick={() => setMethod(m.key)}
                          >
                            {m.label}
                          </PressButton>
                        ))}
                      </div>
                    </div>
                    {chosen ? (
                      <dl className="grid gap-1 rounded-control border border-line bg-surface-muted p-4 text-sm text-ink">
                        <dt className="text-ink-muted">الحساب</dt>
                        <dd>
                          <bdi dir="ltr" className="num text-base font-semibold">
                            {chosen.account}
                          </bdi>
                        </dd>
                        <dt className="mt-2 text-ink-muted">المستفيد</dt>
                        <dd className="font-semibold">{chosen.beneficiary}</dd>
                        <dd className="mt-2 border-t border-line pt-2">{chosen.instructions}</dd>
                      </dl>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField
                        label="رقم العملية"
                        dir="ltr"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        error={fields.transactionRef}
                      />
                      <div role="group" aria-label="العملة التي دفعت بها" className="flex items-end">
                        <div className="inline-flex gap-1 rounded-xl bg-surface-muted p-1">
                          {(['SYP', 'USD'] as const).map((c) => (
                            <PressButton key={c} pressed={currency === c} onClick={() => setCurrency(c)}>
                              {c === 'SYP' ? 'بالليرة' : 'بالدولار'}
                            </PressButton>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end border-t border-line pt-4">
                      <Button
                        size="lg"
                        className="max-sm:w-full"
                        onClick={() => void report()}
                        loading={saving}
                        disabled={reference.trim().length < 3}
                      >
                        أرسلت المبلغ
                      </Button>
                    </div>
                  </>
                )}
              </section>
            ) : null}

            {page.payments.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-ink">دفعاتك</h2>
                <DataTable
                  caption="دفعاتك"
                  columns={paymentColumns}
                  rows={page.payments}
                  rowKey={(p) => p.id}
                />
              </section>
            ) : null}

            {page.invoices.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-ink">فواتير الاشتراك</h2>
                <DataTable
                  caption="فواتير الاشتراك"
                  columns={invoiceColumns}
                  rows={page.invoices}
                  rowKey={(i) => i.id}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

/** One choice in a group of pressed-or-not buttons, drawn as a segment. */
function PressButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-lg px-4 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        pressed ? 'bg-surface text-brand-ink shadow-e1' : 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

const paymentColumns: DataColumn<SubscriptionPayment>[] = [
  {
    key: 'number',
    header: 'الرقم',
    cell: (p) => (
      <bdi dir="ltr" className="num font-semibold">
        {p.number}
      </bdi>
    ),
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
        <Badge tone={p.status === 'rejected' ? 'danger' : p.status === 'confirmed' ? 'success' : 'warning'}>
          {PAYMENT_STATUS[p.status]}
        </Badge>
        {p.reason ? <span className="text-ink-muted">{p.reason}</span> : null}
      </span>
    ),
  },
];

const INVOICE_STATUS: Record<SubscriptionInvoice['status'], { label: string; tone: BadgeTone }> = {
  open: { label: 'بانتظار الدفع', tone: 'warning' },
  paid: { label: 'مدفوعة', tone: 'success' },
  cancelled: { label: 'ملغاة', tone: 'neutral' },
};

const invoiceColumns: DataColumn<SubscriptionInvoice>[] = [
  {
    key: 'number',
    header: 'الرقم',
    cell: (i) => (
      <bdi dir="ltr" className="num font-semibold">
        {i.number}
      </bdi>
    ),
  },
  {
    key: 'plan',
    header: 'الباقة',
    cell: (i) => `${i.planName} · ${i.billingCycle === 'yearly' ? 'سنوي' : 'شهري'}`,
  },
  { key: 'date', header: 'التاريخ', cell: (i) => dateText(i.createdAt) },
  {
    key: 'amount',
    header: 'المبلغ',
    numeric: true,
    cell: (i) => <Money minor={i.usdMinor} currency="USD" />,
  },
  {
    key: 'status',
    header: 'الحالة',
    cell: (i) => <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>,
  },
];
