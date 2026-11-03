import { useEffect, useMemo, useState } from 'react';
import type { Approval, RefundMethod, ReturnPayload } from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import { buildReturnPayload, defaultRefundMethod, returnableLines } from '@serva/core/sale-return';
import type { OutboxEntry, SyncDocument } from '@serva/sync';
import {
  BackIcon,
  Button,
  cn,
  EmptyState,
  formatQuantity,
  Money,
  PrintIcon,
  TextField,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { clockText, dateText } from '../format';
import { usePos } from '../services';
import { deviceDocuments, type OpenShift } from '../shift/shift';
import { ManagerCode } from '../staff/ManagerCode';
import type { StaffMember, StaffSession } from '../staff/staff';
import { matchesNumber, RETURN_WINDOW_DAYS, returnableSales, type ReturnableSale } from './returns';

const REASONS = ['تالف أو منتهي الصلاحية', 'الزبون غيّر رأيه', 'خطأ في الفاتورة'] as const;

const REFUND_TEXT: Record<RefundMethod, string> = {
  cash: 'نقداً من الدرج',
  card: 'إلى البطاقة',
  wallet: 'إلى شام كاش',
  transfer: 'بتحويل',
};

export type SavedReturn = Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;

/**
 * «مرتجع» (08 › مرتجع مبيعات): the cashier finds an invoice of this till from the last week, picks
 * what comes back, the reason and how the money goes back, and saves a return (SRT) that names the
 * invoice. The amounts are the invoice's own (buildReturnPayload), never retyped. A cashier without
 * «المرتجعات» needs a manager's code.
 */
export function ReturnScreen({
  session,
  catalog,
  staff,
  shift,
  onBack,
  onPrint,
}: {
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shift: OpenShift;
  onBack: () => void;
  onPrint: (saved: SavedReturn) => void;
}) {
  const pos = usePos();
  const digits = useDigits();
  const settings = catalog.settings!;
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<ReturnableSale | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [otherReason, setOtherReason] = useState('');
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [reference, setReference] = useState('');
  const [approving, setApproving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReturn | null>(null);

  useEffect(() => {
    let alive = true;
    void deviceDocuments(pos.store).then((list) => alive && setEntries(list));
    return () => {
      alive = false;
    };
  }, [pos.store, tick]);

  const sales = useMemo(() => (entries ? returnableSales(entries, pos.now()) : []), [entries, pos]);
  const shown = sales.filter((s) => matchesNumber(s.number, search)).slice(0, 30);

  // The picked invoice as it is now (a return saved here a moment ago counts)
  const current = picked ? (sales.find((s) => s.id === picked.id) ?? picked) : null;
  const lines = current ? returnableLines(current.sale, current.returned) : [];
  const picks = Object.entries(qty)
    .map(([lineNo, q]) => ({ saleLineNo: Number(lineNo), qty: q }))
    .filter((p) => p.qty > 0);
  const why = reason === 'other' ? otherReason.trim() : reason;
  const needsReference = method !== 'cash';

  const draft = useMemo((): ReturnPayload | null => {
    if (!current || picks.length === 0) return null;
    try {
      return buildReturnPayload({
        sale: current.sale,
        saleId: current.id,
        saleNumber: current.number,
        shiftId: shift.id,
        cashierId: session.userId,
        reason: why || '—',
        picks,
        returned: current.returned,
        refundMethod: method,
        reference: reference.trim() || null,
      });
    } catch {
      return null;
    }
  }, [current, picks, shift.id, session.userId, why, method, reference]);

  const ready = draft !== null && why.length > 0 && (!needsReference || reference.trim().length > 0);
  const canRefund = session.permissions.has('sale.refund');

  function choose(sale: ReturnableSale) {
    setPicked(sale);
    setQty({});
    setMethod(defaultRefundMethod(sale.sale));
    setReference('');
    setError(null);
    setSaved(null);
  }

  async function record(approval: Approval | null) {
    if (!draft || !current) return;
    setApproving(false);
    setSaving(true);
    setError(null);
    try {
      const entry = await pos.save({
        type: 'return',
        payload: { ...draft, reason: why, approval } as unknown as Record<string, unknown>,
        deps: [current.id],
        businessDate: businessDateOf(pos.now(), settings.timezone, settings.businessDayCutoff),
        engineVersion: PRICING_ENGINE_VERSION,
      });
      const doc: SavedReturn = {
        id: entry.doc.id,
        number: entry.doc.number,
        deviceTime: entry.doc.deviceTime,
        payload: entry.doc.payload,
      };
      setSaved(doc);
      setQty({});
      setTick((t) => t + 1);
      onPrint(doc);
    } catch {
      setError('لم يُسجَّل المرتجع. لم يُحفظ شيء، حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-6xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="secondary" icon={<BackIcon />} onClick={onBack}>
          ارجع للبيع
        </Button>
        <div className="flex flex-col">
          <h1 className="text-3xl font-bold text-ink">مرتجع</h1>
          <p className="text-ink-muted">
            اختر فاتورة من هذا الجهاز خلال آخر {RETURN_WINDOW_DAYS} أيام، ثم ما يرجع منها. المبلغ من الفاتورة
            نفسها.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-6">
        <section
          aria-label="الفواتير"
          className="flex flex-col gap-3 self-start rounded-card border border-line bg-surface p-4"
        >
          <TextField
            label="رقم الفاتورة"
            hint="آخر أرقامها تكفي"
            inputMode="numeric"
            dir="ltr"
            value={search}
            onChange={(e) => setSearch(e.target.value.slice(0, 40))}
          />
          {entries && shown.length === 0 ? (
            <p className="py-4 text-center text-ink-muted">لا فواتير على هذا الجهاز تطابق البحث.</p>
          ) : null}
          <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
            {shown.map((s) => {
              const at = Date.parse(s.deviceTime);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={current?.id === s.id}
                    onClick={() => choose(s)}
                    className={cn(
                      'flex min-h-14 w-full items-center justify-between gap-2 rounded-control border-2 px-3 text-start',
                      current?.id === s.id
                        ? 'border-brand bg-brand-soft'
                        : 'border-transparent hover:bg-surface-muted',
                    )}
                  >
                    <span className="flex flex-col">
                      <bdi dir="ltr" className="num font-semibold">
                        {s.number}
                      </bdi>
                      <span className="text-xs text-ink-muted">
                        {dateText(at, digits)} ، {clockText(at, digits)}
                        {s.returned.length > 0 ? ' · رجع منها شيء' : ''}
                      </span>
                    </span>
                    <Money
                      minor={s.sale.totals.totalMinor}
                      currency={s.sale.currency}
                      className="font-bold"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        {!current ? (
          <EmptyState
            icon={UndoIcon}
            title="اختر فاتورة"
            description="تظهر أصنافها هنا مع الكمية التي ما زالت ترجع."
          />
        ) : saved ? (
          <section
            aria-label="سُجّل المرتجع"
            className="flex flex-col items-start gap-4 rounded-card border border-line bg-surface p-6"
          >
            <h2 className="text-2xl font-bold text-ink">سُجّل المرتجع</h2>
            <p className="text-ink">
              <bdi dir="ltr" className="num font-semibold">
                {saved.number}
              </bdi>{' '}
              · رُدّ{' '}
              <Money
                minor={(saved.payload as unknown as ReturnPayload).totals.totalMinor}
                currency={(saved.payload as unknown as ReturnPayload).currency}
                className="font-bold"
              />{' '}
              {REFUND_TEXT[(saved.payload as unknown as ReturnPayload).refunds[0]?.method ?? 'cash']}
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
                اطبع الإيصال مرة أخرى
              </Button>
              <Button onClick={() => setSaved(null)}>مرتجع آخر من نفس الفاتورة</Button>
              <Button variant="secondary" onClick={onBack}>
                ارجع للبيع
              </Button>
            </div>
          </section>
        ) : (
          <section
            aria-label="ما يرجع"
            className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
          >
            <h2 className="text-xl font-bold text-ink">
              الفاتورة{' '}
              <bdi dir="ltr" className="num">
                {current.number}
              </bdi>
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {lines.map((line) => {
                const q = qty[line.saleLineNo] ?? 0;
                const set = (next: number) =>
                  setQty((all) => ({
                    ...all,
                    [line.saleLineNo]: Math.max(0, Math.min(line.remainingQty, next)),
                  }));
                return (
                  <li key={line.saleLineNo} className="flex items-center justify-between gap-3 py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold text-ink">{line.name}</span>
                      <span className="text-sm text-ink-muted">
                        بيع {formatQuantity(line.soldQty, digits)}
                        {line.returnedQty > 0 ? ` · رجع ${formatQuantity(line.returnedQty, digits)}` : ''}
                      </span>
                    </span>
                    {line.remainingQty === 0 ? (
                      <span className="text-sm text-ink-muted">رجع كله</span>
                    ) : (
                      <span className="flex items-center gap-2" role="group" aria-label={`كمية ${line.name}`}>
                        <Button
                          variant="secondary"
                          aria-label={`أنقص ${line.name}`}
                          onClick={() => set(q - 1000)}
                          disabled={q === 0}
                        >
                          −
                        </Button>
                        <output className="num min-w-12 text-center text-lg font-bold" aria-live="polite">
                          {formatQuantity(q, digits)}
                        </output>
                        <Button
                          variant="secondary"
                          aria-label={`زد ${line.name}`}
                          onClick={() => set(q + 1000 > line.remainingQty ? line.remainingQty : q + 1000)}
                          disabled={q >= line.remainingQty}
                        >
                          +
                        </Button>
                        <Button variant="ghost" onClick={() => set(line.remainingQty)}>
                          الكل
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div role="group" aria-label="السبب" className="flex flex-wrap gap-2">
              {[...REASONS, 'other' as const].map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={cn(
                    'min-h-11 rounded-full border-2 px-4 font-semibold',
                    reason === r
                      ? 'border-brand bg-brand-soft text-brand-ink'
                      : 'border-line bg-surface text-ink',
                  )}
                >
                  {r === 'other' ? 'سبب آخر' : r}
                </button>
              ))}
            </div>
            {reason === 'other' ? (
              <TextField
                label="السبب"
                value={otherReason}
                onChange={(e) => setOtherReason(e.target.value.slice(0, 200))}
              />
            ) : null}
            <div role="group" aria-label="طريقة الرد" className="flex flex-wrap gap-2">
              {(['cash', ...new Set(current.sale.payments.map((p) => p.method))] as const)
                .filter((m, i, all): m is RefundMethod => m !== 'credit' && all.indexOf(m) === i)
                .map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={method === m}
                    onClick={() => setMethod(m)}
                    className={cn(
                      'min-h-11 rounded-control border-2 px-4 font-semibold',
                      method === m
                        ? 'border-brand bg-brand-soft text-brand-ink'
                        : 'border-line bg-surface text-ink',
                    )}
                  >
                    {REFUND_TEXT[m]}
                  </button>
                ))}
            </div>
            {needsReference ? (
              <TextField
                label="رقم العملية"
                hint="من جهاز البطاقة أو من التطبيق"
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value.slice(0, 64))}
              />
            ) : null}
            <div
              role="status"
              aria-label="المبلغ المردود"
              className="flex items-center justify-between rounded-card bg-surface-total p-4"
            >
              <span className="font-semibold text-ink-muted">المبلغ المردود</span>
              <Money
                minor={draft?.totals.totalMinor ?? 0}
                currency={current.sale.currency}
                className="text-3xl font-bold text-ink"
              />
            </div>
            {error ? (
              <p role="alert" className="font-semibold text-danger-ink">
                {error}
              </p>
            ) : null}
            {approving ? (
              <ManagerCode
                staff={staff}
                permission="sale.refund"
                reason="المرتجع يُخرج مالاً، فيحتاج رمز مدير حاضر. يُسجَّل باسمه."
                onApproved={(approval) => void record(approval)}
                onCancel={() => setApproving(false)}
              />
            ) : (
              <Button
                size="lg"
                disabled={!ready || saving}
                onClick={() => (canRefund ? void record(null) : setApproving(true))}
              >
                سجّل المرتجع
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
