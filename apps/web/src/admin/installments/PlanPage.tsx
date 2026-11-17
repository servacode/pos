import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CUSTOMER_PAYMENT_LABEL,
  CUSTOMER_PAYMENT_METHODS,
  formatMoney,
  NOTE_STATUS_LABELS,
  PLAN_STATUS_LABELS,
  stripBidiControls,
  type Permission,
  toMinor,
  type CustomerPaymentMethod,
  type PlanDetail,
  type PlanInstalment,
  type PlanStatus,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  CalendarIcon,
  ChatIcon,
  DataTable,
  Dialog,
  EmptyState,
  KpiStrip,
  Money,
  PageHeader,
  PrintIcon,
  Select,
  Skeleton,
  StatTile,
  TextField,
  type BadgeTone,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { cancelPlan, collectOnPlan, getPlan, logReminder } from './api';
import { NotesSheet, ScheduleSheet } from './sheets';
import { reminderLink } from './whatsapp';

const STATE_TEXT: Record<PlanInstalment['state'], string> = {
  paid: 'مسدّد',
  partial: 'جزئي',
  due_today: 'مستحق اليوم',
  late: 'متأخر',
  upcoming: 'قادم',
  cancelled: 'ملغى',
};
const STATE_TONE: Record<PlanInstalment['state'], BadgeTone> = {
  paid: 'success',
  partial: 'warning',
  due_today: 'warning',
  late: 'danger',
  upcoming: 'neutral',
  cancelled: 'neutral',
};
const PLAN_TONE: Record<PlanStatus, BadgeTone> = {
  active: 'brand',
  completed: 'success',
  cancelled: 'neutral',
  defaulted: 'danger',
};

/**
 * One plan: what the customer owes on it, every instalment with its day and state, the guarantor, the
 * notes, and what was paid. Collecting posts a normal customer payment and settles the oldest
 * instalments with it.
 */
