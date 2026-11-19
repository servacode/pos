import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type {
  PurchaseRow,
  SupplierListResponse,
  SupplierReturnDetail,
  SupplierReturnInput,
  SupplierReturnRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Badge,
  BookIcon,
  Button,
  Card,
  CardHeader,
  CashIcon,
  ChequeIcon,
  ChoiceCard,
  DataTable,
  EmptyState,
  formatQuantity,
  Money,
  NumberField,
  PageHeader,
  RadioGroup,
  Select,
  TextField,
  UndoIcon,
  useDigits,
  type BadgeTone,
  type DataColumn,
  type Icon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText } from '../../lib/dates';
import { AppShell } from '../../layout/AppShell';
import { apiFetch, ApiError, errorMessage } from '../../lib/api';
import { getPurchase, listPurchases, listSuppliers, moneyOf, qtyOf, today } from './api';
import { Caption, LinesHead, LinesTable, RemoveLine, SectionHead, WayArrow } from './parts';
import { PackQty } from './PackQty';
import { baseQtyOf, packSummary, withPackChange } from './packLines';
import { BatchSelect, type BatchChoice, type BatchSuggestion } from './BatchSelect';
import { prefillOf } from './returnPrefill';
import { VariantPicker, type PickedVariant } from './VariantPicker';

const listReturns = () => apiFetch<{ items: SupplierReturnRow[] }>('/v1/supplier-returns', { auth: true });
const createReturn = (input: SupplierReturnInput) =>
  apiFetch<SupplierReturnDetail>('/v1/supplier-returns', { method: 'POST', body: input, auth: true });

const REFUND_TEXT: Record<SupplierReturnRow['refund'], string> = {
  credit: 'من رصيده',
  cash: 'نقداً',
  bank: 'تحويل بنكي',
};

/** Each way the supplier pays back, as a choice and as a state in the list. */
const REFUND_CHOICE: Record<
  SupplierReturnRow['refund'],
  { title: string; hint: string; icon: Icon; tone: BadgeTone }
> = {
  credit: { title: 'من رصيده عندي', hint: 'ينزل مما تدين له', icon: BookIcon, tone: 'neutral' },
  cash: { title: 'نقداً', hint: 'تعود النقود إلى الخزنة', icon: CashIcon, tone: 'success' },
  bank: { title: 'تحويل بنكي', hint: 'تدخل حساب البنك', icon: ChequeIcon, tone: 'info' },
};

interface Line extends PickedVariant {
  /** Pieces, or packs of `packQty` pieces (thousandths) when the item has packs */
  qty: string;
  packQty: number;
  /** What the supplier credits for the line; empty means the pieces' cost */
  amount: string;
  /** The batch sent back; null: the earliest expiry goes first */
  batch?: BatchChoice | null;
  /** Serial numbers of a device sent back, one per piece (shown when the product tracks them) */
  serials?: string;
  /** The one invoice this batch came on (from the expiring-soon report): its return is credited at that invoice's cost */
  purchaseId?: string | null;
}

/** The grid of a return line: the item, its quantity, what the supplier credits and the bin. */
const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_14rem_11rem_2.5rem]';

/**
 * «مرتجع إلى المورد» (09 › purchase returns): pieces sent back to their supplier, out of the branch
 * at their average cost. The supplier credits them off what the store owes it, or pays back in cash
 * or by bank; the amount is the pieces' cost unless typed.
 */
