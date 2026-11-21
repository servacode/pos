import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  formatMoney,
  orderLineCost,
  type PurchaseOrderAlreadyOrdered,
  type PurchaseOrderDetail,
  type PurchaseOrderSuggestionLine,
  type SupplierRow,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  formatQuantity,
  Money,
  NumberField,
  SkeletonText,
  Select,
  Switch,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { getInventory, moneyOf, newDocumentId, qtyOf, listSuppliers, storeToday } from './api';
import { getProduct } from '../catalog/api';
import { moneyText } from './packLines';
import { PageTop, SalesPage } from '../sales/ui';
import './purchases.css';
import { createOrder, getOrder, suggestOrder, updateOrder } from './orderApi';
import { Caption, LinesHead, LinesTable, RemoveLine } from './parts';
import {
  purchaseWarnings,
  referenceCosts,
  usualUnit,
  usualUnitOf,
  type CostReference,
} from './purchaseSanity';
import { SanityDialog } from './SanityDialog';
import { SuggestPanel, groupSuggestion } from './SuggestPanel';
import type { GridLine } from './SizeGrid';
import { VariantPicker, type PickedVariant } from './VariantPicker';

interface Line {
  variantId: string;
  productId?: string;
  name: string;
  /** Pieces as typed */
  qty: string;
  /** What one piece is expected to cost, as typed; the line's total follows it */
  unit: string;
  /** Why the suggestion put it here */
  why?: PurchaseOrderSuggestionLine;
}

/** What is known about an item when it sits on the order: the shelf, the usual costs, the price */
interface Facts {
  stock?: number;
  min?: number | null;
  price?: number | null;
  reference?: CostReference;
}

const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_2.5rem]';

const NOTES_CLASS =
  'w-full resize-y rounded-control border border-line-control bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink caret-brand transition-[border-color,box-shadow] duration-120 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:outline-hidden pointer-coarse:text-base';

/**
 * A purchase order being written (new, or a draft or sent order edited): the supplier, the day it
 * is wanted, the lines with their expected cost, and «اقترح طلبية» which fills the lines with what
 * runs short at that supplier for the owner to change. Saving writes a draft; nothing posts.
 */