export function PlanPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const digits = me.settings.numberFormat;
  const base = me.settings.baseCurrency;
  const can = (p: Permission) => me.user.permissions.includes(p);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { paper, print } = usePrint();
  const [sheet, setSheet] = useState<'schedule' | 'notes'>('schedule');

  const load = useCallback(() => {
    setError(null);
    getPlan(id)
      .then(setPlan)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);

  const open = plan && (plan.status === 'active' || plan.status === 'defaulted');
  const next = plan?.instalments.find((i) => i.state !== 'paid' && i.state !== 'cancelled');

  const stateCell = (i: PlanInstalment) => (
    <span className="flex flex-col items-start gap-0.5">
      <Badge tone={STATE_TONE[i.state]}>{STATE_TEXT[i.state]}</Badge>
      {i.state === 'late' ? <span className="text-xs text-danger-ink">تأخر {i.daysLate} يوماً</span> : null}
    </span>
  );
  const waCell = (i: PlanInstalment) => {
    if (!plan || !open || !['late', 'due_today', 'upcoming', 'partial'].includes(i.state)) return null;
    const kind = i.state === 'late' ? 'late' : i.state === 'due_today' ? 'due' : 'before';
    const link = reminderLink(plan.customerPhone, {
      kind,
      name: plan.customerName,
      amountMinor: i.amountMinor - i.paidMinor,
      currency: base,
      due: i.dueDate,
      no: i.no,
      of: plan.count,
      store: plan.storeName,
      daysLate: i.daysLate,
    });
    return link ? (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        onClick={() => void logReminder(plan.id, i.no, kind).catch(() => undefined)}
        className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-brand-ink hover:underline"
      >
        <ChatIcon size={16} /> واتساب
      </a>
    ) : null;
  };

  // On a phone the due day's cell carries the state and the WhatsApp link, so the amount stays in view
  const columns: DataColumn<PlanInstalment>[] = [
    {
      key: 'no',
      header: 'القسط',
      className: 'whitespace-nowrap',
      cell: (i) => (
        <span className="num font-semibold">
          {i.no}
          <span className="hidden sm:inline"> من {plan?.count}</span>
        </span>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (i) => (
        <span className="flex flex-col items-start gap-1 py-1">
          <span className="whitespace-nowrap">{dayText(i.dueDate, digits)}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden">
            {stateCell(i)}
            {waCell(i)}
          </span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (i) => <Money minor={i.amountMinor} currency={base} />,
    },
    {
      key: 'paid',
      header: 'المدفوع',
      numeric: true,
      className: 'hidden sm:table-cell',
      cell: (i) => (i.paidMinor > 0 ? <Money minor={i.paidMinor} currency={base} /> : <span>—</span>),
    },
    { key: 'state', header: 'الحالة', className: 'hidden sm:table-cell', cell: stateCell },
    { key: 'wa', header: '', className: 'hidden sm:table-cell', cell: waCell },
  ];

  return (
    <AppShell>
      <title>خطة تقسيط · SERFA</title>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          title={plan ? `خطة ${plan.customerName}` : 'خطة تقسيط'}
          description={plan ? `فاتورة ${plan.saleNumber ?? plan.number}` : undefined}
          actions={
            <>
              <Link to="/installments">
                <Button variant="secondary">كل الخطط</Button>
              </Link>
              {plan ? (
                <Button
                  variant="secondary"
                  icon={<PrintIcon />}
                  onClick={() => {
                    setSheet('schedule');
                    print('A4');
                  }}
                >
                  اطبع الجدول
                </Button>
              ) : null}
              {plan && plan.notes.length > 0 ? (
                <Button
                  variant="secondary"
                  icon={<PrintIcon />}
                  onClick={() => {
                    setSheet('notes');
                    print('A4');
                    void apiFetch(`/v1/installment-plans/${plan.id}/notes-printed`, {
                      method: 'POST',
                      body: {},
                      auth: true,
                    }).catch(() => undefined);
                  }}
                >
                  اطبع الكمبيالات
                </Button>
              ) : null}
              {open && can('receipt.create') ? (
                <Button icon={<CalendarIcon />} onClick={() => setCollecting(true)}>
                  قبض قسط
                </Button>
              ) : null}
            </>
          }
        />
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : !plan ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <KpiStrip columns={3}>
              <StatTile
                label="المتبقي على الخطة"
                value={<Money minor={plan.remainingMinor} currency={base} />}
              />
              <StatTile label="المدفوع" value={<Money minor={plan.paidMinor} currency={base} />} />
              <StatTile
                label="القسط القادم"
                value={next ? <Money minor={next.amountMinor - next.paidMinor} currency={base} /> : '—'}
                footnote={next ? dayText(next.dueDate, digits) : undefined}
              />
            </KpiStrip>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PLAN_TONE[plan.status]}>{PLAN_STATUS_LABELS[plan.status]}</Badge>
              {plan.lateCount > 0 ? <Badge tone="danger">{plan.lateCount} متأخر</Badge> : null}
              <span className="text-sm text-ink-muted">
                الدفعة الأولى <Money minor={plan.downPaymentMinor} currency={base} /> · رسم التقسيط{' '}
                <Money minor={plan.markupMinor} currency={base} /> · عدد الأقساط{' '}
                <bdi className="num">{plan.count}</bdi>
              </span>
              <Link to={`/customers/${plan.customerId}`} className="text-sm font-semibold hover:underline">
                صفحة الزبون
              </Link>
            </div>
            {plan.closeReason ? <Alert tone="info">سبب الإغلاق: {plan.closeReason}</Alert> : null}
            <DataTable
              caption="الأقساط"
              columns={columns}
              rows={plan.instalments}
              rowKey={(i) => i.no}
              empty={<EmptyState icon={CalendarIcon} title="لا أقساط." />}
            />
            {plan.guarantor || plan.borrower ? (
              <section className="grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <h2 className="font-semibold">الزبون</h2>
                  <span>{plan.customerName}</span>
                  {plan.customerPhone ? (
                    <bdi dir="ltr" className="num text-sm text-ink-muted">
                      {plan.customerPhone}
                    </bdi>
                  ) : null}
                  {plan.borrower?.nationalId ? (
                    <span className="text-sm text-ink-muted">الرقم الوطني: {plan.borrower.nationalId}</span>
                  ) : null}
                  {plan.borrower?.address ? (
                    <span className="text-sm text-ink-muted">{plan.borrower.address}</span>
                  ) : null}
                </div>
                {plan.guarantor ? (
                  <div className="flex flex-col gap-1">
                    <h2 className="font-semibold">الكفيل</h2>
                    <span>{plan.guarantor.name}</span>
                    {plan.guarantor.phone ? (
                      <bdi dir="ltr" className="num text-sm text-ink-muted">
                        {plan.guarantor.phone}
                      </bdi>
                    ) : null}
                    {plan.guarantor.nationalId ? (
                      <span className="text-sm text-ink-muted">
                        الرقم الوطني: {plan.guarantor.nationalId}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            {plan.notes.length > 0 ? (
              <NotesTable plan={plan} onChanged={setPlan} canManage={can('installments.manage')} />
            ) : null}
            {plan.payments.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="font-semibold">ما دُفع</h2>
                <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
                  {plan.payments.map((p, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                      <span className="whitespace-nowrap">{dayText(p.date, digits)}</span>
                      <span className="text-sm text-ink-muted">للقسط {p.no}</span>
                      {p.receiptNumber ? (
                        <bdi dir="ltr" className="num text-xs text-ink-muted">
                          {p.receiptNumber}
                        </bdi>
                      ) : null}
                      <span className="flex-1" />
                      <Money minor={p.amountMinor} currency={base} className="font-semibold" />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {open && can('installments.manage') ? (
              <div>
                <Button variant="ghost" onClick={() => setCancelling(true)}>
                  ألغِ الخطة
                </Button>
              </div>
            ) : null}
            {collecting ? (
              <CollectDialog
                plan={plan}
                onClose={() => setCollecting(false)}
                onDone={(p) => {
                  setPlan(p);
                  setCollecting(false);
                }}
              />
            ) : null}
            {cancelling ? (
              <CancelDialog
                plan={plan}
                onClose={() => setCancelling(false)}
                onDone={(p) => {
                  setPlan(p);
                  setCancelling(false);
                }}
              />
            ) : null}
            {paper ? (
              <PrintSheet paper={paper}>
                {sheet === 'notes' ? (
                  <NotesSheet plan={plan} currency={base} />
                ) : (
                  <ScheduleSheet plan={plan} currency={base} />
                )}
              </PrintSheet>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

function NotesTable({
  plan,
  onChanged,
  canManage,
}: {
  plan: PlanDetail;
  onChanged: (p: PlanDetail) => void;
  canManage: boolean;
}) {
  const me = useMe();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(id: string, action: 'paid' | 'protested' | 'cancelled') {
    setBusy(id);
    setError(null);
    try {
      onChanged(
        await apiFetch<PlanDetail>(`/v1/promissory-notes/${id}/action`, {
          method: 'POST',
          body: { action },
          auth: true,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">الكمبيالات</h2>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {plan.notes.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <bdi dir="ltr" className="num text-sm font-semibold">
              {n.number}
            </bdi>
            <span className="whitespace-nowrap text-sm text-ink-muted">
              {dayText(n.dueDate, me.settings.numberFormat)}
            </span>
            <Badge
              tone={
                n.status === 'paid'
                  ? 'success'
                  : n.status === 'protested'
                    ? 'danger'
                    : n.status === 'cancelled'
                      ? 'neutral'
                      : 'brand'
              }
            >
              {NOTE_STATUS_LABELS[n.status]}
            </Badge>
            {n.printedCount > 0 ? (
              <span className="text-xs text-ink-subtle">طُبعت {n.printedCount}</span>
            ) : null}
            <span className="flex-1" />
            <Money minor={n.amountMinor} currency={me.settings.baseCurrency} />
            {canManage && n.status === 'issued' ? (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === n.id}
                  onClick={() => void act(n.id, 'paid')}
                >
                  أُعيدت للزبون
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === n.id}
                  onClick={() => void act(n.id, 'protested')}
                >
                  احتجاج
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CollectDialog({
  plan,
  onClose,
  onDone,
}: {
  plan: PlanDetail;
  onClose: () => void;
  onDone: (p: PlanDetail) => void;
}) {
  const me = useMe();
  const base = me.settings.baseCurrency;
  const next = plan.instalments.find((i) => i.state !== 'paid' && i.state !== 'cancelled');
  const [amount, setAmount] = useState(next ? String((next.amountMinor - next.paidMinor) / 100) : '');
  const [method, setMethod] = useState<CustomerPaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askOver, setAskOver] = useState(false);

  let minor: number | null = null;
  try {
    minor = amount.trim() ? toMinor(amount, base) : null;
  } catch {
    minor = null;
  }
  const ready = minor !== null && minor > 0 && (method === 'cash' || reference.trim() !== '');

  async function submit() {
    if (!ready || minor === null) return;
    if (minor > plan.remainingMinor && !askOver) {
      setAskOver(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onDone(
        await collectOnPlan(plan.id, {
          amountMinor: minor,
          method,
          reference: reference.trim() || null,
          note: note.trim() || null,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`قبض قسط من ${plan.customerName}`}
      description="يُسجَّل كدفعة من الزبون، ويُسدَّد بها أقدم قسط ثم الذي يليه."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label={`المبلغ (${base === 'SYP' ? 'ل.س' : base})`}
          inputMode="decimal"
          dir="ltr"
          autoFocus
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setAskOver(false);
          }}
          error={amount.trim() && minor === null ? 'مبلغ غير صالح' : undefined}
        />
        {askOver ? (
          <Alert tone="warning">
            المبلغ أكبر من المستحق ({stripBidiControls(formatMoney(plan.remainingMinor, base))}). الباقي يصير
            رصيداً للزبون؟
          </Alert>
        ) : null}
        <Select
          label="طريقة الدفع"
          value={method}
          onChange={(e) => setMethod(e.target.value as CustomerPaymentMethod)}
        >
          {CUSTOMER_PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {CUSTOMER_PAYMENT_LABEL[m]}
            </option>
          ))}
        </Select>
        {method !== 'cash' ? (
          <TextField
            label="رقم الحوالة أو العملية"
            dir="ltr"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={64}
          />
        ) : null}
        <TextField
          label="ملاحظة"
          hint="اختياري"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving} disabled={!ready}>
            {askOver ? 'نعم، سجّل والباقي رصيد' : 'سجّل القبض'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function CancelDialog({
  plan,
  onClose,
  onDone,
}: {
  plan: PlanDetail;
  onClose: () => void;
  onDone: (p: PlanDetail) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setSaving(true);
    setError(null);
    try {
      onDone(await cancelPlan(plan.id, reason.trim()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="إلغاء خطة التقسيط"
      description="تُلغى الأقساط التي لم تُدفع بعد، وتُلغى الكمبيالات القائمة. ما دفعه الزبون يبقى في حسابه، وأي استرجاع يتم من المرتجعات أو من القبض."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) void submit();
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <TextField
          label="السبب"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          autoFocus
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            تراجع
          </Button>
          <Button type="submit" loading={saving} disabled={!reason.trim()}>
            ألغِ الخطة
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
