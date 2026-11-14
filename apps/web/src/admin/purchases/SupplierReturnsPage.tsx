import { useCallback, useEffect, useState } from 'react';
import type {
  SupplierListResponse,
  SupplierReturnDetail,
  SupplierReturnInput,
  SupplierReturnRow,
} from '@serva/core';
import {
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
import { AppShell } from '../../layout/AppShell';
import { apiFetch, ApiError, errorMessage } from '../../lib/api';
import { listSuppliers, moneyOf, qtyOf, today } from './api';
import { Caption, LinesHead, LinesTable, RemoveLine, SectionHead, WayArrow } from './parts';
import { PackQty } from './PackQty';
import { baseQtyOf, packSummary, withPackChange } from './packLines';
import { BatchSelect, type BatchChoice } from './BatchSelect';
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
  cash: { title: 'نقداً', hint: 'تدخل المصاري الخزنة', icon: CashIcon, tone: 'success' },
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
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [items, setItems] = useState<SupplierReturnRow[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [refund, setRefund] = useState<SupplierReturnRow['refund']>('credit');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<SupplierReturnDetail | null>(null);

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

  const parsed = lines.map((l) => ({
    qty: baseQtyOf(l),
    amount: l.amount.trim() ? moneyOf(l.amount) : undefined,
  }));
  const ready =
    supplierId && lines.length > 0 && parsed.every((p) => p.qty !== null && p.qty > 0 && p.amount !== null);
  const pieces = parsed.reduce<number>((sum, p) => sum + (p.qty ?? 0), 0);

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      setDone(
        await createReturn({
          supplierId,
          branchId: branchId || undefined,
          date: today(),
          refund,
          reference: reference.trim() || null,
          note: note.trim() || null,
          lines: lines.map((l, i) => ({
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
          })),
        }),
      );
      setLines([]);
      setReference('');
      setNote('');
      load();
    } catch (e) {
      setError(errorMessage(e));
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
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
      cell: (r) => <span className="num text-ink-muted">{r.date}</span>,
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
        />
        <section aria-label="مرتجع جديد">
          <Card>
            <CardHeader
              icon={<UndoIcon />}
              title="مرتجع جديد"
              description="اختر المورد وطريقة الاسترداد، ثم أضف القطع الراجعة."
            />
            <div className="flex flex-col gap-5">
              {error ? <Alert tone="error">{error}</Alert> : null}
              {done ? (
                <Alert tone="success">
                  سُجّل المرتجع {done.number}: <Money minor={done.amountMinor} currency={base} />{' '}
                  {done.refund === 'credit' ? 'نزلت من رصيد المورد.' : 'استرددتها منه.'} خرجت القطع من
                  المخزون.
                </Alert>
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
                  onChange={(e) => setSupplierId(e.target.value)}
                  error={fields.supplierId}
                >
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
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
                  placeholder="عيب خياطة، مقاس خطأ…"
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
                      <span>المبلغ (فارغ: بكلفتها)</span>
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
                        <Caption>المبلغ (فارغ: بكلفتها)</Caption>
                        <TextField
                          label={`مبلغ ${l.name}`}
                          hideLabel
                          placeholder="بكلفتها"
                          dir="ltr"
                          inputMode="decimal"
                          value={l.amount}
                          onChange={(e) =>
                            setLines((all) =>
                              all.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                            )
                          }
                          inputClassName="num"
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
                              <span className="text-sm text-danger-ink">{fields[`lines.${i}.serials`]}</span>
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
                <Button icon={<UndoIcon />} disabled={!ready} loading={saving} onClick={() => void save()}>
                  سجّل المرتجع
                </Button>
              </div>
            </div>
          </Card>
        </section>
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
