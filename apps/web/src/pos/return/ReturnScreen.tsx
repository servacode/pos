import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  REFUND_METHODS,
  type Approval,
  type RefundMethod,
  type ReturnPayload,
} from '@serva/core/contracts/documents';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { businessDateOf } from '@serva/core/sale';
import { buildReturnPayload, defaultRefundMethod, returnableLines } from '@serva/core/sale-return';
import type { OutboxEntry, SyncDocument } from '@serva/sync';
import {
  AddIcon,
  Alert,
  Badge,
  Button,
  CardIcon,
  CashIcon,
  cn,
  EmptyState,
  formatQuantity,
  IconChip,
  Money,
  OfferIcon,
  PhoneIcon,
  PrintIcon,
  RemoveIcon,
  SearchIcon,
  SalesIcon,
  Skeleton,
  TextField,
  TransferIcon,
  UndoIcon,
  useDigits,
} from '@serva/ui';
import type { Catalog } from '../catalog';
import { clockText, dateText } from '../format';
import { ChoiceGroup, DoneCard, FlowHeader, OptionChip, OptionTile } from '../FlowParts';
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
  voucher: 'على قسيمة استبدال',
};

const REFUND_ICON: Record<RefundMethod, ReactNode> = {
  cash: <CashIcon />,
  card: <CardIcon />,
  wallet: <PhoneIcon />,
  transfer: <TransferIcon />,
  voucher: <OfferIcon />,
};

/** A − or + of the quantity stepper: 48 square, like the cart's (هوية 4 › الكاشير). */
const STEP =
  'grid size-12 place-items-center text-ink-muted transition-colors duration-120 ease-standard enabled:hover:bg-surface-muted enabled:hover:text-ink enabled:active:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40';

export type SavedReturn = Pick<SyncDocument, 'id' | 'number' | 'deviceTime' | 'payload'>;

const savedRefund = (saved: SavedReturn): RefundMethod =>
  (saved.payload as unknown as ReturnPayload).refunds[0]?.method ?? 'cash';

/**
 * «مرتجع» (08 › مرتجع مبيعات): the cashier finds an invoice of this till from the last week, picks
 * what comes back, the reason and how the money goes back, and saves a return (SRT) that names the
 * invoice. The amounts are the invoice's own (buildReturnPayload), never retyped. A cashier without
 * «المرتجعات» needs a manager's code.
 *
 * An exchange (03 › الملابس: الاستبدال) is a return on «قسيمة استبدال»: no money leaves the drawer,
 * the receipt carries the voucher, and «بيع البديل» goes back to the sale with it at payment.
 */
