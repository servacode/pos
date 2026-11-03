import { useCallback, useEffect, useState } from 'react';
import type { BillingCycle, SubscriptionInvoice, SubscriptionPage as Page } from '@serva/core';
import { Alert, Button, cn, FullScreenLoader, Money, StatTile, TextField } from '@serva/ui';
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
        <h1 className="text-2xl font-bold text-ink">الاشتراك</h1>
        {!canManage ? <Alert tone="info">الاشتراك والدفع للمالك فقط.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {canManage && !page && !error ? <FullScreenLoader /> : null}
        {page ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile hero label="الباقة" value={page.planName} footnote={STATUS_TEXT[page.status]} />
              <StatTile
                label={page.status === 'trialing' ? 'تنتهي التجربة' : 'ينتهي الاشتراك'}
                value={dateText(page.status === 'trialing' ? page.trialEndsAt : page.currentPeriodEnd)}
              />
              {page.graceEndsAt ? (
                <StatTile label="يعمل متجرك حتى تأكيد الدفعة" value={dateText(page.graceEndsAt)} />
              ) : null}
            </div>

            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-ink">اختر باقتك</h2>
              <div role="group" aria-label="مدة الاشتراك" className="flex gap-2">
                {(['monthly', 'yearly'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={cycle === c}
                    onClick={() => setCycle(c)}
                    className={cn(
                      'min-h-11 rounded-control border-2 px-4 font-semibold',
                      cycle === c
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface text-ink',
                    )}
                  >
                    {c === 'monthly' ? 'شهري' : 'سنوي (شهران مجاناً)'}
                  </button>
                ))}
              </div>
              <ul className="grid gap-4 md:grid-cols-3">
                {page.plans.map((plan) => {
                  const price = cycle === 'yearly' ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
                  return (
                    <li
                      key={plan.code}
                      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
                    >
                      <span className="text-lg font-bold text-ink">{plan.name}</span>
                      <span className="text-2xl font-bold text-ink">
                        <Money minor={price ?? 0} currency="USD" />
                        <span className="text-sm font-normal text-ink-muted">
                          {' '}
                          / {cycle === 'yearly' ? 'سنة' : 'شهر'}
                        </span>
                      </span>
                      <Button
                        variant={page.planCode === plan.code ? 'secondary' : 'primary'}
                        onClick={() => void choose(plan.code)}
                      >
                        {page.planCode === plan.code ? 'جدّد هذه الباقة' : 'اختر هذه الباقة'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {invoice ? (
              <section
                aria-label="فاتورة الاشتراك"
                className="flex flex-col gap-4 rounded-card border-2 border-brand bg-surface p-5"
              >
                <h2 className="text-lg font-bold text-ink">
                  فاتورة{' '}
                  <bdi dir="ltr" className="num">
                    {invoice.number}
                  </bdi>{' '}
                  · {invoice.planName} · {invoice.billingCycle === 'yearly' ? 'سنوي' : 'شهري'}
                </h2>
                <p className="text-ink">
                  المبلغ: <Money minor={invoice.sypMinor} currency="SYP" className="font-bold" /> أو{' '}
                  <Money minor={invoice.usdMinor} currency="USD" className="font-bold" /> · اكتب رقم الفاتورة
                  في ملاحظة التحويل.
                </p>
                {pendingFor(invoice.id) ? (
                  <Alert tone="info">أرسلت دفعة لهذه الفاتورة وهي بانتظار التأكيد.</Alert>
                ) : (
                  <>
                    <div role="group" aria-label="طريقة الدفع" className="flex flex-wrap gap-2">
                      {page.paymentMethods.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          aria-pressed={method === m.key}
                          onClick={() => setMethod(m.key)}
                          className={cn(
                            'min-h-11 rounded-control border-2 px-4 font-semibold',
                            method === m.key
                              ? 'border-brand bg-brand-soft text-brand-ink'
                              : 'border-line bg-surface text-ink',
                          )}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {chosen ? (
                      <dl className="grid gap-1 rounded-control bg-surface-muted p-4 text-sm text-ink">
                        <dt className="text-ink-muted">الحساب</dt>
                        <dd>
                          <bdi dir="ltr" className="num font-semibold">
                            {chosen.account}
                          </bdi>
                        </dd>
                        <dt className="text-ink-muted">المستفيد</dt>
                        <dd className="font-semibold">{chosen.beneficiary}</dd>
                        <dd className="mt-2">{chosen.instructions}</dd>
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
                      <div role="group" aria-label="العملة التي دفعت بها" className="flex items-end gap-2">
                        {(['SYP', 'USD'] as const).map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-pressed={currency === c}
                            onClick={() => setCurrency(c)}
                            className={cn(
                              'min-h-12 rounded-control border-2 px-4 font-semibold',
                              currency === c
                                ? 'border-brand bg-brand-soft text-brand-ink'
                                : 'border-line bg-surface text-ink',
                            )}
                          >
                            {c === 'SYP' ? 'بالليرة' : 'بالدولار'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      onClick={() => void report()}
                      loading={saving}
                      disabled={reference.trim().length < 3}
                    >
                      أرسلت المبلغ
                    </Button>
                  </>
                )}
              </section>
            ) : null}

            {page.payments.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-ink">دفعاتك</h2>
                <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
                  {page.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <bdi dir="ltr" className="num font-semibold">
                        {p.number}
                      </bdi>
                      <Money minor={p.amountMinor} currency={p.currency} />
                      <span
                        className={
                          p.status === 'rejected' ? 'font-semibold text-danger-ink' : 'text-ink-muted'
                        }
                      >
                        {PAYMENT_STATUS[p.status]}
                        {p.reason ? `: ${p.reason}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
