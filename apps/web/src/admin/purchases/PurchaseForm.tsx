import { useEffect, useRef, useState } from 'react';
import {
  packOptionsOf,
  rateText,
  type PurchaseCurrencyCode,
  type PurchaseDraft,
  type PurchaseOrderDetail,
  type PurchasePayment,
  type SupplierRow,
} from '@serva/core';
import {
  Alert,
  BookIcon,
  Card,
  CardHeader,
  EmptyState,
  formatQuantity,
  Money,
  NumberField,
  PackageOpenIcon,
  ProductsIcon,
  Select,
  Switch,
  TextField,
  TruckIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { DateField } from '../../lib/DateField';
import { EXPIRY_SECTORS, serialWord, storeSells } from '../../lib/sectors';
import {
  addPurchasePhoto,
  createPurchase,
  getInventory,
  moneyOf,
  newDocumentId,
  qtyOf,
  storeToday,
} from './api';
import { Caption, LinesHead, LinesTable, RemoveLine } from './parts';
import { addDays } from '../reports/periods';
import { PackQty } from './PackQty';
import { SanityDialog } from './SanityDialog';
import { PaperFields } from './PaperFields';
import { resizeImage } from '../../lib/images';
import { baseQtyOf, moneyText, packSummary, withPackChange } from './packLines';
import { purchaseWarnings, referenceCosts, usualUnitOf, type CostReference } from './purchaseSanity';
import { VariantPicker } from './VariantPicker';
import { getProduct } from '../catalog/api';
import { useUsdRate, usdToBase } from '../../lib/useUsdRate';
import { CurrencyTerms } from './CurrencyTerms';
import { PurchasePaymentCard } from './PurchasePaymentCard';
import { PurchaseTotals } from './PurchaseTotals';
import { type Line, useSaving, linesOfOrder, linesOfDraft, LINE_COLUMNS } from './PurchasesShared';

export function PurchaseForm({
  suppliers,
  order,
  correction,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  /** The purchase order being received: its supplier and what is still owed fill the form */
  order?: PurchaseOrderDetail | null;
  /** «صحّح الفاتورة»: the invoice just turned back, as a draft to fix and save */
  correction?: { draft: PurchaseDraft; original: string; reversal: string } | null;
  onSaved: (number: string, photoFailed?: boolean) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const digits = useDigits();
  const todayDay = storeToday(me.tenant.timezone);
  // The invoice's own id, made when the form opens and kept until it is saved: a retry after a dropped
  // connection answers the invoice already made instead of posting a second one
  const [docId] = useState(newDocumentId);
  const draft = correction?.draft ?? null;
  // With one supplier there is nothing to choose; with several the buyer picks (the first is never assumed)
  const usable = suppliers.filter((x) => !x.archived);
  const [supplierId, setSupplierId] = useState(
    draft?.supplierId ?? order?.supplierId ?? (usable.length === 1 ? usable[0]!.id : ''),
  );
  const [date, setDate] = useState(draft?.date ?? todayDay);
  const [payment, setPayment] = useState<PurchasePayment>(draft?.payment ?? 'credit');
  const [reference, setReference] = useState(draft?.reference ?? '');
  // Round 62: the due date (a credit invoice): typed, else the supplier's payment days from the invoice's date
  const [dueTyped, setDueTyped] = useState<string | null>(draft?.dueDate ?? null);
  // …the paper's discount and extra charges, and a photo of the paper (sent once the invoice is saved)
  const [discount, setDiscount] = useState('');
  const [charges, setCharges] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [percent, setPercent] = useState(false);
  const [lines, setLines] = useState<Line[]>(() =>
    draft ? linesOfDraft(draft) : order ? linesOfOrder(order) : [],
  );
  // The invoice's currency and the dollar's rate of the day (decision 11): the rate starts at the store's
  const base = me.settings.baseCurrency;
  const known = useUsdRate();
  const storeRate = base === 'SYP' ? known : null;
  const [currency, setCurrency] = useState<PurchaseCurrencyCode>(draft?.currency === 'USD' ? 'USD' : 'SYP');
  const [rate, setRate] = useState(draft?.rate ?? '');
  useEffect(() => {
    if (storeRate) setRate((typed) => typed || storeRate);
  }, [storeRate]);
  const usd = currency === 'USD';
  const invoiceCurrency: 'SYP' | 'USD' = usd ? 'USD' : 'SYP';
  const rateOk = !usd || (/^\d{1,7}(\.\d{1,4})?$/.test(rateText(rate)) && Number(rateText(rate)) > 0);
  // The items' flags (expiry, serial numbers, packs) come from their products, read after the form opens
  useEffect(() => {
    const source = order?.lines ?? draft?.lines;
    if (!source) return;
    let alive = true;
    for (const productId of new Set(source.map((l) => l.productId))) {
      getProduct(productId)
        .then((d) => {
          if (!alive) return;
          setLines((all) =>
            all.map((l) => {
              const v = d.variants.find((x) => x.id === l.variantId);
              return v
                ? {
                    ...l,
                    packs: packOptionsOf(v.barcodes),
                    ...(d.requiresExpiry ? { requiresExpiry: true } : {}),
                    ...(d.tracksSerial ? { tracksSerial: true } : {}),
                    // The shelf price, so a cost far above it is asked about here too
                    ...(v.price.currency === 'SYP' && v.price.priceMinor > 0
                      ? { priceMinor: v.price.priceMinor }
                      : {}),
                  }
                : l;
            }),
          );
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [order, draft]);
  // The batch, expiry and serial fields of a trade that does not use them, shown on demand (هوية 2:
  // a clothing shop sees no expiry dates or IMEI).
  const [allFields, setAllFields] = useState(false);
  const s = useSaving();
  // After an item is picked, the cursor goes to its quantity (the keyboard does not hunt for the new line)
  const formRef = useRef<HTMLFormElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    const fields = formRef.current?.querySelectorAll<HTMLInputElement>('[data-qty-input]');
    fields?.[fields.length - 1]?.focus();
  }, [lines.length]);
  // A batch dated in the past is saved only after the buyer says the date is right
  const [pastOk, setPastOk] = useState(false);
  // What the shelf cost so far, to ask «هل أنت متأكد؟» about a cost far above it; a failed read means no warning
  const [averages, setAverages] = useState<Map<string, CostReference>>(new Map());
  const [warnings, setWarnings] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    getInventory()
      .then((r) => alive && setAverages(referenceCosts(r.items)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const pastLines = lines.filter((l) => l.expiry && l.expiry < todayDay);
  const parsed = lines.map((l) => ({ qty: baseQtyOf(l), cost: moneyOf(l.cost) }));
  // A line with the quantity 0 is left out of the invoice, not a reason to stop: what did not arrive stays on the order
  const used = lines.flatMap((_, i) => (parsed[i]!.qty === 0 ? [] : [i]));
  const skipped = lines.length - used.length;
  const gross = used.reduce((sum, i) => sum + (parsed[i]!.cost ?? 0), 0);
  const discountTyped = discount.trim() ? moneyOf(discount) : 0;
  // A percent is of the paper's total; the amount it comes to is what is sent (the server knows amounts only)
  const discountN =
    percent && discountTyped !== null ? Math.round((gross * discountTyped) / 10_000) : discountTyped;
  const chargesN = charges.trim() ? moneyOf(charges) : 0;
  const adjustWrong =
    discountN === null ||
    chargesN === null ||
    (discountN ?? 0) > gross ||
    ((chargesN ?? 0) > 0 && gross === 0);
  const adjusted = (discountN ?? 0) > 0 || (chargesN ?? 0) > 0;
  // What the books take: the paper's total less the discount plus the charges (spread over the lines by the server)
  const total = gross - (discountN ?? 0) + (chargesN ?? 0);
  // In dollars: what the stock takes in pounds, line by line at the rate, as the server works it out
  const totalBase = usd
    ? adjusted
      ? (usdToBase(total, base, rateText(rate)) ?? 0)
      : used.reduce((sum, i) => sum + (usdToBase(parsed[i]!.cost ?? 0, base, rateText(rate)) ?? 0), 0)
    : total;
  const termsDays = suppliers.find((x) => x.id === supplierId)?.termsDays ?? null;
  const dueDate =
    payment !== 'credit'
      ? null
      : (dueTyped ?? (termsDays !== null && date ? addDays(date, termsDays) : null));

  const ready =
    Boolean(supplierId) &&
    used.length > 0 &&
    rateOk &&
    !adjustWrong &&
    (dueDate === null || dueDate >= date) &&
    used.every((i) => parsed[i]!.qty && parsed[i]!.qty! > 0 && parsed[i]!.cost !== null) &&
    used.every((i) => !lines[i]!.requiresExpiry || Boolean(lines[i]!.expiry)) &&
    (pastLines.length === 0 || pastOk);

  /** Why «سجّل الفاتورة» waits, in words: the buttons never go grey without a reason */
  const missingExpiry = used.map((i) => lines[i]!).filter((l) => l.requiresExpiry && !l.expiry);
  const notReadyWhy =
    ready || lines.length === 0
      ? null
      : !supplierId
        ? 'اختر المورد ليُسجَّل.'
        : used.length === 0
          ? 'كل الأسطر بكمية صفر. اكتب كمية لسطر واحد على الأقل.'
          : used.some((i) => !(parsed[i]!.qty && parsed[i]!.qty! > 0) || parsed[i]!.cost === null)
            ? 'اكتب الكمية والكلفة لكل صنف ليُسجَّل.'
            : adjustWrong
              ? 'الخصم أكبر من مجموع الفاتورة، أو الرسوم والخصم غير صالحين.'
              : dueDate !== null && dueDate < date
                ? 'تاريخ الاستحقاق قبل تاريخ الفاتورة.'
                : missingExpiry.length > 0
                  ? `اكتب تاريخ الانتهاء لـ ${missingExpiry.map((l) => l.name).join('، ')} ليُسجَّل.`
                  : 'أكّد أن تاريخ الانتهاء الماضي صحيح ليُسجَّل.';

  const withDates = storeSells(me.tenant.sectors, EXPIRY_SECTORS);
  const supplier = suppliers.find((x) => x.id === supplierId);
  const pieces = used.reduce((sum, i) => sum + (parsed[i]!.qty ?? 0), 0);

  function save() {
    // The zero-quantity lines go first, so the lines the server names are the ones still on the screen
    if (skipped > 0) setLines(used.map((i) => lines[i]!));
    void s
      .run(async () => {
        const made = await createPurchase({
          id: docId,
          supplierId,
          date,
          payment,
          reference: reference || null,
          notes: null,
          ...(dueDate ? { dueDate } : {}),
          ...((discountN ?? 0) > 0 ? { discountMinor: discountN! } : {}),
          ...((chargesN ?? 0) > 0 ? { chargesMinor: chargesN! } : {}),
          ...(usd ? { currency: 'USD' as const, rate: rateText(rate) } : {}),
          ...(order
            ? { purchaseOrderId: order.id }
            : draft?.purchaseOrderId
              ? { purchaseOrderId: draft.purchaseOrderId }
              : {}),
          lines: used.map((i) => {
            const l = lines[i]!;
            return {
              variantId: l.variantId,
              qty: parsed[i]!.qty!,
              costMinor: parsed[i]!.cost!,
              batchNo: l.batch?.trim() || null,
              expiryDate: l.expiry || null,
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
        // The invoice is posted; the photo of its paper goes up after it, and a failure there never undoes it
        let photoFailed = false;
        for (const photo of photos) {
          try {
            await addPurchasePhoto(made.id, await resizeImage(photo));
          } catch {
            photoFailed = true;
          }
        }
        return { number: made.number, photoFailed };
      })
      .then((r) => r && onSaved(r.number, r.photoFailed));
  }

  /** The message about one line's serial numbers: its own, or the invoice-wide one that names a number typed on it */
  function serialProblem(i: number): string | undefined {
    const own = s.fields[`lines.${i}.serials`];
    if (own) return own;
    const wide = s.fields.lines;
    const typed = (lines[i]?.serials ?? '').split(/[\n,،]+/).map((x) => x.trim());
    return wide && typed.some((x) => x !== '' && wide.includes(x)) ? wide : undefined;
  }

  return (
    <form
      ref={formRef}
      aria-label="فاتورة شراء"
      className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const doubts = purchaseWarnings(
          used.map((i) => ({
            variantId: lines[i]!.variantId,
            name: lines[i]!.name,
            qty: parsed[i]!.qty,
            // What the sanity check compares is pounds: a dollar cost is converted at the rate
            costMinor:
              usd && parsed[i]!.cost !== null
                ? usdToBase(parsed[i]!.cost!, base, rateText(rate))
                : parsed[i]!.cost,
            priceMinor: lines[i]!.priceMinor ?? null,
          })),
          averages,
        );
        if (doubts.length > 0) {
          setWarnings(doubts);
          return;
        }
        save();
      }}
    >
      {warnings ? (
        <SanityDialog warnings={warnings} onConfirm={save} onClose={() => setWarnings(null)} />
      ) : null}
      <div className="flex min-w-0 flex-col gap-6">
        {s.error ? <Alert tone="error">{s.fields.lines ?? s.error}</Alert> : null}
        {correction ? (
          <Alert tone="info" title={`صُحّحت الفاتورة ${correction.original}`}>
            سُجّل مستند التصحيح{' '}
            <bdi dir="ltr" className="num font-semibold">
              {correction.reversal}
            </bdi>
            : خرجت البضاعة من المخزون بكلفتها ورجع ما للمورد. هذه نسخة من الفاتورة بالقيم القديمة: صحّح ما
            يلزم ثم اضغط «سجّل الفاتورة».
          </Alert>
        ) : null}
        {order ? (
          <Alert tone="info">
            استلام من الطلبية{' '}
            <bdi dir="ltr" className="num font-semibold">
              {order.number}
            </bdi>
            : وضعنا الباقي منها فقط. عدّل الكمية والكلفة بما وصل فعلاً، وما لم يصل يبقى على الطلبية.
          </Alert>
        ) : null}
        <Card>
          <CardHeader
            icon={<TruckIcon />}
            title="المورد والتاريخ"
            description="من أين جاءت البضاعة، ومتى، وبأي رقم كتبها المورد."
          />
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
            <Select
              label="المورد"
              value={supplierId}
              disabled={Boolean(order)}
              onChange={(e) => setSupplierId(e.target.value)}
              error={s.fields.supplierId}
            >
              {supplierId ? null : <option value="">اختر المورد</option>}
              {suppliers
                .filter((sup) => !sup.archived || sup.id === supplierId)
                .map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name}
                  </option>
                ))}
            </Select>
            <DateField label="التاريخ" value={date} onChange={setDate} required />
            <CurrencyTerms
              label="عملة الفاتورة"
              currency={currency}
              onCurrency={setCurrency}
              rate={rate}
              onRate={setRate}
              storeRate={storeRate}
              error={s.fields.rate ?? s.fields.currency}
            />
            <TextField
              label="رقم فاتورة المورد"
              hint="اختياري"
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            {payment === 'credit' ? (
              <DateField
                label="تاريخ الاستحقاق"
                value={dueDate ?? ''}
                onChange={(iso) => setDueTyped(iso || '')}
                error={s.fields.dueDate}
                hint={
                  termsDays !== null && dueTyped === null
                    ? `من أيام سداد المورد (${termsDays})`
                    : 'اختياري: تظهر في «مستحق هذا الأسبوع»'
                }
              />
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<ProductsIcon />}
            title="الأصناف"
            description={
              usd
                ? 'ابحث بالاسم أو امسح الباركود. اكتب كلفة الوحدة أو مجموع السطر بالدولار، والآخر يتبعه.'
                : 'ابحث بالاسم أو امسح الباركود. اكتب كلفة الوحدة أو مجموع السطر بالليرة، والآخر يتبعه.'
            }
          />
          <div className="flex flex-col gap-4">
            <VariantPicker
              onPick={(v) => {
                // only a line that is really added gets the cursor
                focusNew.current =
                  !lines.some((l) => l.variantId === v.variantId) ||
                  withDates ||
                  allFields ||
                  !!v.requiresExpiry;
                setLines((list) =>
                  // The same item twice is allowed where batches are kept: each on its own line, with its batch
                  list.some((l) => l.variantId === v.variantId) &&
                  !(withDates || allFields || v.requiresExpiry)
                    ? list
                    : [...list, { ...v, qty: '', packQty: 1000, cost: '', batch: '', expiry: '' }],
                );
              }}
              unitFor={(ids) => {
                const usual = usualUnitOf(averages, ids);
                return usual ? moneyText(Math.round(usual)) : '';
              }}
              onPickGrid={(picked) =>
                setLines((list) => [
                  ...list.filter((l) => !picked.some((p) => p.variantId === l.variantId)),
                  ...picked.map((p) => ({ ...p, packQty: 1000, batch: '', expiry: '' })),
                ])
              }
            />
            {lines.length > 0 && !withDates ? (
              <Switch
                label="الدفعة وتاريخ الانتهاء"
                checked={allFields}
                onCheckedChange={setAllFields}
                className="self-end"
              />
            ) : null}
            {lines.length > 0 ? (
              <LinesTable
                label="أصناف الفاتورة"
                head={
                  <LinesHead className={LINE_COLUMNS}>
                    <span>الصنف</span>
                    <span>الكمية</span>
                    <span>كلفة الوحدة</span>
                    <span>مجموع الكلفة</span>
                    <span />
                  </LinesHead>
                }
              >
                {lines.map((l, i) => {
                  const p = parsed[i]!;
                  const pack = l.packs?.find((x) => x.qty === l.packQty) ?? null;
                  const unit =
                    p.qty && p.qty > 0 && p.cost !== null ? Math.round(p.cost / (p.qty / 1000)) : null;
                  const showDates =
                    withDates ||
                    allFields ||
                    l.requiresExpiry === true ||
                    Boolean(l.batch || l.expiry || s.fields[`lines.${i}.expiryDate`]);
                  // Serial numbers only for a product that tracks them (one number per piece)
                  const showSerials = l.tracksSerial === true || Boolean(l.serials || serialProblem(i));
                  return (
                    <li key={`${l.variantId}-${i}`} className="flex flex-col gap-3 px-4 py-3">
                      <div
                        className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 md:items-center ${LINE_COLUMNS}`}
                      >
                        <div className="col-span-2 flex min-w-0 flex-col md:col-span-1">
                          <span title={l.name} className="line-clamp-2 leading-snug font-semibold text-ink">
                            {l.name}
                          </span>
                          {pack && p.qty ? (
                            <span className="text-xs text-ink-subtle">
                              {packSummary(qtyOf(l.qty) ?? 0, pack, (q) => formatQuantity(q, digits))}
                            </span>
                          ) : null}
                          {unit !== null ? (
                            <span className="text-xs text-ink-subtle">
                              كلفة القطعة <Money minor={unit} currency={invoiceCurrency} />
                            </span>
                          ) : null}
                        </div>
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
                            error={s.fields[`lines.${i}.qty`]}
                          />
                        </div>
                        <div className="col-start-1 row-start-3 md:col-start-auto md:row-start-auto">
                          <Caption>{pack ? `كلفة ${pack.name}` : 'كلفة الوحدة'}</Caption>
                          <NumberField
                            label={`كلفة وحدة ${l.name}`}
                            hideLabel
                            placeholder="كلفة الوحدة"
                            decimals={2}
                            value={l.unitCost ?? ''}
                            onValueChange={(unitCost) =>
                              setLines((all) =>
                                all.map((x, j) => (j === i ? withPackChange(x, { unitCost }) : x)),
                              )
                            }
                          />
                        </div>
                        <div className="col-span-2 col-start-2 row-start-3 md:col-span-1 md:col-start-auto md:row-start-auto">
                          <Caption>مجموع الكلفة</Caption>
                          <NumberField
                            label={`كلفة ${l.name}`}
                            hideLabel
                            placeholder="مجموع الكلفة"
                            decimals={2}
                            value={l.cost}
                            onValueChange={(cost) =>
                              setLines((all) =>
                                all.map((x, j) => (j === i ? withPackChange(x, { cost }) : x)),
                              )
                            }
                            error={s.fields[`lines.${i}.costMinor`]}
                          />
                          {p.cost !== null && p.cost > 0 ? (
                            <span className="mt-1 block text-xs text-ink-subtle">
                              <Money minor={p.cost} currency={invoiceCurrency} />
                              {usd ? (
                                <>
                                  {' ≈ '}
                                  <Money
                                    minor={usdToBase(p.cost, base, rateText(rate)) ?? 0}
                                    currency={base}
                                  />
                                </>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                        <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto">
                          <RemoveLine
                            name={l.name}
                            onRemove={() => setLines((all) => all.filter((_, j) => j !== i))}
                          />
                        </div>
                      </div>
                      {showDates || showSerials ? (
                        <div className="grid grid-cols-1 gap-3 rounded-control bg-surface-muted/60 p-3 sm:grid-cols-2">
                          {showDates ? (
                            <>
                              <div>
                                <Caption always>رقم الدفعة (اختياري)</Caption>
                                <TextField
                                  label={`دفعة ${l.name}`}
                                  hideLabel
                                  dir="ltr"
                                  value={l.batch ?? ''}
                                  onChange={(e) =>
                                    setLines((all) =>
                                      all.map((x, j) => (j === i ? { ...x, batch: e.target.value } : x)),
                                    )
                                  }
                                />
                              </div>
                              <div>
                                <DateField
                                  label={
                                    l.requiresExpiry ? 'تاريخ الانتهاء (مطلوب)' : 'تاريخ الانتهاء (اختياري)'
                                  }
                                  value={l.expiry ?? ''}
                                  onChange={(iso) =>
                                    setLines((all) =>
                                      all.map((x, j) => (j === i ? { ...x, expiry: iso } : x)),
                                    )
                                  }
                                  error={s.fields[`lines.${i}.expiryDate`]}
                                />
                                {l.expiry && l.expiry < todayDay ? (
                                  <p role="status" className="mt-1 text-xs font-semibold text-warning-ink">
                                    هذا التاريخ مضى: الدفعة منتهية الصلاحية. تأكد منه قبل الحفظ.
                                  </p>
                                ) : null}
                              </div>
                            </>
                          ) : null}
                          {showSerials ? (
                            <label className="flex flex-col gap-1.5 sm:col-span-2">
                              <span className="text-xs font-semibold text-ink-subtle">
                                {serialWord(me.tenant.sectors) === 'الرقم التسلسلي'
                                  ? 'الأرقام التسلسلية'
                                  : 'الأرقام التسلسلية أو IMEI'}{' '}
                                (رقم في كل سطر، للأجهزة)
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
                                aria-invalid={serialProblem(i) ? true : undefined}
                                className={`num rounded-control border bg-surface px-3 py-2 text-[0.9375rem] text-ink transition-[border-color,box-shadow] duration-120 ease-standard hover:border-ink-subtle focus:border-brand focus:outline-hidden ${serialProblem(i) ? 'border-danger' : 'border-line-control'}`}
                              />
                              {serialProblem(i) ? (
                                <span className="text-sm text-danger-ink">{serialProblem(i)}</span>
                              ) : null}
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </LinesTable>
            ) : (
              <EmptyState
                icon={PackageOpenIcon}
                title="الفاتورة فارغة."
                description={
                  storeSells(me.tenant.sectors, ['clothing'])
                    ? 'ابحث عن صنف بالأعلى؛ الموديل بمقاساته وألوانه يفتح جدولاً تكتب فيه الكميات دفعة واحدة.'
                    : 'ابحث عن صنف بالأعلى لتضيفه إلى الفاتورة، ثم اكتب الكمية والكلفة.'
                }
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<BookIcon />}
            title="الخصم والرسوم والورقة"
            description="ما كتبه المورد على ورقته: خصم نقدي، أو أجور شحن. تتوزّع على كلفة الأصناف، فيبقى سعر البيع والمخزون صحيحين."
          />
          <PaperFields
            unit={usd ? 'دولار' : 'ليرة'}
            discount={discount}
            onDiscount={setDiscount}
            percent={percent}
            onPercent={setPercent}
            discountError={
              s.fields.discountMinor ??
              (discountTyped === null
                ? 'اكتب رقماً صحيحاً'
                : (discountN ?? 0) > gross
                  ? percent
                    ? 'أكبر من 100%'
                    : 'أكبر من مجموع الفاتورة'
                  : undefined)
            }
            discountAmount={percent ? (discountN ?? 0) : null}
            charges={charges}
            onCharges={setCharges}
            chargesError={s.fields.chargesMinor ?? (chargesN === null ? 'اكتب مبلغاً صحيحاً' : undefined)}
            photos={photos}
            onPhotos={setPhotos}
            renderMoney={(m) => <Money minor={m} currency={invoiceCurrency} />}
          />
        </Card>
        <PurchasePaymentCard payment={payment} onPayment={setPayment} usd={usd} total={total} />
      </div>
      {/* The totals stay in view: beside the form on a wide screen, over the bottom edge on a phone. */}
      <PurchaseTotals
        supplier={supplier}
        base={base}
        usd={usd}
        rate={rate}
        payment={payment}
        dueDate={dueDate}
        adjusted={adjusted}
        gross={gross}
        discountN={discountN}
        chargesN={chargesN}
        invoiceCurrency={invoiceCurrency}
        usedCount={used.length}
        pieces={pieces}
        total={total}
        totalBase={totalBase}
        saving={s.saving}
        ready={ready}
        notReadyWhy={notReadyWhy}
        onCancel={onCancel}
        pastNames={pastLines.map((l) => l.name)}
        pastOk={pastOk}
        onPastOk={setPastOk}
        skipped={skipped}
        fromOrder={Boolean(order)}
      />
    </form>
  );
}
