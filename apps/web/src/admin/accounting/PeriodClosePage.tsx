import { useCallback, useEffect, useState } from 'react';
import type { LatePostedEntry, PeriodCloseState, PeriodLockEvent, PeriodReopenInput } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CheckCircleIcon,
  DataTable,
  EmptyState,
  LockIcon,
  Money,
  Skeleton,
  TextField,
  WarningIcon,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { apiFetch, errorMessage } from '../../lib/api';
import { DayField } from '../reports/parts';
import { AccountingLayout } from './AccountingLayout';

const load = () => apiFetch<PeriodCloseState>('/v1/period-close', { auth: true });
const close = (through: string, note: string) =>
  apiFetch<PeriodCloseState>('/v1/period-close/close', {
    method: 'POST',
    body: { through, ...(note.trim() ? { note: note.trim() } : {}) },
    auth: true,
  });
const reopen = (input: PeriodReopenInput) =>
  apiFetch<PeriodCloseState>('/v1/period-close/reopen', { method: 'POST', body: input, auth: true });

/** The sources a late entry can come from, in the accountant's words */
const SOURCE: Record<string, string> = {
  sale: 'بيع',
  return: 'مرتجع',
  receipt: 'سند قبض',
  shift_close: 'إغلاق وردية',
  cash_movement: 'حركة صندوق',
  expense: 'مصروف',
  voucher: 'قسيمة',
  transfer: 'تحويل',
};