export function ReturnScreen({
  session,
  catalog,
  staff,
  shift,
  onBack,
  onPrint,
  onExchange,
}: {
  session: StaffSession;
  catalog: Catalog;
  staff: readonly StaffMember[];
  shift: OpenShift;
  onBack: () => void;
  onPrint: (saved: SavedReturn) => void;
  /** Back to the sale with the voucher just issued, to sell the other piece */
  onExchange?: (voucherCode: string) => void;
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
  const needsReference = method !== 'cash' && method !== 'voucher';

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

  const refundMethods = current
    ? ['cash', ...current.sale.payments.map((p) => p.method), 'voucher'].filter(
        (m, i, all): m is RefundMethod =>
          (REFUND_METHODS as readonly string[]).includes(m) && all.indexOf(m) === i,
      )
    : [];

  return (
    <div className="flex w-full max-w-7xl flex-col gap-6">
      <FlowHeader
        onBack={onBack}
        icon={<UndoIcon size={24} />}
        title="مرتجع"
        description={`اختر فاتورة من هذا الجهاز خلال آخر ${RETURN_WINDOW_DAYS} أيام، ثم ما يرجع منها. المبلغ من الفاتورة نفسها.`}
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section
          aria-label="الفواتير"
          className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-e1 lg:sticky lg:top-0"
        >
          <TextField
            label="رقم الفاتورة"
            hint="آخر أرقامها تكفي"
            inputMode="numeric"
            dir="ltr"
            value={search}
            onChange={(e) => setSearch(e.target.value.slice(0, 40))}
            inputClassName="num"
            startAdornment={<SearchIcon className="ms-4 shrink-0" />}
          />
          {entries === null ? (
            <div aria-hidden="true" className="flex flex-col gap-2 py-1">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-control" />
              ))}
            </div>
          ) : null}
          {entries && shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">لا فواتير على هذا الجهاز تطابق البحث.</p>
          ) : null}
          <ul className="-mx-1 flex max-h-[28rem] flex-col gap-1 overflow-y-auto px-1 py-0.5">
            {shown.map((s) => {
              const at = Date.parse(s.deviceTime);
              const selected = current?.id === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choose(s)}
                    className={cn(
                      'flex min-h-14 w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-start transition-colors duration-120 ease-standard',
                      selected
                        ? 'border-brand bg-brand-soft/60 ring-4 ring-brand/10'
                        : 'border-transparent hover:bg-surface-muted',
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <bdi dir="ltr" className="num truncate font-semibold text-ink">
                        {s.number}
                      </bdi>
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                        <span className="num">
                          {dateText(at, digits)} ، {clockText(at, digits)}
                        </span>
                        {s.returned.length > 0 ? (
                          <span className="text-warning-ink">· رجع منها شيء</span>
                        ) : (
                          ''
                        )}
                      </span>
                    </span>
                    <Money
                      minor={s.sale.totals.totalMinor}
                      currency={s.sale.currency}
                      className="shrink-0 font-bold text-ink"
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
            className="min-h-80 justify-center"
          />
        ) : saved ? (
          <DoneCard
            label="سُجّل المرتجع"
            title="سُجّل المرتجع"
            actions={
              <>
                {savedRefund(saved) === 'voucher' && onExchange && saved.number ? (
                  <Button onClick={() => onExchange(saved.number!)}>بيع البديل بالقسيمة</Button>
                ) : null}
                <Button variant="secondary" icon={<PrintIcon />} onClick={() => onPrint(saved)}>
                  اطبع الإيصال مرة أخرى
                </Button>
                <Button variant="secondary" onClick={() => setSaved(null)}>
                  مرتجع آخر من نفس الفاتورة
                </Button>
                <Button variant="ghost" onClick={onBack}>
                  ارجع للبيع
                </Button>
              </>
            }
          >
            <p className="text-lg text-ink">
              <bdi dir="ltr" className="num font-semibold">
                {saved.number}
              </bdi>{' '}
              · رُدّ{' '}
              <Money
                minor={(saved.payload as unknown as ReturnPayload).totals.totalMinor}
                currency={(saved.payload as unknown as ReturnPayload).currency}
                className="font-bold"
              />{' '}
              {REFUND_TEXT[savedRefund(saved)]}
            </p>
            {savedRefund(saved) === 'voucher' ? (
              <p className="max-w-md text-ink-muted">
                القسيمة برقم المرتجع، مطبوعة على الإيصال. تُصرف على أي جهاز في المحل.
              </p>
            ) : null}
          </DoneCard>
        ) : (
          <section
            aria-label="ما يرجع"
            className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
          >
            <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e1">
              <div className="flex flex-wrap items-center gap-3">
                <IconChip>
                  <SalesIcon />
                </IconChip>
                <h2 className="min-w-0 flex-1 text-lg font-semibold wrap-anywhere text-ink">
                  الفاتورة{' '}
                  <bdi dir="ltr" className="num">
                    {current.number}
                  </bdi>
                </h2>
                <Money
                  minor={current.sale.totals.totalMinor}
                  currency={current.sale.currency}
                  className="text-sm font-semibold text-ink-muted"
                />
              </div>
              <ul className="flex flex-col divide-y divide-line border-t border-line">
                {lines.map((line) => {
                  const q = qty[line.saleLineNo] ?? 0;
                  const set = (next: number) =>
                    setQty((all) => ({
                      ...all,
                      [line.saleLineNo]: Math.max(0, Math.min(line.remainingQty, next)),
                    }));
                  return (
                    <li
                      key={line.saleLineNo}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <span className="flex min-w-40 flex-1 flex-col gap-0.5">
                        <span className="font-semibold text-ink">{line.name}</span>
                        <span className="num text-sm text-ink-muted">
                          بيع {formatQuantity(line.soldQty, digits)}
                          {line.returnedQty > 0 ? ` · رجع ${formatQuantity(line.returnedQty, digits)}` : ''}
                        </span>
                      </span>
                      {line.remainingQty === 0 ? (
                        <Badge>رجع كله</Badge>
                      ) : (
                        <span
                          className="flex items-center gap-2"
                          role="group"
                          aria-label={`كمية ${line.name}`}
                        >
                          <span className="inline-flex items-stretch overflow-hidden rounded-control border border-line-control/50 bg-surface shadow-e1">
                            <button
                              type="button"
                              aria-label={`أنقص ${line.name}`}
                              onClick={() => set(q - 1000)}
                              disabled={q === 0}
                              className={STEP}
                            >
                              <RemoveIcon />
                            </button>
                            <output
                              className={cn(
                                'num grid min-w-14 place-items-center border-x border-line px-2 text-lg font-bold',
                                q > 0 ? 'text-brand-ink' : 'text-ink',
                              )}
                              aria-live="polite"
                            >
                              {formatQuantity(q, digits)}
                            </output>
                            <button
                              type="button"
                              aria-label={`زد ${line.name}`}
                              onClick={() => set(q + 1000 > line.remainingQty ? line.remainingQty : q + 1000)}
                              disabled={q >= line.remainingQty}
                              className={STEP}
                            >
                              <AddIcon />
                            </button>
                          </span>
                          <Button variant="ghost" onClick={() => set(line.remainingQty)}>
                            الكل
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <ChoiceGroup label="السبب" className="flex flex-wrap gap-2">
                {[...REASONS, 'other' as const].map((r) => (
                  <OptionChip key={r} selected={reason === r} onClick={() => setReason(r)}>
                    {r === 'other' ? 'سبب آخر' : r}
                  </OptionChip>
                ))}
              </ChoiceGroup>
              {reason === 'other' ? (
                <TextField
                  label="السبب"
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value.slice(0, 200))}
                />
              ) : null}
            </div>

            <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-e2 xl:sticky xl:top-0">
              <ChoiceGroup label="طريقة الرد" className="grid gap-2">
                {refundMethods.map((m) => (
                  <OptionTile
                    key={m}
                    selected={method === m}
                    onClick={() => setMethod(m)}
                    icon={REFUND_ICON[m]}
                    title={REFUND_TEXT[m]}
                  />
                ))}
              </ChoiceGroup>
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
                className="flex flex-col gap-0.5 rounded-control bg-surface-total px-4 py-3"
              >
                <span className="text-sm font-semibold text-ink-muted">
                  {method === 'voucher' ? 'مبلغ القسيمة' : 'المبلغ المردود'}
                </span>
                <Money
                  minor={draft?.totals.totalMinor ?? 0}
                  currency={current.sale.currency}
                  className="text-kpi font-bold tracking-tight text-ink"
                  unitClassName="text-base font-semibold text-ink-subtle"
                />
              </div>
              {error ? <Alert tone="error">{error}</Alert> : null}
              {approving ? (
                <ManagerCode
                  staff={staff}
                  permission="sale.refund"
                  reason={
                    method === 'voucher'
                      ? 'المرتجع يُصدر قسيمة بمبلغه، فيحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                      : 'المرتجع يُخرج مالاً، فيحتاج رمز مدير حاضر. يُسجَّل باسمه.'
                  }
                  onApproved={(approval) => void record(approval)}
                  onCancel={() => setApproving(false)}
                />
              ) : (
                <Button
                  size="lg"
                  fullWidth
                  icon={<UndoIcon />}
                  disabled={!ready || saving}
                  onClick={() => (canRefund ? void record(null) : setApproving(true))}
                >
                  سجّل المرتجع
                </Button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
