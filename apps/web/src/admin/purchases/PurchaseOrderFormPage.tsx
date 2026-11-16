import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { PurchaseOrderDetail, PurchaseOrderSuggestionLine, SupplierRow } from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  formatQuantity,
  ListIcon,
  Money,
  NumberField,
  PageHeader,
  SkeletonText,
  Select,
  Switch,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { ReportScreen } from '../reports/parts';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { moneyOf, qtyOf, listSuppliers, today } from './api';
import { moneyText } from './packLines';
import { createOrder, getOrder, suggestOrder, updateOrder } from './orderApi';
import { Caption, LinesHead, LinesTable, RemoveLine } from './parts';
import { VariantPicker, type PickedVariant } from './VariantPicker';

interface Line {
  variantId: string;
  name: string;
  /** Pieces as typed */
  qty: string;
  /** The line's expected cost in all, as typed */
  cost: string;
  /** Why the suggestion put it here */
  why?: PurchaseOrderSuggestionLine;
}

const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_10rem_10rem_2.5rem]';

const NOTES_CLASS =
  'w-full resize-y rounded-control border border-line-control bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink caret-brand transition-[border-color,box-shadow] duration-120 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden pointer-coarse:text-base';

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
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [all, setAll] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const errorBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [error]);

  useEffect(() => {
    listSuppliers()
      .then((r) => {
        const active = r.items.filter((s) => !s.archived);
        setSuppliers(active);
        setSupplierId((current) => current || (id ? '' : (active[0]?.id ?? '')));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    getOrder(id)
      .then((o) => {
        setSaved(o);
        setSupplierId(o.supplierId);
        setExpected(o.expectedDate ?? '');
        setNotes(o.notes ?? '');
        setLines(
          o.lines.map((l) => ({
            variantId: l.variantId,
            name: l.name,
            qty: String(l.qty / 1000),
            cost: moneyText(l.costMinor),
          })),
        );
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const parsed = lines.map((l) => ({ qty: qtyOf(l.qty), cost: l.cost.trim() ? moneyOf(l.cost) : 0 }));
  const ready =
    Boolean(supplierId) && lines.length > 0 && parsed.every((p) => p.qty && p.qty > 0 && p.cost !== null);
  const total = parsed.reduce((n, p) => n + (p.cost ?? 0), 0);
  const locked = saved !== null && saved.status !== 'draft' && saved.status !== 'sent';

  function addItem(v: PickedVariant) {
    setLines((list) =>
      list.some((l) => l.variantId === v.variantId)
        ? list
        : [...list, { variantId: v.variantId, name: v.name, qty: '', cost: '' }],
    );
  }

  async function suggest() {
    if (!supplierId) return;
    setSuggesting(true);
    setError(null);
    setSuggestNote(null);
    try {
      const got = await suggestOrder(supplierId, all);
      const have = new Set(lines.map((l) => l.variantId));
      const fresh = got.items.filter((i) => !have.has(i.variantId));
      setLines((list) => [
        ...list,
        ...fresh.map((i) => ({
          variantId: i.variantId,
          name: i.name,
          qty: String(i.suggestedQty / 1000),
          cost: i.costMinor > 0 ? moneyText(i.costMinor) : '',
          why: i,
        })),
      ]);
      setSuggestNote(
        got.items.length === 0
          ? 'لا شيء ينقص عند هذا المورد الآن. جرّب «أصناف لم تُشترَ منه» إن كان عندك أصناف بلا مورد.'
          : fresh.length === 0
            ? 'كل ما اقتُرح موجود في الطلبية أصلاً.'
            : `اقتُرحت الأصناف التالية (${formatQuantity(fresh.length * 1000, digits)}).عدّل الكميات والكلفة كما تريد قبل الحفظ.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSuggesting(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
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
        costMinor: parsed[i]!.cost ?? 0,
      })),
    };
    try {
      const done = saved
        ? await updateOrder(saved.id, { ...body, version: saved.version })
        : await createOrder(body);
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

  const title = saved ? `تعديل الطلبية ${saved.number}` : 'طلبية شراء جديدة';
  return (
    <ReportScreen me={me} access={['purchases.manage']} title={title}>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title={title}
          description="اختر المورد وأضف الأصناف بكمياتها وكلفتها المتوقعة. تُحفظ مسودة، ثم ترسلها للمورد."
          icon={<ListIcon />}
        />
        {loading ? (
          <SkeletonText lines={4} />
        ) : locked ? (
          <Alert tone="warning">هذه الطلبية لا تُعدَّل بعد أن استُلم منها شيء أو أُغلقت.</Alert>
        ) : (
          <form onSubmit={(e) => void save(e)} aria-label="طلبية شراء" className="flex flex-col gap-6">
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
                  min={today()}
                  onChange={setExpected}
                  hint="اختياري"
                  error={fields.expectedDate}
                />
              </div>
              {suppliers.length === 0 && !loading ? (
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
                <VariantPicker onPick={addItem} />
                {lines.length > 0 ? (
                  <LinesTable
                    label="أصناف الطلبية"
                    head={
                      <LinesHead className={LINE_COLUMNS}>
                        <span>الصنف</span>
                        <span>الكمية</span>
                        <span>الكلفة المتوقعة</span>
                        <span />
                      </LinesHead>
                    }
                  >
                    {lines.map((l, i) => (
                      <li
                        key={l.variantId}
                        className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3 md:items-center ${LINE_COLUMNS}`}
                      >
                        <span className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
                          <span className="truncate font-semibold text-ink">{l.name}</span>
                          {l.why ? (
                            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                              <Badge tone={l.why.reason === 'below_min' ? 'warning' : 'info'}>
                                {l.why.reason === 'below_min' ? 'تحت الحد الأدنى' : 'يُباع بسرعة'}
                              </Badge>
                              <span>
                                في المخزون {formatQuantity(l.why.stockQty, digits)}
                                {l.why.minStockQty !== null
                                  ? ` · الحد الأدنى ${formatQuantity(l.why.minStockQty, digits)}`
                                  : ''}
                                {l.why.soldQty > 0
                                  ? ` · بيع ${formatQuantity(l.why.soldQty, digits)} في 30 يوماً`
                                  : ''}
                                {l.why.onOrderQty > 0
                                  ? ` · مطلوب سابقاً ${formatQuantity(l.why.onOrderQty, digits)}`
                                  : ''}
                              </span>
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
                          <Caption>الكلفة المتوقعة</Caption>
                          <NumberField
                            label={`كلفة ${l.name}`}
                            hideLabel
                            decimals={2}
                            value={l.cost}
                            onValueChange={(cost) =>
                              setLines((all) => all.map((x, j) => (j === i ? { ...x, cost } : x)))
                            }
                            error={fields[`lines.${i}.costMinor`]}
                          />
                        </div>
                        <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                          <RemoveLine
                            name={l.name}
                            onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                          />
                        </div>
                      </li>
                    ))}
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
                <Button type="submit" disabled={!ready} loading={busy}>
                  {saved ? 'احفظ التعديلات' : 'احفظ كمسودة'}
                </Button>
              </span>
            </div>
          </form>
        )}
      </div>
    </ReportScreen>
  );
}