/** The last day of the month before `day` (a sensible first choice for a close), never later than `latest` */
function suggestedClose(latest: string, current: string | null): string {
  const first = `${latest.slice(0, 7)}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCDate(0);
  const end = d.toISOString().slice(0, 10);
  const pick = end > latest ? latest : end;
  return current && pick <= current ? latest : pick;
}

/**
 * «إقفال الفترة» (round 37, decision 17; design in period-close-design.md). The owner closes the books up to a
 * date: after it, a document written here with an earlier date is refused, and what an offline device sends late is
 * never lost, it is posted on the first open day and listed below for the accountant. The owner may reopen, with a
 * reason, and every close and reopen is kept in the history.
 */
export function PeriodClosePage() {
  const me = useMe();
  const held = me.user.permissions as readonly string[];
  const canClose = held.includes('period.lock');
  const canReopen = held.includes('period.unlock');
  const [state, setState] = useState<PeriodCloseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [through, setThrough] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(true);
  const [back, setBack] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    load()
      .then((s) => {
        setState(s);
        setThrough((t) => t || suggestedClose(s.latestCloseDate, s.lockedThrough));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(refresh, [refresh]);

  async function run(action: () => Promise<PeriodCloseState>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await action();
      setState(next);
      setMessage(done);
      setNote('');
      setReason('');
      setThrough(suggestedClose(next.latestCloseDate, next.lockedThrough));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const base = me.settings.baseCurrency;
  const problems = state?.checks.filter((c) => !c.ok) ?? [];

  const lateColumns: DataColumn<LatePostedEntry>[] = [
    {
      key: 'number',
      header: 'القيد',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <bdi dir="ltr" className="num font-semibold">
          {r.number}
        </bdi>
      ),
    },
    { key: 'type', header: 'النوع', cell: (r) => SOURCE[r.sourceType] ?? r.sourceType },
    {
      key: 'entry',
      header: 'تاريخ المستند',
      className: 'whitespace-nowrap',
      cell: (r) => <span className="num text-ink-muted">{r.entryDate}</span>,
    },
    {
      key: 'posting',
      header: 'رُحِّل في',
      className: 'whitespace-nowrap',
      cell: (r) => <span className="num">{r.postingDate}</span>,
    },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={base} />,
    },
  ];
  const historyColumns: DataColumn<PeriodLockEvent>[] = [
    {
      key: 'at',
      header: 'متى',
      className: 'whitespace-nowrap',
      cell: (r) => <span className="num text-ink-muted">{r.at.slice(0, 16).replace('T', ' ')}</span>,
    },
    {
      key: 'kind',
      header: 'ماذا',
      className: 'whitespace-nowrap',
      cell: (r) =>
        r.kind === 'close' ? <Badge tone="brand">إقفال</Badge> : <Badge tone="warning">فتح</Badge>,
    },
    {
      key: 'through',
      header: 'مقفلة حتى',
      className: 'whitespace-nowrap',
      cell: (r) => <span className="num">{r.lockedThrough ?? 'لا شيء مقفل'}</span>,
    },
    { key: 'by', header: 'بواسطة', cell: (r) => r.by },
    { key: 'why', header: 'السبب', cell: (r) => r.reason ?? '' },
  ];

  return (
    <AccountingLayout title="إقفال الفترة" description="أقفل الدفاتر حتى تاريخ، فلا يتغيّر رقم في شهر انتهى.">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}
      {!state ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader
              icon={<LockIcon />}
              title={state.lockedThrough ? `الدفاتر مقفلة حتى ${state.lockedThrough}` : 'لا فترة مقفلة'}
              description={
                state.lockedThrough
                  ? `مستند تكتبه هنا بتاريخ على هذا اليوم أو قبله يُرفض. وما يصل متأخراً من الأجهزة لا يضيع: يبقى بتاريخه ويُرحَّل في ${state.firstOpenDay} ويظهر في القائمة تحت.`
                  : 'كل التواريخ مفتوحة. حين تنتهي من شهر وتراجعه، أقفله من هنا.'
              }
            />
            {canClose ? (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:flex sm:flex-wrap sm:items-end">
                  <DayField
                    label="أقفل حتى تاريخ"
                    value={through}
                    max={state.latestCloseDate}
                    onChange={setThrough}
                  />
                  <TextField
                    label="ملاحظة (اختياري)"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    className="min-w-60 sm:flex-1"
                  />
                  <Button
                    icon={<LockIcon />}
                    loading={busy}
                    disabled={
                      !through ||
                      through > state.latestCloseDate ||
                      (state.lockedThrough !== null && through <= state.lockedThrough) ||
                      problems.length > 0
                    }
                    onClick={() => void run(() => close(through, note), `أُقفلت الدفاتر حتى ${through}.`)}
                  >
                    أقفل الفترة
                  </Button>
                </div>
                <p className="text-sm text-ink-muted">
                  آخر يوم يُقفل هو أمس (
                  <bdi dir="ltr" className="num">
                    {state.latestCloseDate}
                  </bdi>
                  ). الإقفال يتقدّم فقط؛ للرجوع استعمل «فتح».
                </p>
              </div>
            ) : (
              <Alert tone="info">الإقفال للمالك. تقرأ هنا الحالة والقيود المتأخرة.</Alert>
            )}
          </Card>

          <Card>
            <CardHeader
              icon={problems.length === 0 ? <CheckCircleIcon /> : <WarningIcon />}
              title="فحص السلامة قبل الإقفال"
              description="الإقفال يحتاج أن تتّفق الدفاتر مع نفسها: القيود متوازنة، والمخزون يطابق حركته وحساب المخزون."
            />
            {problems.length === 0 ? (
              <Badge tone="success">
                <CheckCircleIcon size={16} />
                كل الفحوص سليمة
              </Badge>
            ) : (
              <ul className="flex flex-col gap-2">
                {problems.map((c) => (
                  <li key={c.name}>
                    <Alert tone="warning">{c.problems[0] ?? c.name}</Alert>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {state.lockedThrough && canReopen ? (
            <Card>
              <CardHeader
                icon={<LockIcon />}
                title="فتح الفترة"
                description="للمالك وحده. السبب إلزامي ويُسجَّل في سجل التدقيق. الفتح لا يغيّر قيداً رُحِّل، يحرّك التاريخ فقط."
              />
              <div className="flex flex-col gap-4">
                <Checkbox label="افتح كل الفترات" checked={all} onChange={(e) => setAll(e.target.checked)} />
                {all ? null : (
                  <DayField
                    label="أعد الإقفال إلى"
                    value={back}
                    max={dayBeforeOf(state.lockedThrough)}
                    onChange={setBack}
                  />
                )}
                <TextField
                  label="سبب الفتح"
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 200))}
                />
                <div>
                  <Button
                    variant="secondary"
                    loading={busy}
                    disabled={reason.trim().length < 3 || (!all && !back)}
                    onClick={() =>
                      void run(
                        () => reopen({ through: all ? null : back, reason: reason.trim() }),
                        all ? 'فُتحت كل الفترات.' : `الدفاتر مقفلة الآن حتى ${back}.`,
                      )
                    }
                  >
                    افتح
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <section aria-label="قيود وصلت بعد الإقفال" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-ink">قيود وصلت بعد الإقفال</h2>
            <p className="text-sm text-ink-muted">
              مستندات من أجهزة بلا إنترنت وصلت بتاريخ فترة مقفلة. لم تُرفض: بقيت بتاريخها ورُحِّل قيدها في أول
              يوم مفتوح، فلم يتغيّر رقم في الشهر المقفل. تقرير الضريبة والمبيعات اليومية يعدّانها في يومها.
              {state.late.length > 0 ? (
                <>
                  {' '}
                  مجموعها <Money minor={state.lateTotalMinor} currency={base} />.
                </>
              ) : null}
            </p>
            <DataTable
              caption="قيود وصلت بعد الإقفال"
              columns={lateColumns}
              rows={state.late}
              rowKey={(r) => r.entryId}
              empty={
                <EmptyState
                  icon={CheckCircleIcon}
                  title="لا شيء وصل متأخراً."
                  description="ما يصل بعد الإقفال بتاريخ قديم يظهر هنا لتقرّر إن كنت تريد تسوية."
                />
              }
            />
          </section>

          <section aria-label="سجل الإقفال" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-ink">سجل الإقفال والفتح</h2>
            <DataTable
              caption="سجل الإقفال"
              columns={historyColumns}
              rows={state.history}
              rowKey={(r) => r.id}
              empty={<EmptyState icon={LockIcon} title="لم تُقفل فترة بعد." />}
            />
          </section>
        </>
      )}
    </AccountingLayout>
  );
}

function dayBeforeOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
