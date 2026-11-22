import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CUSTOMER_PAYMENT_LABEL,
  CUSTOMER_PAYMENT_METHODS,
  formatMoney,
  NOTE_STATUS_LABELS,
  stripBidiControls,
  type Permission,
  toMinor,
  type CustomerPaymentMethod,
  type PlanDetail,
  type PlanInstalment,
} from '@serva/core';
import {
  Alert,
  Button,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  Dialog,
  PrintIcon,
  Select,
  Skeleton,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { Empty } from '../customers/parts';
import { Amt, ChevRight, PageTop, Panel, SalesPage, StatusPill, SxTable, type SxColumn } from '../sales/ui';
import { PlanStatePill } from './PlansPage';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { PrintSheet, usePrint } from '../../lib/print';
import { cancelPlan, collectOnPlan, getPlan, logReminder } from './api';
import { defaultPaymentBranch, PaymentBranchField } from '../customers/PaymentBranch';
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

/** An instalment's state: filled only for what needs a look, quiet for what is fine, plain for what is ahead */
function InstalmentState({ i }: { i: PlanInstalment }) {
  if (i.state === 'late') {
    return (
      <span className="flex flex-col items-start gap-0.5">
        <StatusPill kind="danger">{STATE_TEXT.late}</StatusPill>
        <span className="cx-late">تأخر {i.daysLate} يوماً</span>
      </span>
    );
  }
  if (i.state === 'paid') {
    return (
      <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
        {STATE_TEXT.paid}
      </StatusPill>
    );
  }
  if (i.state === 'partial' || i.state === 'due_today') {
    return <StatusPill kind="warn">{STATE_TEXT[i.state]}</StatusPill>;
  }
  return <span className="sx-mute">{STATE_TEXT[i.state]}</span>;
}

/**
 * One plan: what the customer owes on it, every instalment with its day and state, the guarantor, the
 * notes, and what was paid. Collecting posts a normal customer payment and settles the oldest
 * instalments with it.
 */
export function PlanPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const base = me.settings.baseCurrency;
  const can = (p: Permission) => me.user.permissions.includes(p);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { paper, print } = usePrint();
  const [sheet, setSheet] = useState<'schedule' | 'notes'>('schedule');

  // Going from one plan to another never shows the earlier one's answer
  useEffect(() => {
    let alive = true;
    setError(null);
    setPlan((was) => (was && was.id === id ? was : null));
    getPlan(id)
      .then((p) => alive && setPlan(p))
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  const open = plan && (plan.status === 'active' || plan.status === 'defaulted');
  const next = plan?.instalments.find((i) => i.state !== 'paid' && i.state !== 'cancelled');

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
    // Only the instalments that are late or due now carry the link loud; the rest keep a quiet icon
    return link ? (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        aria-label={`واتساب القسط ${i.no}`}
        title="تذكير على واتساب"
        onClick={() => void logReminder(plan.id, i.no, kind).catch(() => undefined)}
        className="cx-icbtn"
      >
        <ChatIcon size={20} />
      </a>
    ) : null;
  };

  const columns: SxColumn<PlanInstalment>[] = [
    {
      key: 'no',
      header: 'القسط',
      lead: true,
      cell: (i) => (
        <span className="sx-n">
          {i.no}
          <span className="hidden sm:inline"> من {plan?.count}</span>
        </span>
      ),
    },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (i) => (
        <>
          <span className="sx-n">{dayText(i.dueDate, digits)}</span>
          {phone ? (
            <span className="sx-subline">
              <InstalmentState i={i} />
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      strong: true,
      cell: (i) => <Amt minor={i.amountMinor} currency={base} />,
    },
    {
      key: 'paid',
      header: 'المدفوع',
      numeric: true,
      hideBelowLg: true,
      cell: (i) => <Amt minor={i.paidMinor} currency={base} zero="dash" />,
    },
    ...(phone
      ? []
      : [
          {
            key: 'state',
            header: 'الحالة',
            cell: (i: PlanInstalment) => <InstalmentState i={i} />,
          } satisfies SxColumn<PlanInstalment>,
        ]),
    { key: 'wa', header: <span className="sr-only">تذكير</span>, cell: waCell },
  ];

  return (
    <AppShell>
      <title>خطة تقسيط · SERVA</title>
      <SalesPage>
        <Link to="/installments" className="sx-back print:hidden">
          <ChevRight /> الأقساط
        </Link>
        <PageTop
          title={plan ? `خطة ${plan.customerName}` : 'خطة تقسيط'}
          subtitle={plan ? `فاتورة ${plan.saleNumber ?? plan.number}` : undefined}
          actions={
            <>
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
              {plan && plan.status !== 'cancelled' && plan.notes.length > 0 ? (
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
            <div className="sx-card sx-strip cx3">
              <div>
                <span className="sx-eyebrow">المتبقي على الخطة</span>
                <span className="v">
                  <Amt minor={plan.remainingMinor} currency={base} />
                </span>
              </div>
              <div>
                <span className="sx-eyebrow">المدفوع</span>
                <span className="v">
                  <Amt minor={plan.paidMinor} currency={base} zero="dash" />
                </span>
              </div>
              <div>
                <span className="sx-eyebrow">القسط القادم</span>
                <span className="v">
                  {next ? <Amt minor={next.amountMinor - next.paidMinor} currency={base} /> : '—'}
                </span>
                {next ? <span className="cx-sub">{dayText(next.dueDate, digits)}</span> : null}
              </div>
            </div>
            <Panel
              title="عن الخطة"
              aside={
                <Link to={`/customers/${plan.customerId}`} className="sx-fbtn">
                  صفحة الزبون
                </Link>
              }
            >
              <dl className="cx-plan">
                <div>
                  <dt>الحالة</dt>
                  <dd>
                    <PlanStatePill plan={plan} />
                  </dd>
                </div>
                <div>
                  <dt>الدفعة الأولى</dt>
                  <dd>
                    <Amt minor={plan.downPaymentMinor} currency={base} />
                  </dd>
                </div>
                <div>
                  <dt>رسم التقسيط</dt>
                  <dd>
                    <Amt minor={plan.markupMinor} currency={base} />
                  </dd>
                </div>
                <div>
                  <dt>عدد الأقساط</dt>
                  <dd>
                    <bdi className="sx-n">{plan.count}</bdi>
                  </dd>
                </div>
              </dl>
            </Panel>
            {plan.closeReason ? <Alert tone="info">سبب الإغلاق: {plan.closeReason}</Alert> : null}
            <SxTable
              caption="الأقساط"
              columns={columns}
              rows={plan.instalments}
              rowKey={(i) => String(i.no)}
              empty={<Empty icon={<CalendarIcon size={24} />} title="لا أقساط." />}
            />
            {plan.guarantor || plan.borrower ? (
              <Panel title="الزبون والكفيل">
                <div className="cx-grid2">
                  <div className="flex flex-col gap-1">
                    <h3 className="m-0 font-semibold">الزبون</h3>
                    <span>{plan.customerName}</span>
                    {plan.customerPhone ? (
                      <bdi dir="ltr" className="sx-n sx-mute">
                        {plan.customerPhone}
                      </bdi>
                    ) : null}
                    {plan.borrower?.nationalId ? (
                      <span className="sx-mute">الرقم الوطني: {plan.borrower.nationalId}</span>
                    ) : null}
                    {plan.borrower?.address ? <span className="sx-mute">{plan.borrower.address}</span> : null}
                  </div>
                  {plan.guarantor ? (
                    <div className="flex flex-col gap-1">
                      <h3 className="m-0 font-semibold">الكفيل</h3>
                      <span>{plan.guarantor.name}</span>
                      {plan.guarantor.phone ? (
                        <bdi dir="ltr" className="sx-n sx-mute">
                          {plan.guarantor.phone}
                        </bdi>
                      ) : null}
                      {plan.guarantor.nationalId ? (
                        <span className="sx-mute">الرقم الوطني: {plan.guarantor.nationalId}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Panel>
            ) : null}
            {plan.notes.length > 0 ? (
              <NotesTable plan={plan} onChanged={setPlan} canManage={can('installments.manage')} />
            ) : null}
            {plan.payments.length > 0 ? (
              <Panel title="ما دُفع" flush>
                <ul className="cx-stm">
                  {plan.payments.map((p, i) => (
                    <li key={i}>
                      <span className="what">
                        <span className="sx-n">{dayText(p.date, digits)}</span>
                        <span className="sx-subline">
                          للقسط {p.no}
                          {p.receiptNumber ? (
                            <>
                              {' · '}
                              <bdi dir="ltr" className="sx-n">
                                {p.receiptNumber}
                              </bdi>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="end font-semibold">
                        <Amt minor={p.amountMinor} currency={base} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            {open && can('installments.manage') ? (
              <div>
                <Button variant="secondary" className="sx-neg" onClick={() => setCancelling(true)}>
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
      </SalesPage>
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
    <Panel title="الكمبيالات" flush>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="cx-stm">
        {plan.notes.map((n) => (
          <li key={n.id}>
            <span className="what">
              <bdi dir="ltr" className="sx-n">
                {n.number}
              </bdi>
              <span className="sx-subline">
                {dayText(n.dueDate, me.settings.numberFormat)}
                {n.printedCount > 0 ? ` · طُبعت ${n.printedCount}` : ''}
              </span>
            </span>
            <span className="end font-semibold">
              <Amt minor={n.amountMinor} currency={me.settings.baseCurrency} />
            </span>
            <span className="row2">
              {n.status === 'paid' ? (
                <StatusPill kind="ok" icon={<CheckIcon size={16} />}>
                  {NOTE_STATUS_LABELS[n.status]}
                </StatusPill>
              ) : n.status === 'protested' ? (
                <StatusPill kind="danger">{NOTE_STATUS_LABELS[n.status]}</StatusPill>
              ) : n.status === 'cancelled' ? (
                <span className="sx-mute">{NOTE_STATUS_LABELS[n.status]}</span>
              ) : (
                <StatusPill kind="ok">{NOTE_STATUS_LABELS[n.status]}</StatusPill>
              )}
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
            </span>
          </li>
        ))}
      </ul>
    </Panel>
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
  const [branchId, setBranchId] = useState(() => defaultPaymentBranch(me));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askOver, setAskOver] = useState(false);
  // One id per dialog: the same press sent again after a lost answer posts once
  const [requestId] = useState(() => crypto.randomUUID());

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
          id: requestId,
          amountMinor: minor,
          method,
          reference: reference.trim() || null,
          note: note.trim() || null,
          ...(branchId ? { branchId } : {}),
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
        <PaymentBranchField me={me} value={branchId} onChange={setBranchId} />
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