export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const me = useMe();
  const digits = useDigits();
  const navigate = useNavigate();
  const base = me.settings.baseCurrency;
  const [loading, setLoading] = useState(Boolean(id));
  const [saved, setSaved] = useState<PurchaseOrderDetail | null>(null);
  const [supplierList, setSupplierList] = useState<SupplierRow[]>([]);
  // The order's own id, made when the form opens and kept until it is saved: a retry answers the order already made
  const [docId] = useState(newDocumentId);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  // «اطلب من المورد» in «النواقص» opens a new order for that supplier with the suggestion already asked for (round 38)
  const [params] = useSearchParams();
  const [supplierId, setSupplierId] = useState(() => (id ? '' : (params.get('supplier') ?? '')));
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [facts, setFacts] = useState<Record<string, Facts>>({});
  /** What a model usually cost, for a piece of it that was never bought itself */
  const [modelCost, setModelCost] = useState<Record<string, number>>({});
  const [all, setAll] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [already, setAlready] = useState<PurchaseOrderAlreadyOrdered[]>([]);
  const [panel, setPanel] = useState<PurchaseOrderSuggestionLine[] | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [error]);

  const learn = (variantId: string, more: Facts) =>
    setFacts((now) => ({ ...now, [variantId]: { ...now[variantId], ...more } }));

  useEffect(() => {
    listSuppliers()
      .then((r) => {
        const active = r.items.filter((s) => !s.archived);
        setSupplierList(r.items);
        // With one supplier there is nothing to choose; with several the owner picks (the first is not assumed)
        setSupplierId((current) => current || (id || active.length !== 1 ? '' : active[0]!.id));
        setSuppliersLoaded(true);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  // The shelf and the usual costs of every item, for the line notes and the cost doubts; no permission, no notes
  useEffect(() => {
    let alive = true;
    getInventory()
      .then((r) => {
        if (!alive) return;
        const stock = new Map<string, number>();
        for (const row of r.items) stock.set(row.variantId, (stock.get(row.variantId) ?? 0) + row.qty);
        const refs = referenceCosts(r.items);
        const byModel = new Map<string, string[]>();
        for (const row of r.items) {
          if (row.productId)
            byModel.set(row.productId, [...(byModel.get(row.productId) ?? []), row.variantId]);
        }
        const costs: Record<string, number> = {};
        for (const [productId, ids] of byModel) {
          const usual = usualUnitOf(refs, ids);
          if (usual) costs[productId] = usual;
        }
        setModelCost(costs);
        setFacts((now) => {
          const next = { ...now };
          for (const [variantId, qty] of stock) {
            const reference = refs.get(variantId);
            next[variantId] = { ...next[variantId], stock: qty, ...(reference ? { reference } : {}) };
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getOrder(id)
      .then((o) => {
        if (!alive) return;
        setSaved(o);
        setSupplierId(o.supplierId);
        setExpected(o.expectedDate ?? '');
        setNotes(o.notes ?? '');
        setLines(
          o.lines.map((l) => ({
            variantId: l.variantId,
            productId: l.productId,
            name: l.name,
            qty: String(l.qty / 1000),
            unit: moneyText(l.unitCostMinor),
          })),
        );
        // The shelf price and minimum of each item, for the doubts about a cost
        for (const productId of new Set(o.lines.map((l) => l.productId))) {
          getProduct(productId)
            .then((d) => {
              for (const v of d.variants) {
                learn(v.id, {
                  min: v.minStockQty,
                  price: v.price.currency === base && v.price.priceMinor > 0 ? v.price.priceMinor : null,
                });
              }
            })
            .catch(() => undefined);
        }
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  // An archived supplier stays in the list only while it is the one the order already has
  const suppliers = supplierList.filter((s) => !s.archived || s.id === supplierId);
  const parsed = lines.map((l) => {
    const qty = qtyOf(l.qty);
    const unit = l.unit.trim() ? moneyOf(l.unit) : 0;
    return { qty, unit, total: qty && unit !== null ? orderLineCost(unit, qty) : 0 };
  });
  const missingQty = lines.filter((_, i) => !(parsed[i]!.qty && parsed[i]!.qty! > 0));
  const missingCost = lines.filter((_, i) => parsed[i]!.unit === null);
  const ready =
    Boolean(supplierId) && lines.length > 0 && missingQty.length === 0 && missingCost.length === 0;
  const total = parsed.reduce((n, p) => n + p.total, 0);
  const locked = saved !== null && saved.status !== 'draft' && saved.status !== 'sent';
  /** Why «احفظ» waits, in words: a button never goes grey without a reason */
  const notReadyWhy = ready
    ? null
    : !supplierId
      ? 'اختر المورد ليُحفظ.'
      : lines.length === 0
        ? 'أضف صنفاً واحداً على الأقل.'
        : missingQty.length > 0
          ? `اكتب الكمية لـ ${missingQty.map((l) => l.name).join('، ')} ليُحفظ.`
          : `اكتب سعر الوحدة لـ ${missingCost.map((l) => l.name).join('، ')} ليُحفظ.`;

  function addItem(v: PickedVariant) {
    const reference = facts[v.variantId]?.reference;
    learn(v.variantId, {
      ...(v.priceMinor ? { price: v.priceMinor } : {}),
      ...(v.minStockQty ? { min: v.minStockQty } : {}),
    });
    const usual = usualUnit(reference) ?? (v.productId ? (modelCost[v.productId] ?? null) : null);
    setLines((list) =>
      list.some((l) => l.variantId === v.variantId)
        ? list
        : [
            ...list,
            {
              variantId: v.variantId,
              name: v.name,
              qty: '',
              unit: usual ? moneyText(Math.round(usual)) : '',
            },
          ],
    );
  }

  /** A model's pieces typed as a grid: each becomes a line with the grid's cost of one piece */
  function addGrid(picked: GridLine[]) {
    setLines((list) => [
      ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
      ...picked.map((p) => ({
        variantId: p.variantId,
        name: p.name,
        qty: p.qty,
        unit: p.unit ?? '',
      })),
    ]);
  }

  /** The last cost of one piece of a model, as typed, to start the grid's cost box with */
  function gridUnit(ids: string[]): string {
    const refs = new Map(
      Object.entries(facts).flatMap(([k, f]) => (f.reference ? [[k, f.reference] as const] : [])),
    );
    const usual = usualUnitOf(refs, ids);
    return usual ? moneyText(Math.round(usual)) : '';
  }

  function addSuggested(items: PurchaseOrderSuggestionLine[]) {
    for (const i of items) learn(i.variantId, { stock: i.stockQty, min: i.minStockQty, price: i.priceMinor });
    setLines((list) => {
      const have = new Set(list.map((l) => l.variantId));
      return [
        ...list,
        ...items
          .filter((i) => !have.has(i.variantId))
          .map((i) => ({
            variantId: i.variantId,
            productId: i.productId,
            name: i.name,
            qty: String(i.suggestedQty / 1000),
            unit: i.unitCostMinor > 0 ? moneyText(i.unitCostMinor) : '',
            why: i,
          })),
      ];
    });
  }

  async function suggest() {
    if (!supplierId) return;
    setSuggesting(true);
    setError(null);
    setSuggestNote(null);
    setPanel(null);
    try {
      const got = await suggestOrder(supplierId, all);
      const have = new Set(lines.map((l) => l.variantId));
      const fresh = got.items.filter((i) => !have.has(i.variantId));
      setAlready(got.alreadyOrdered);
      const orders = [...new Set(got.alreadyOrdered.flatMap((a) => a.orderNumbers))].join('، ');
      const alreadyText =
        got.alreadyOrdered.length === 0
          ? ''
          : got.alreadyOrdered.length === 1
            ? ` صنف واحد مطلوب أصلاً في ${orders}.`
            : ` ${formatQuantity(got.alreadyOrdered.length * 1000, digits)} أصناف مطلوبة أصلاً في ${orders}.`;
      if (fresh.length === 0) {
        setSuggestNote(
          got.items.length > 0
            ? 'كل ما اقتُرح موجود في الطلبية أصلاً.'
            : got.alreadyOrdered.length > 0
              ? `لا شيء جديد ينقص.${alreadyText}`
              : 'لا شيء ينقص عند هذا المورد الآن. جرّب «أصناف لم تُشترَ منه» إن كان عندك أصناف بلا مورد.',
        );
      } else {
        // A few plain items go straight to the order; a model in sizes and colours is ticked in a grid first
        const simple = fresh.length <= 4 && groupSuggestion(fresh).length === fresh.length;
        if (simple) addSuggested(fresh);
        else setPanel(fresh);
        setSuggestNote(
          `اقتُرحت ${formatQuantity(fresh.length * 1000, digits)} من الأصناف. عدّل الكميات والسعر كما تريد قبل الحفظ.${alreadyText}`,
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSuggesting(false);
    }
  }
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || id || params.get('suggest') !== '1' || !supplierId || !suppliersLoaded) return;
    asked.current = true;
    void suggest();
    // Once, when the page opens from the shortages list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliersLoaded, supplierId]);

  async function write() {
    setBusy(true);
    setError(null);
    setFields({});
    const body = {
      supplierId,
      expectedDate: expected || null,
      notes: notes.trim() || null,
      lines: lines.map((l, i) => ({
        variantId: l.variantId,
        qty: parsed[i]!.qty!,
        costMinor: parsed[i]!.total,
        unitCostMinor: parsed[i]!.unit ?? 0,
      })),
    };
    try {
      const done = saved
        ? await updateOrder(saved.id, { ...body, version: saved.version })
        : await createOrder({ id: docId, ...body });
      void navigate(`/purchase-orders/${done.id}`);
    } catch (e) {
      const named = e instanceof ApiError ? (e.fields ?? {}) : {};
      const reasons = [...new Set(Object.values(named))];
      setError(reasons.length > 0 ? reasons.join(' · ') : errorMessage(e));
      setFields(named);
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const doubts = purchaseWarnings(
      lines.map((l, i) => ({
        variantId: l.variantId,
        name: l.name,
        qty: parsed[i]!.qty,
        costMinor: parsed[i]!.total,
        priceMinor: facts[l.variantId]?.price ?? l.why?.priceMinor ?? null,
      })),
      new Map(Object.entries(facts).flatMap(([k, f]) => (f.reference ? [[k, f.reference] as const] : []))),
    );
    if (doubts.length > 0) setWarnings(doubts);
    else void write();
  }

  /** «عندك 12 · الحد الأدنى 20 · آخر شراء 1,314»: what the owner needs to choose the quantity */
  function noteOf(l: Line): string {
    const f = facts[l.variantId];
    const parts: string[] = [];
    if (f?.stock !== undefined) parts.push(`عندك ${formatQuantity(f.stock, digits)}`);
    if (f?.min && f.min >= 10) parts.push(`الحد الأدنى ${formatQuantity(f.min, digits)}`);
    if (l.why) {
      if (l.why.soldQty > 0) parts.push(`بيع ${formatQuantity(l.why.soldQty, digits)} في 30 يوماً`);
      if (l.why.onOrderQty > 0) parts.push(`مطلوب سابقاً ${formatQuantity(l.why.onOrderQty, digits)}`);
    }
    const last = f?.reference?.last ?? (l.why && l.why.unitCostMinor > 0 ? l.why.unitCostMinor : null);
    if (last) parts.push(`آخر شراء ${formatMoney(Math.round(last), base, { digits })}`);
    return parts.join(' · ');
  }

  const title = saved ? `تعديل الطلبية ${saved.number}` : 'طلبية شراء جديدة';
  return (
    <ReportScreen me={me} access={['purchases.manage']} title={title}>
      <SalesPage className="flex w-full flex-col gap-6">
        <PageTop
          title={title}
          subtitle="اختر المورد وأضف الأصناف بكمياتها وسعر الوحدة المتوقع. تُحفظ مسودة، ثم ترسلها للمورد."
        />
        {loading ? (
          <SkeletonText lines={4} />
        ) : locked ? (
          <Alert tone="warning">هذه الطلبية لا تُعدَّل بعد أن استُلم منها شيء أو أُغلقت.</Alert>
        ) : (
          <form onSubmit={save} aria-label="طلبية شراء" className="flex flex-col gap-6">
            {warnings ? (
              <SanityDialog
                warnings={warnings}
                title="راجع الأرقام قبل الحفظ"
                description="هذه الطلبية تبدو غير معتادة. إن كانت صحيحة احفظها."
                confirm="الأرقام صحيحة، احفظ"
                onConfirm={() => void write()}
                onClose={() => setWarnings(null)}
              />
            ) : null}
            {error ? (
              <div ref={errorBox}>
                <Alert tone="error">{error}</Alert>
              </div>
            ) : null}
            <Card>
              <CardHeader title="المورد والموعد" />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  label="المورد"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  error={fields.supplierId}
                  disabled={Boolean(saved)}
                >
                  {supplierId ? null : <option value="">اختر المورد</option>}
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <DateField
                  label="موعد التسليم المطلوب"
                  value={expected}
                  min={storeToday(me.tenant.timezone)}
                  onChange={setExpected}
                  hint="اختياري"
                  error={fields.expectedDate}
                />
              </div>
              {suppliersLoaded && suppliers.length === 0 ? (
                <div className="mt-4">
                  <Alert tone="info">لا موردين بعد. أضف المورد من «المشتريات».</Alert>
                </div>
              ) : null}
            </Card>

            <Card>
              <CardHeader
                title="الأصناف"
                description="«اقترح طلبية» يجمع ما نقص تحت حدّه الأدنى أو يُباع بسرعة، لهذا المورد."
              />
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!supplierId}
                    loading={suggesting}
                    onClick={() => void suggest()}
                  >
                    اقترح طلبية
                  </Button>
                  <Switch label="أصناف لم تُشترَ منه من قبل" checked={all} onCheckedChange={setAll} />
                </div>
                {suggestNote ? <Alert tone="info">{suggestNote}</Alert> : null}
                {already.length > 0 ? (
                  <ul aria-label="أصناف مطلوبة أصلاً" className="flex flex-col gap-1 text-sm text-ink-muted">
                    {already.slice(0, 8).map((a) => (
                      <li key={a.variantId}>
                        {a.name}: مطلوب أصلاً في {a.orderNumbers.join('، ')} (
                        {formatQuantity(a.onOrderQty, digits)})
                      </li>
                    ))}
                    {already.length > 8 ? (
                      <li>و{formatQuantity((already.length - 8) * 1000, digits)} غيرها</li>
                    ) : null}
                  </ul>
                ) : null}
                {panel ? (
                  <SuggestPanel
                    items={panel}
                    onAdd={(picked) => {
                      addSuggested(picked);
                      setPanel(null);
                    }}
                    onCancel={() => setPanel(null)}
                  />
                ) : null}
                <VariantPicker onPick={addItem} onPickGrid={addGrid} unitFor={gridUnit} />
                {lines.length > 0 ? (
                  <LinesTable
                    label="أصناف الطلبية"
                    head={
                      <LinesHead className={LINE_COLUMNS}>
                        <span>الصنف</span>
                        <span>الكمية</span>
                        <span>سعر الوحدة</span>
                        <span>المجموع</span>
                        <span />
                      </LinesHead>
                    }
                  >
                    {lines.map((l, i) => {
                      const note = noteOf(l);
                      return (
                        <li
                          key={l.variantId}
                          className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:items-center ${LINE_COLUMNS}`}
                        >
                          <span className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
                            <span className="truncate font-semibold text-ink">{l.name}</span>
                            {l.why ? (
                              <Badge tone={l.why.reason === 'below_min' ? 'warning' : 'info'}>
                                {l.why.reason === 'below_min'
                                  ? 'تحت الحد الأدنى'
                                  : l.why.reason === 'requested'
                                    ? 'طلبه زبون'
                                    : 'يُباع بسرعة'}
                              </Badge>
                            ) : null}
                            {note ? <span className="text-xs text-ink-subtle">{note}</span> : null}
                            {l.why?.costDoubtful ? (
                              <span className="text-xs font-semibold text-warning-ink">
                                آخر سعر شراء يبدو غير معتاد، راجعه.
                              </span>
                            ) : null}
                          </span>
                          <div className="col-span-3 row-start-2 md:col-span-1 md:col-start-auto md:row-start-auto">
                            <Caption>الكمية</Caption>
                            <NumberField
                              label={`كمية ${l.name}`}
                              hideLabel
                              decimals={3}
                              value={l.qty}
                              onValueChange={(qty) =>
                                setLines((all) => all.map((x, j) => (j === i ? { ...x, qty } : x)))
                              }
                              error={fields[`lines.${i}.qty`]}
                            />
                          </div>
                          <div className="col-span-3 row-start-3 md:col-span-1 md:col-start-auto md:row-start-auto">
                            <Caption>سعر الوحدة</Caption>
                            <NumberField
                              label={`سعر وحدة ${l.name}`}
                              hideLabel
                              decimals={2}
                              value={l.unit}
                              onValueChange={(unit) =>
                                setLines((all) => all.map((x, j) => (j === i ? { ...x, unit } : x)))
                              }
                              error={fields[`lines.${i}.costMinor`]}
                            />
                          </div>
                          <div className="col-span-3 row-start-4 flex items-baseline justify-between md:col-span-1 md:col-start-auto md:row-start-auto md:block">
                            <Caption>المجموع</Caption>
                            <Money
                              minor={parsed[i]!.total}
                              currency={base}
                              className="font-semibold text-ink"
                            />
                          </div>
                          <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                            <RemoveLine
                              name={l.name}
                              onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </LinesTable>
                ) : (
                  <p className="text-sm text-ink-muted">ابحث عن صنف وأضفه، أو اضغط «اقترح طلبية».</p>
                )}
                {fields.lines ? <Alert tone="error">{fields.lines}</Alert> : null}
              </div>
            </Card>

            <Card>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-ink-muted">ملاحظات للمورد (اختياري)</span>
                <textarea
                  rows={3}
                  value={notes}
                  maxLength={500}
                  onChange={(e) => setNotes(e.target.value)}
                  className={NOTES_CLASS}
                />
              </label>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <p className="text-sm text-ink-muted">
                الأصناف: <span className="num font-semibold text-ink">{lines.length}</span> · الإجمالي
                المتوقع: <Money minor={total} currency={base} className="font-semibold text-ink" />
              </p>
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void navigate(saved ? `/purchase-orders/${saved.id}` : '/purchase-orders')}
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  disabled={!ready}
                  loading={busy}
                  aria-describedby={notReadyWhy ? 'order-not-ready' : undefined}
                >
                  {saved ? 'احفظ التعديلات' : 'احفظ كمسودة'}
                </Button>
              </span>
              {notReadyWhy ? (
                <p
                  id="order-not-ready"
                  aria-live="polite"
                  className="w-full text-sm font-semibold text-warning-ink"
                >
                  {notReadyWhy}
                </p>
              ) : null}
            </div>
          </form>
        )}
      </SalesPage>
    </ReportScreen>
  );
}