export function SupplierReturnsPage() {
  const me = useMe();
  const digits = useDigits();
  const branches = me.branches;
  const base = me.settings.baseCurrency;
  // «رجّعو للمورد» from the expiring-soon report opens the form already filled (round 38)
  const prefill = prefillOf(useLocation().state);
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [items, setItems] = useState<SupplierReturnRow[] | null>(null);
  const [supplierId, setSupplierId] = useState(prefill?.supplierId ?? '');
  const [branchId, setBranchId] = useState(prefill?.branchId ?? branches[0]?.id ?? '');
  const [refund, setRefund] = useState<SupplierReturnRow['refund']>('credit');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState(prefill?.note ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    (prefill?.lines ?? []).map((l) => ({
      variantId: l.variantId,
      name: l.name,
      qty: String(l.qty / 1000),
      packQty: 1000,
      amount: '',
      ...(l.batchNo || l.expiryDate
        ? { batch: { batchNo: l.batchNo, expiryDate: l.expiryDate } as BatchChoice }
        : {}),
      purchaseId: l.purchaseId ?? null,
    })),
  );
  // «من فاتورة شراء» (round 36, decision 13): the supplier credits each line at what the invoice cost
  const [invoices, setInvoices] = useState<PurchaseRow[]>([]);
  const [purchaseId, setPurchaseId] = useState(() => {
    // Every batch of the prefill came on the same invoice: the return is against it, at its cost (round 39)
    const ids = new Set((prefill?.lines ?? []).map((l) => l.purchaseId ?? ''));
    return ids.size === 1 ? ([...ids][0] ?? '') : '';
  });
  const [saving, setSaving] = useState(false);
  // The list of returns comes first; the form opens from «مرتجع جديد»
  const [formOpen, setFormOpen] = useState(prefill !== null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const errorBox = useRef<HTMLDivElement>(null);
  // The reason sits at the top while the button is at the bottom: bring it into view
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [error]);
  const [done, setDone] = useState<SupplierReturnDetail | null>(null);
  const [doneCount, setDoneCount] = useState<string[]>([]);

  const load = useCallback(() => {
    listReturns()
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    listSuppliers()
      .then((s) => {
        setSuppliers(s);
        setSupplierId((id) => id || (s.items.find((x) => !x.archived)?.id ?? ''));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  // The batch each item came in on the latest purchases from this supplier: the box starts on it
  const [lastBatch, setLastBatch] = useState<Map<string, BatchSuggestion[]>>(new Map());
  useEffect(() => {
    if (!supplierId) return;
    let alive = true;
    listPurchases()
      .then(async (all) => {
        const mine = all.items
          .filter((p) => p.supplierId === supplierId)
          // Newest first; two on the same day: the later number
          .sort((a, b) => (a.date === b.date ? (a.number < b.number ? 1 : -1) : a.date < b.date ? 1 : -1));
        if (alive) setInvoices(mine.filter((p) => !p.correctedBy));
        const recent = mine.slice(0, 5);
        const found = new Map<string, BatchSuggestion[]>();
        for (const p of recent) {
          const detail = await getPurchase(p.id);
          for (const l of detail.lines) {
            if (l.batchNo || l.expiryDate) {
              found.set(l.variantId, [
                ...(found.get(l.variantId) ?? []),
                { batchNo: l.batchNo, expiryDate: l.expiryDate, from: p.number },
              ]);
            }
          }
        }
        if (alive) setLastBatch(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [supplierId]);

  const invoice = invoices.find((p) => p.id === purchaseId) ?? null;
  const invoiceCurrency = invoice?.currency === 'USD' ? 'USD' : base;
  /** Every item of the invoice as a line to send back (the quantity is typed by the person) */
  async function addInvoiceLines() {
    if (!invoice) return;
    try {
      const detail = await getPurchase(invoice.id);
      setLines((list) => [
        ...list.filter((l) => !detail.lines.some((d) => d.variantId === l.variantId)),
        ...detail.lines.map((d) => ({
          variantId: d.variantId,
          productId: d.productId,
          name: d.name,
          qty: '',
          packQty: 1000,
          amount: '',
          ...(d.batchNo || d.expiryDate
            ? { batch: { batchNo: d.batchNo, expiryDate: d.expiryDate } as BatchChoice }
            : {}),
        })),
      ]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const parsed = lines.map((l) => ({
    qty: baseQtyOf(l),
    amount: l.amount.trim() ? moneyOf(l.amount) : undefined,
  }));
  const ready =
    supplierId && lines.length > 0 && parsed.every((p) => p.qty !== null && p.qty > 0 && p.amount !== null);
  const pieces = parsed.reduce<number>((sum, p) => sum + (p.qty ?? 0), 0);

  /** Lines to send, one return each: against the chosen invoice, or per invoice the batches came on, the rest at the average */
  const batches = purchaseId
    ? [{ purchaseId, rows: lines.map((_, i) => i) }]
    : [...new Set(lines.map((l) => l.purchaseId ?? ''))].map((id) => ({
        purchaseId: id,
        rows: lines.flatMap((l, i) => ((l.purchaseId ?? '') === id ? [i] : [])),
      }));
  const splitByInvoice = !purchaseId && batches.length > 1 && lines.some((l) => l.purchaseId);

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    setFields({});
    const made: SupplierReturnDetail[] = [];
    try {
      for (const part of batches) {
        const mine = part.rows.map((i) => lines[i]!);
        const created = await createReturn({
          supplierId,
          branchId: branchId || undefined,
          date: today(),
          refund,
          ...(part.purchaseId ? { purchaseId: part.purchaseId } : {}),
          reference: reference.trim() || null,
          note: note.trim() || null,
          lines: part.rows.map((i) => {
            const l = lines[i]!;
            return {
              variantId: l.variantId,
              qty: parsed[i]!.qty!,
              amountMinor: parsed[i]!.amount ?? null,
              ...(l.batch ? { batchNo: l.batch.batchNo, expiryDate: l.batch.expiryDate } : {}),
              ...(l.serials?.trim()
                ? {
                    serials: l.serials
                      .split(/[\n,،]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  }
                : {}),
            };
          }),
        });
        made.push(created);
        // What is saved leaves the form, so a retry after a later failure never sends it twice
        setLines((list) => list.filter((l) => !mine.includes(l)));
      }
      setDone(made[made.length - 1] ?? null);
      setDoneCount(made.map((m) => m.number));
      setLines([]);
      setPurchaseId('');
      setReference('');
      setNote('');
      setFormOpen(false);
      load();
    } catch (e) {
      const named = e instanceof ApiError ? (e.fields ?? {}) : {};
      // The banner carries the real reason, not only «تحقّق من الحقول المظلّلة»
      const reasons = [...new Set(Object.values(named))];
      // The connection may drop after the server saved the return: read the list again and say so,
      // so a second press does not send the same pieces back twice
      const dropped = e instanceof ApiError && (e.code === 'network_error' || e.status >= 500);
      if (dropped || made.length > 0) load();
      const saved =
        made.length > 0 ? `سُجّل منها ${made.map((m) => m.number).join('، ')} وبقي الباقي في النموذج. ` : '';
      setError(
        saved +
          (reasons.length > 0
            ? reasons.join(' · ')
            : dropped
              ? `${errorMessage(e)} قد يكون المرتجع حُفظ: تحقّق من القائمة أسفل الصفحة قبل الإعادة.`
              : errorMessage(e)),
      );
      setFields(named);
    } finally {
      setSaving(false);
    }
  }

  const columns: DataColumn<SupplierReturnRow>[] = [
    {
      key: 'number',
      className: 'whitespace-nowrap',
      header: 'الرقم',
      cell: (r) => (
        <bdi dir="ltr" className="num font-semibold">
          {r.number}
        </bdi>
      ),
    },
    {
      key: 'date',
      className: 'whitespace-nowrap',
      header: 'التاريخ',
      cell: (r) => <span className="whitespace-nowrap text-ink-muted">{dayText(r.date, digits)}</span>,
    },
    { key: 'supplier', className: 'whitespace-nowrap', header: 'المورد', cell: (r) => r.supplierName },
    {
      key: 'refund',
      header: 'الاسترداد',
      cell: (r) => <Badge tone={REFUND_CHOICE[r.refund].tone}>{REFUND_TEXT[r.refund]}</Badge>,
    },
    {
      key: 'pieces',
      header: 'القطع',
      numeric: true,
      cell: (r) => <span className="num">{formatQuantity(r.pieces, digits)}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      numeric: true,
      cell: (r) => <Money minor={r.amountMinor} currency={base} className="font-semibold" />,
    },
  ];

  const active = (suppliers?.items ?? []).filter((s) => !s.archived);
  return (
    <AppShell>
      <title>مرتجع إلى المورد · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="مرتجع إلى المورد"
          description="قطع ترجع لمورّدها: تخرج من المخزون بكلفتها، وتنزل من رصيده أو تستردّ ثمنها."
          actions={
            formOpen ? null : (
              <Button icon={<AddIcon />} onClick={() => setFormOpen(true)}>
                مرتجع جديد
              </Button>
            )
          }
        />
        {done && !formOpen ? (
          <Alert tone="success">
            {doneCount.length > 1
              ? `سُجّلت ${doneCount.length} مرتجعات (${doneCount.join('، ')}) كل واحد بفاتورته. آخرها `
              : 'سُجّل المرتجع '}
            {done.number}: <Money minor={done.amountMinor} currency={base} />{' '}
            {done.refund === 'credit' ? 'نزلت من رصيد المورد.' : 'استرددتها منه.'} خرجت القطع من المخزون.
            {done.purchaseNumber ? (
              <>
                {' '}
                بكلفتها في الفاتورة{' '}
                <bdi dir="ltr" className="num">
                  {done.purchaseNumber}
                </bdi>
                {done.foreignAmountMinor ? (
                  <>
                    {' '}
                    (<Money minor={done.foreignAmountMinor} currency="USD" />)
                  </>
                ) : null}
                .
              </>
            ) : null}
          </Alert>
        ) : null}
        {formOpen ? (
          <section aria-label="مرتجع جديد">
            <Card>
              <CardHeader
                icon={<UndoIcon />}
                title="مرتجع جديد"
                description="اختر المورد وطريقة الاسترداد، ثم أضف القطع الراجعة."
              />
              <div className="flex flex-col gap-5">
                {error ? (
                  <div ref={errorBox}>
                    <Alert tone="error">{error}</Alert>
                  </div>
                ) : null}
                {suppliers && active.length === 0 ? (
                  <Alert tone="info">لا موردين بعد. أضف المورد من «المشتريات».</Alert>
                ) : null}
                {/* The way the pieces go: out of a branch, back to the supplier. */}
                <div
                  className={
                    branches.length > 1
                      ? 'grid grid-cols-1 items-start gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'
                      : 'grid grid-cols-1 gap-4 md:grid-cols-2'
                  }
                >
                  {branches.length > 1 ? (
                    <>
                      <Select label="من فرع" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                      <WayArrow />
                    </>
                  ) : null}
                  <Select
                    label="المورد"
                    value={supplierId}
                    onChange={(e) => {
                      setSupplierId(e.target.value);
                      setPurchaseId('');
                      setInvoices([]);
                    }}
                    error={fields.supplierId}
                  >
                    {supplierId ? null : <option value="">اختر المورد</option>}
                    {active.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {splitByInvoice ? (
                  <Alert tone="info">
                    هالدفعات جاءت على أكثر من فاتورة شراء، فيُسجَّل مرتجع لكل فاتورة بكلفتها فيها. والدفعة
                    التي لا فاتورة لها تُحسب بمتوسط الكلفة.
                  </Alert>
                ) : null}
                {invoices.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <Select
                      label="من فاتورة شراء (اختياري)"
                      hint="إن اخترتها يُحتسب للمورد كل صنف بكلفته في الفاتورة، لا بمتوسط الكلفة اليوم."
                      value={purchaseId}
                      onChange={(e) => setPurchaseId(e.target.value)}
                      error={fields.purchaseId}
                    >
                      <option value="">بلا فاتورة: بمتوسط الكلفة</option>
                      {invoices.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number} · {dayText(p.date, digits)}
                        </option>
                      ))}
                    </Select>
                    {invoice ? (
                      <Alert tone="info">
                        يُحسب للمورد كل صنف بكلفته في الفاتورة{' '}
                        <bdi dir="ltr" className="num font-semibold">
                          {invoice.number}
                        </bdi>
                        {invoice.currency === 'USD' ? ' بالدولار وبسعر يومها' : ''}. تخرج القطع من المخزون
                        بمتوسط الكلفة اليوم، وما بين الكلفتين يدخل في كلفة المبيعات.{' '}
                        <Button variant="ghost" size="xs" onClick={() => void addInvoiceLines()}>
                          أضف أصناف الفاتورة
                        </Button>
                      </Alert>
                    ) : null}
                  </div>
                ) : null}
                <RadioGroup legend="الاسترداد">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {(Object.keys(REFUND_CHOICE) as SupplierReturnRow['refund'][]).map((r) => {
                      const RefundIcon = REFUND_CHOICE[r].icon;
                      return (
                        <ChoiceCard
                          key={r}
                          name="supplier-return-refund"
                          value={r}
                          checked={refund === r}
                          onChange={() => setRefund(r)}
                          title={REFUND_CHOICE[r].title}
                          description={REFUND_CHOICE[r].hint}
                          leading={<RefundIcon />}
                        />
                      );
                    })}
                  </div>
                </RadioGroup>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <TextField
                    label="رقم إشعار المورد (اختياري)"
                    dir="ltr"
                    value={reference}
                    onChange={(e) => setReference(e.target.value.slice(0, 64))}
                  />
                  <TextField
                    label="السبب (اختياري)"
                    placeholder="عيب في الصنع، كمية خطأ…"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                  />
                </div>
                <VariantPicker
                  onPick={(v) =>
                    // The same item may come twice, each from its own batch
                    setLines((list) => [...list, { ...v, qty: '', packQty: 1000, amount: '' }])
                  }
                  onPickGrid={(picked) =>
                    setLines((list) => [
                      ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
                      ...picked.map((p) => ({
                        variantId: p.variantId,
                        name: p.name,
                        qty: p.qty,
                        packQty: 1000,
                        amount: '',
                      })),
                    ])
                  }
                />
                {lines.length > 0 ? (
                  <LinesTable
                    label="أصناف المرتجع"
                    head={
                      <LinesHead className={LINE_COLUMNS}>
                        <span>الصنف</span>
                        <span>الكمية</span>
                        <span>{invoice ? 'المبلغ (فارغ: بكلفة الفاتورة)' : 'المبلغ (فارغ: بكلفتها)'}</span>
                        <span />
                      </LinesHead>
                    }
                  >
                    {lines.map((l, i) => (
                      <li
                        key={`${l.variantId}-${i}`}
                        className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:items-center ${LINE_COLUMNS}`}
                      >
                        <span className="col-span-2 flex min-w-0 flex-col md:col-span-1">
                          <span className="truncate font-semibold text-ink">{l.name}</span>
                          {l.packQty > 1000 && parsed[i]!.qty ? (
                            <span className="text-xs text-ink-subtle">
                              {packSummary(
                                qtyOf(l.qty) ?? 0,
                                l.packs?.find((x) => x.qty === l.packQty) ?? null,
                                (q) => formatQuantity(q, digits),
                              )}
                            </span>
                          ) : null}
                        </span>
                        <div className="col-span-3 row-start-2 md:col-span-1 md:col-start-auto md:row-start-auto">
                          <Caption>الكمية</Caption>
                          <PackQty
                            name={l.name}
                            packs={l.packs}
                            qty={l.qty}
                            packQty={l.packQty}
                            onChange={(patch) =>
                              setLines((all) => all.map((x, j) => (j === i ? withPackChange(x, patch) : x)))
                            }
                            error={fields[`lines.${i}.qty`]}
                          />
                        </div>
                        <div className="col-span-3 row-start-3 md:col-span-1 md:col-start-auto md:row-start-auto">
                          <Caption>
                            {invoice
                              ? invoiceCurrency === 'USD'
                                ? 'المبلغ بالدولار (فارغ: بكلفة الفاتورة)'
                                : 'المبلغ (فارغ: بكلفة الفاتورة)'
                              : 'المبلغ (فارغ: بكلفتها)'}
                          </Caption>
                          <NumberField
                            label={`مبلغ ${l.name}`}
                            hideLabel
                            placeholder={invoice ? 'بكلفة الفاتورة' : 'بكلفتها'}
                            decimals={2}
                            value={l.amount}
                            onValueChange={(amount) =>
                              setLines((all) => all.map((x, j) => (j === i ? { ...x, amount } : x)))
                            }
                            error={fields[`lines.${i}.amountMinor`]}
                          />
                        </div>
                        <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                          <RemoveLine
                            name={l.name}
                            onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                          />
                        </div>
                        <div className="col-span-3 row-start-4 md:col-span-4 md:row-start-auto">
                          <BatchSelect
                            variantId={l.variantId}
                            branchId={branchId || undefined}
                            value={l.batch ?? null}
                            suggest={lastBatch.get(l.variantId)}
                            onChange={(batch) =>
                              setLines((all) => all.map((x, j) => (j === i ? { ...x, batch } : x)))
                            }
                            error={fields[`lines.${i}.batchNo`]}
                          />
                        </div>

                        {l.tracksSerial || fields[`lines.${i}.serials`] || l.serials ? (
                          <div className="col-span-3 md:col-span-4">
                            <label className="flex flex-col gap-1.5">
                              <span className="text-xs font-semibold text-ink-subtle">
                                الأرقام التسلسلية (رقم لكل قطعة، واحد في كل سطر)
                              </span>
                              <textarea
                                aria-label={`أرقام ${l.name}`}
                                dir="ltr"
                                rows={2}
                                value={l.serials ?? ''}
                                onChange={(e) =>
                                  setLines((all) =>
                                    all.map((x, j) => (j === i ? { ...x, serials: e.target.value } : x)),
                                  )
                                }
                                className="num rounded-control border border-line-control bg-surface px-3 py-2 text-[0.9375rem] text-ink transition-[border-color,box-shadow] duration-120 ease-standard hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden"
                              />
                              {fields[`lines.${i}.serials`] ? (
                                <span className="text-sm text-danger-ink">
                                  {fields[`lines.${i}.serials`]}
                                </span>
                              ) : null}
                            </label>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </LinesTable>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                  <p className="text-sm text-ink-muted">
                    {lines.length > 0 ? (
                      <>
                        الأصناف: <span className="num font-semibold text-ink">{lines.length}</span> · القطع:{' '}
                        <span className="num font-semibold text-ink">{formatQuantity(pieces, digits)}</span>
                      </>
                    ) : (
                      'ابحث عن القطعة الراجعة وأضفها بكميتها.'
                    )}
                  </p>
                  <span className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => setFormOpen(false)}>
                      إلغاء
                    </Button>
                    <Button
                      icon={<UndoIcon />}
                      disabled={!ready}
                      loading={saving}
                      onClick={() => void save()}
                    >
                      سجّل المرتجع
                    </Button>
                  </span>
                </div>
              </div>
            </Card>
          </section>
        ) : null}
        <section aria-label="المرتجعات السابقة" className="flex flex-col gap-3">
          <SectionHead title="المرتجعات إلى الموردين" description="الأحدث أولاً." />
          <DataTable
            caption="المرتجعات إلى الموردين"
            columns={columns}
            rows={items ?? []}
            rowKey={(r) => r.id}
            loading={!items && !error}
            empty={
              <EmptyState
                icon={UndoIcon}
                title="لا مرتجعات بعد."
                description="كل مرتجع تسجّله يظهر هنا بمبلغه وطريقة استرداده."
              />
            }
          />
        </section>
      </div>
    </AppShell>
  );
}
