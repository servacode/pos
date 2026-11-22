import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  addDays,
  packOptionsOf,
  priceQuotation,
  QUOTATION_DEFAULT_DAYS,
  QUOTATION_NEXT,
  QUOTATION_STATUS_LABELS,
  type Quotation,
  type QuotationData,
  type QuotationStatus,
  type StoreResponse,
  type TaxRate,
  type Unit,
} from '@serva/core';
import {
  Alert,
  BackIcon,
  Badge,
  Button,
  Card,
  DeleteIcon,
  IconButton,
  ListIcon,
  Money,
  PageHeader,
  PrintIcon,
  SearchField,
  SendIcon,
  SkeletonText,
  TextField,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { QuotationA4 } from '../../lib/a4/documents';
import { ReportScreen } from '../reports/parts';
import { ApiError, errorMessage } from '../../lib/api';
import { dayText, isoDay } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { getProduct, listTaxRates, listUnits } from '../catalog/api';
import { getCustomer, listCustomers } from '../customers/api';
import { PackQty } from '../purchases/PackQty';
import { getStore } from '../store/api';
import { createQuotation, getCustomerPricing, getQuotation, moveQuotation, updateQuotation } from './api';
import { ItemPicker } from './ItemPicker';
import { quotationMessage, quotationWhatsappLink } from './share';
import {
  customerPackPrice,
  editorLineOf,
  formSignature,
  lineInput,
  moneyText,
  percentOf,
  priceForCustomer,
  savedSignature,
  type CustomerPricing,
  type EditorLine,
} from './lines';
import { QUOTATION_TONES } from './QuotationsPage';
import { DateField } from '../../lib/DateField';

/** The words of each step button: what happened, not the state it reaches */
const STEP_LABEL: Partial<Record<QuotationStatus, string>> = {
  sent: 'أُرسل للزبون',
  accepted: 'وافق الزبون',
  expired: 'انتهى العرض',
  draft: 'أعده مسودة',
};

const NOTES_CLASS =
  'w-full resize-y rounded-control border border-line-control bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink caret-brand transition-[border-color,box-shadow] duration-120 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:outline-hidden pointer-coarse:text-base';

/** The fields this page marks itself; any other message the server gives is shown in the alert on top */
const MARKED = new Set([
  'validUntil',
  'customerName',
  'customerPhone',
  'customerTaxNumber',
  'customerAddress',
  'notes',
  'terms',
  'lines',
]);

/**
 * One quotation (03 › الجملة: عرض السعر): customer, lines with their pack, price and discount, the
 * day the prices stand until, notes and terms. Saved it has its number; from here it is sent,
 * accepted, printed on A4 or turned into an invoice at the till. Nothing here posts or moves stock.
 */
export function QuotationPage() {
  const { id } = useParams();
  const isNew = id === undefined || id === 'new';
  const me = useMe();
  const navigate = useNavigate();
  const { paper, print } = usePrint();
  const digits = useDigits();
  const currency = me.settings.baseCurrency;

  const [saved, setSaved] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [store, setStore] = useState<StoreResponse | null>(null);

  const [customerId, setCustomerId] = useState<string | null>(null);
  // The free fields are for a customer who is not registered: they open on request, or by themselves once filled
  const [freeOpen, setFreeOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerTaxNumber, setCustomerTaxNumber] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const anyFree = Boolean(customerName || customerPhone || customerTaxNumber || customerAddress);
  useEffect(() => {
    if (anyFree) setFreeOpen(true);
  }, [anyFree]);
  // The store's own day, not the browser's: the server counts the days from the same one
  const today = isoDay(Date.now(), me.tenant.timezone);
  const [validUntil, setValidUntil] = useState(() => addDays(today, QUOTATION_DEFAULT_DAYS));
  const [invoiceDiscount, setInvoiceDiscount] = useState<QuotationData['invoiceDiscount']>(null);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [pricing, setPricing] = useState<CustomerPricing | null>(null);
  const [customerQ, setCustomerQ] = useState('');
  const [noTill, setNoTill] = useState(false);
  const [customerHits, setCustomerHits] = useState<{ id: string; name: string }[]>([]);

  const locked = saved?.status === 'converted';

  // A saved quotation opens at its top, not where the save button was
  const savedVersion = saved ? `${saved.id}:${String(saved.version)}` : null;
  useEffect(() => {
    if (!savedVersion) return;
    document.scrollingElement?.scrollTo?.({ top: 0 });
    for (const box of document.querySelectorAll('main')) box.scrollTo?.({ top: 0 });
  }, [savedVersion]);

  useEffect(() => {
    void listTaxRates().then(
      (r) => setTaxRates(r.items),
      () => undefined,
    );
    void listUnits().then(
      (r) => setUnits(r.items),
      () => undefined,
    );
    void getStore().then(setStore, () => undefined);
  }, []);

  function fill(q: Quotation) {
    setSaved(q);
    setCustomerId(q.customerId);
    setCustomerName(q.customerName ?? '');
    setCustomerPhone(q.customerPhone ?? '');
    setCustomerTaxNumber(q.customerTaxNumber ?? '');
    setCustomerAddress(q.customerAddress ?? '');
    setValidUntil(q.validUntil);
    setInvoiceDiscount(q.invoiceDiscount ?? null);
    setNotes(q.notes ?? '');
    setTerms(q.terms ?? '');
    setLines(q.lines.map(editorLineOf));
    void showItemPacks(q);
    if (q.customerId) void loadPricing(q.customerId, false);
  }

  /**
   * A saved line keeps only the pack it was typed in, so its unit shows from that; here the item's own
   * packs are read to show the whole pick. Display only: no price or quantity changes.
   */
  async function showItemPacks(q: Quotation) {
    const productIds = [...new Set(q.lines.map((l) => l.productId).filter((p): p is string => !!p))];
    for (const productId of productIds) {
      try {
        const detail = await getProduct(productId);
        setLines((list) =>
          list.map((l) => {
            const variant = detail.variants.find((v) => v.id === l.variantId);
            if (l.productId !== productId || !variant) return l;
            const packs = packOptionsOf(variant.barcodes);
            return packs.some((p) => p.qty === l.packQty) || l.packQty === 1000 ? { ...l, packs } : l;
          }),
        );
      } catch {
        // The unit the line was saved with stays
      }
    }
  }

  useEffect(() => {
    if (isNew) return;
    let alive = true;
    getQuotation(id)
      .then((q) => alive && fill(q))
      .catch((e: unknown) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, isNew]);

  useEffect(() => {
    if (customerQ.trim().length < 2) {
      setCustomerHits([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      listCustomers(customerQ.trim())
        .then((r) => alive && setCustomerHits(r.items.filter((c) => !c.archived).slice(0, 6)))
        .catch(() => alive && setCustomerHits([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [customerQ]);

  /** The customer's tier and contract prices; `reprice` quotes the lines already added at them */
  function loadPricing(forCustomer: string, reprice: boolean) {
    return getCustomerPricing(forCustomer).then(
      (r) => {
        const next: CustomerPricing = {
          tier: r.priceTier,
          contracts: new Map(
            r.items.filter((p) => p.currency === currency).map((p) => [p.variantId, p.priceMinor]),
          ),
        };
        setPricing(next);
        if (reprice) setLines((list) => list.map((l) => priceForCustomer(l, next)));
      },
      () => undefined,
    );
  }

  async function pickCustomer(c: { id: string; name: string }) {
    setCustomerQ('');
    setCustomerHits([]);
    setCustomerId(c.id);
    setCustomerName(c.name);
    // Quote at what this customer pays: the contract prices and the wholesale tier
    void loadPricing(c.id, true);
    try {
      const full = await getCustomer(c.id);
      setCustomerPhone(full.phone ?? '');
      setCustomerTaxNumber(full.taxNumber ?? '');
      setCustomerAddress(full.address ?? '');
    } catch {
      // The server fills what is left empty from the card when it saves
    }
  }

  function setLine(key: number, patch: Partial<EditorLine>) {
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function changePack(l: EditorLine, packQty: number) {
    const pack = l.packs?.find((p) => p.qty === packQty);
    const price = customerPackPrice(l, packQty, pricing);
    setLine(l.key, {
      packQty,
      packName: pack ? `${pack.name} ${pack.qty / 1000}` : null,
      ...(price === null ? {} : { price: moneyText(price) }),
    });
  }

  /** The lines as the server takes them, or the first thing wrong */
  const built = useMemo(() => {
    const out: QuotationData['lines'] = [];
    for (const [i, l] of lines.entries()) {
      const r = lineInput(l);
      if ('error' in r) return { lines: null, error: { key: l.key, index: i, field: r.error } };
      out.push(r as QuotationData['lines'][number]);
    }
    return { lines: out, error: null };
  }, [lines]);

  /** The totals as the server will work them out, with the till's own engine */
  const preview = useMemo(() => {
    if (!built.lines || built.lines.length === 0) return null;
    try {
      return priceQuotation(built.lines, invoiceDiscount, me.settings.taxInclusive);
    } catch {
      return null;
    }
  }, [built, invoiceDiscount, me.settings.taxInclusive]);

  const body = () => ({
    customerId,
    customerName: customerName.trim() || null,
    customerPhone: customerPhone.trim() || null,
    customerTaxNumber: customerTaxNumber.trim() || null,
    customerAddress: customerAddress.trim() || null,
    validUntil,
    notes: notes.trim() || null,
    terms: terms.trim() || null,
    // Kept as the till or the last save left it: leaving it out would wipe it
    invoiceDiscount,
    lines: built.lines ?? [],
  });

  /** Anything typed since the last save (or since it was opened) */
  const dirty = useMemo(
    () =>
      saved !== null &&
      saved.status !== 'converted' &&
      formSignature({
        customerId,
        customerName,
        customerPhone,
        customerTaxNumber,
        customerAddress,
        validUntil,
        notes,
        terms,
        invoiceDiscount,
        lines: built.lines,
      }) !== savedSignature(saved),
    [
      saved,
      customerId,
      customerName,
      customerPhone,
      customerTaxNumber,
      customerAddress,
      validUntil,
      notes,
      terms,
      invoiceDiscount,
      built,
    ],
  );

  /** What is wrong with the form before it is sent, each on its own field; false when something is */
  function check(): boolean {
    setError(null);
    const marks: Record<string, string> = {};
    if (!validUntil) marks.validUntil = 'اكتب آخر يوم تسري فيه الأسعار';
    else if (validUntil < today) marks.validUntil = 'آخر يوم للعرض قبل اليوم. اختر تاريخاً من اليوم أو بعده';
    setFieldErrors(marks);
    if (Object.keys(marks).length > 0) {
      setError('تحقّق من الحقول المظلّلة.');
      return false;
    }
    if (built.error) {
      const what = { qty: 'الكمية', price: 'السعر', discount: 'الخصم' }[built.error.field];
      setError(`تحقّق من ${what} في السطر ${built.error.index + 1}.`);
      return false;
    }
    if (lines.length === 0) {
      setError('أضف صنفاً واحداً على الأقل.');
      return false;
    }
    return true;
  }

  /** What the server said, put where it belongs: on its field when the page has one, else in the alert on top */
  function showServerError(e: unknown) {
    if (e instanceof ApiError && e.fields) {
      setFieldErrors(e.fields);
      const loose = Object.entries(e.fields)
        .filter(([key]) => !MARKED.has(key))
        .map(([, message]) => message);
      setError(loose.length > 0 ? loose.join('. ') : errorMessage(e));
    } else setError(errorMessage(e));
  }

  // The first field that is marked comes into view: the alert is on top, the field may be far below
  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    const field = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.scrollIntoView?.({ block: 'center' });
    field?.focus?.({ preventScroll: true });
  }, [fieldErrors]);

  /** Saves the form over the saved offer; null (with the reason on screen) when it could not be */
  async function writeBack(): Promise<Quotation | null> {
    if (!saved || !check()) return null;
    try {
      const made = await updateQuotation(saved.id, { ...body(), version: saved.version });
      fill(made);
      return made;
    } catch (e) {
      showServerError(e);
      return null;
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    if (!check()) return;
    setBusy(true);
    try {
      if (isNew) {
        const made = await createQuotation(body());
        void navigate(`/quotations/${made.id}`, { replace: true });
      } else {
        await writeBack();
      }
    } catch (e) {
      showServerError(e);
    } finally {
      setBusy(false);
    }
  }

  /** A status button: what was typed and not saved is saved first, so the move never wipes it */
  async function move(status: QuotationStatus) {
    if (!saved) return;
    setError(null);
    setBusy(true);
    try {
      let version = saved.version;
      if (dirty) {
        const made = await writeBack();
        if (!made) return;
        version = made.version;
      }
      fill(await moveQuotation(saved.id, status, version));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** The till takes a quotation only in a browser that is paired as one: ask first, never land on the pairing screen blind */
  async function toTill(quotationId: string) {
    setNoTill(false);
    if (dirty) {
      setBusy(true);
      const made = await writeBack();
      setBusy(false);
      if (!made) return;
    }
    try {
      const [{ deviceStore }, { loadDevice }] = await Promise.all([
        import('../../offline/database'),
        import('../../offline/device'),
      ]);
      if (!(await loadDevice(deviceStore()))) {
        setNoTill(true);
        return;
      }
    } catch {
      // Cannot tell: let the till decide
    }
    void navigate(`/pos?quotation=${quotationId}`);
  }

  const next = saved ? QUOTATION_NEXT[saved.status] : [];
  const stillStands = saved ? saved.validUntil >= today : false;
  const totals = saved && !preview ? saved.totals : preview?.totals;
  const quotationForPrint: Quotation | null = saved
    ? preview
      ? {
          ...saved,
          lines: preview.lines,
          totals: preview.totals,
          validUntil,
          invoiceDiscount,
          notes: notes || null,
          terms: terms || null,
        }
      : saved
    : null;

  /** The offer as it is on screen, in a WhatsApp message to the customer's phone (or to a chat chosen there) */
  function sendWhatsapp() {
    if (!quotationForPrint) return;
    const link = quotationWhatsappLink(
      customerPhone,
      quotationMessage(quotationForPrint, store?.name ?? null),
    );
    window.open(link, '_blank', 'noopener');
  }
  const phoneOk = !quotationWhatsappLink(customerPhone, '').startsWith('https://wa.me/?');

  return (
    <ReportScreen me={me} access={['customers.manage']} title={saved ? saved.number : 'عرض سعر جديد'}>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title={saved ? `عرض السعر ${saved.number}` : 'عرض سعر جديد'}
          description="لا يسجّل العرض بيعاً ولا يحرّك المخزون. «حوّل إلى فاتورة» يفتحه في شاشة الكاشير ليُباع من هناك."
          icon={<ListIcon />}
          actions={
            <Button variant="secondary" icon={<BackIcon />} onClick={() => void navigate('/quotations')}>
              كل العروض
            </Button>
          }
        />
        {loading ? <SkeletonText lines={6} /> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        {saved?.status === 'expired' ? (
          stillStands ? (
            <Alert tone="warning">
              أُنهي هذا العرض قبل موعده (أسعاره كانت صالحة حتى {dayText(saved.validUntil, digits)}). اضغط
              «أُرسل للزبون» ليعود مفتوحاً.
            </Alert>
          ) : (
            <Alert tone="warning">
              انتهت صلاحية هذا العرض في {dayText(saved.validUntil, digits)}. غيّر «صالح حتى» واحفظ ليعود
              مفتوحاً.
            </Alert>
          )
        ) : null}
        {noTill && saved ? (
          <Alert tone="info" title="هذا المتصفح غير مربوط بكاشير">
            <span className="flex flex-col gap-2">
              <span>
                لتحويل العرض إلى فاتورة: افتح شاشة الكاشير على جهازه، واختر «عروض الأسعار» ثم هذا العرض. أو
                اربط هذا المتصفح بالكاشير أولاً.
              </span>
              <Link
                to={`/pos?quotation=${saved.id}`}
                className="w-fit font-semibold text-brand-ink underline underline-offset-4"
              >
                اربط هذا المتصفح بالكاشير
              </Link>
            </span>
          </Alert>
        ) : null}
        {locked ? (
          <Alert tone="info">
            حُوّل هذا العرض إلى فاتورة، فلا يُعدَّل. اضغط «أعده مرسلاً» لفتحه من جديد.
          </Alert>
        ) : null}
        {!loading ? (
          <form noValidate onSubmit={(e) => void save(e)} className="flex flex-col gap-6">
            {saved ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={QUOTATION_TONES[saved.status]}>{QUOTATION_STATUS_LABELS[saved.status]}</Badge>
                {next.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={s === 'converted' ? 'primary' : 'secondary'}
                    loading={busy}
                    onClick={() => (s === 'converted' ? void toTill(saved.id) : void move(s))}
                  >
                    {s === 'converted'
                      ? 'حوّل إلى فاتورة'
                      : s === 'sent' && locked
                        ? 'أعده مرسلاً'
                        : STEP_LABEL[s]}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={<PrintIcon />}
                  onClick={() => print('A4')}
                >
                  PDF / اطبع A4
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={<SendIcon />}
                  disabled={!quotationForPrint}
                  onClick={sendWhatsapp}
                >
                  أرسل واتساب
                </Button>
                {phoneOk ? null : (
                  <span className="text-xs text-ink-muted">لا رقم للزبون: واتساب يسألك لمن ترسل.</span>
                )}
                {dirty ? (
                  <span className="text-xs text-warning-ink">
                    فيه تعديلات غير محفوظة: تُحفظ عند تغيير الحالة.
                  </span>
                ) : null}
              </div>
            ) : null}

            <Card className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">الزبون</h2>
              <div className="relative">
                <SearchField
                  label="ابحث عن زبون مسجّل"
                  value={customerQ}
                  onValueChange={setCustomerQ}
                  disabled={locked}
                />
                {customerHits.length > 0 ? (
                  <ul
                    aria-label="الزبائن"
                    className="absolute inset-x-0 z-10 mt-1 flex flex-col rounded-card border border-line bg-surface p-1.5 shadow-e2"
                  >
                    {customerHits.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => void pickCustomer(c)}
                          className="w-full rounded-small px-2.5 py-2 text-start font-semibold text-ink hover:bg-surface-muted"
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {!freeOpen &&
              !customerName &&
              !customerPhone &&
              !customerTaxNumber &&
              !customerAddress &&
              !fieldErrors.customerName ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  disabled={locked}
                  onClick={() => setFreeOpen(true)}
                >
                  زبون غير مسجّل: اكتب بياناته
                </Button>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="اسم الزبون أو الجهة"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    error={fieldErrors.customerName}
                    disabled={locked}
                  />
                  <TextField
                    label="هاتف الزبون"
                    dir="ltr"
                    inputClassName="num"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    error={fieldErrors.customerPhone}
                    disabled={locked}
                  />
                  <TextField
                    label="الرقم الضريبي للزبون"
                    dir="ltr"
                    inputClassName="num"
                    value={customerTaxNumber}
                    onChange={(e) => setCustomerTaxNumber(e.target.value)}
                    error={fieldErrors.customerTaxNumber}
                    disabled={locked}
                  />
                  <TextField
                    label="عنوان الزبون"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    error={fieldErrors.customerAddress}
                    disabled={locked}
                  />
                </div>
              )}
            </Card>

            <Card className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">الأصناف</h2>
              {!locked ? (
                <ItemPicker
                  currency={currency}
                  taxRates={taxRates}
                  units={units}
                  onError={setError}
                  onPick={(line) => setLines((list) => [...list, priceForCustomer(line, pricing)])}
                />
              ) : null}
              {fieldErrors.lines ? <Alert tone="error">{fieldErrors.lines}</Alert> : null}
              {lines.length > 0 ? (
                <ul aria-label="أصناف العرض" className="flex flex-col divide-y divide-line">
                  {lines.map((l) => {
                    const bad = built.error?.key === l.key ? built.error.field : null;
                    return (
                      <li
                        key={l.key}
                        className="grid items-start gap-3 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_6rem_auto]"
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="font-semibold text-ink">{l.name}</span>
                          <span className="text-xs text-ink-muted">
                            {l.taxRateBp > 0 ? `ضريبة ${l.taxRateBp / 100}%` : 'بلا ضريبة'}
                          </span>
                        </div>
                        <PackQty
                          name={l.name}
                          packs={l.packs}
                          qty={l.qty}
                          packQty={l.packQty}
                          onChange={(patch) => {
                            if (patch.qty !== undefined) setLine(l.key, { qty: patch.qty });
                            if (patch.packQty !== undefined) changePack(l, patch.packQty);
                          }}
                          error={bad === 'qty' ? 'كمية غير صحيحة' : undefined}
                        />
                        <TextField
                          label={`سعر ${l.name}`}
                          hideLabel
                          inputMode="decimal"
                          dir="ltr"
                          inputClassName="num"
                          value={l.price}
                          onChange={(e) => setLine(l.key, { price: e.target.value })}
                          error={bad === 'price' ? 'سعر غير صحيح' : undefined}
                          disabled={locked}
                        />
                        <TextField
                          label={`خصم ${l.name} بالمئة`}
                          hideLabel
                          inputMode="decimal"
                          dir="ltr"
                          inputClassName="num"
                          placeholder="خصم %"
                          value={l.discount}
                          onChange={(e) => setLine(l.key, { discount: e.target.value })}
                          error={percentOf(l.discount) === null ? 'خصم غير صحيح' : undefined}
                          disabled={locked}
                        />
                        {!locked ? (
                          <IconButton
                            label={`احذف ${l.name}`}
                            icon={<DeleteIcon />}
                            onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">ابحث عن صنف فوق لتضيفه.</p>
              )}
              {totals ? (
                <dl className="ms-auto flex w-fit min-w-40 max-w-full flex-col gap-1 text-sm">
                  {totals.invoiceDiscountMinor > 0 ? (
                    <>
                      {totals.lineDiscountMinor > 0 ? (
                        <div className="flex justify-between gap-6">
                          <dt>خصم الأسطر</dt>
                          <dd>
                            <Money minor={totals.lineDiscountMinor} currency={currency} />
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-6">
                        <dt className="flex items-center gap-2">
                          خصم الفاتورة
                          {locked ? null : (
                            <Button variant="ghost" size="xs" onClick={() => setInvoiceDiscount(null)}>
                              ألغِه
                            </Button>
                          )}
                        </dt>
                        <dd>
                          <Money minor={totals.invoiceDiscountMinor} currency={currency} />
                        </dd>
                      </div>
                    </>
                  ) : totals.discountMinor > 0 ? (
                    <div className="flex justify-between gap-6">
                      <dt>الخصم</dt>
                      <dd>
                        <Money minor={totals.discountMinor} currency={currency} />
                      </dd>
                    </div>
                  ) : null}
                  {totals.taxMinor > 0 ? (
                    <div className="flex justify-between gap-6">
                      <dt>{me.settings.taxInclusive ? 'منها ضريبة' : 'الضريبة'}</dt>
                      <dd>
                        <Money minor={totals.taxMinor} currency={currency} />
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-6 border-t border-line pt-1 text-base font-bold">
                    <dt>الإجمالي</dt>
                    <dd>
                      <Money minor={totals.totalMinor} currency={currency} />
                    </dd>
                  </div>
                </dl>
              ) : null}
            </Card>

            <Card className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ink">الصلاحية والشروط</h2>
              <DateField
                label="صالح حتى"
                value={validUntil}
                onChange={setValidUntil}
                error={fieldErrors.validUntil}
                disabled={locked}
                className="sm:w-60"
              />
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink-muted">
                ملاحظات
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={NOTES_CLASS}
                  aria-invalid={fieldErrors.notes ? true : undefined}
                  disabled={locked}
                />
                {fieldErrors.notes ? (
                  <span className="text-sm text-danger-ink">{fieldErrors.notes}</span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink-muted">
                الشروط (الدفع، التسليم، الضمان)
                <textarea
                  rows={3}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  className={NOTES_CLASS}
                  aria-invalid={fieldErrors.terms ? true : undefined}
                  disabled={locked}
                />
                {fieldErrors.terms ? (
                  <span className="text-sm text-danger-ink">{fieldErrors.terms}</span>
                ) : null}
              </label>
            </Card>

            {!locked ? (
              <div className="flex gap-3">
                <Button type="submit" loading={busy}>
                  {isNew ? 'احفظ العرض' : 'احفظ التعديلات'}
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
        {paper === 'A4' && quotationForPrint && store ? (
          <PrintSheet paper="A4">
            <QuotationA4
              quotation={quotationForPrint}
              store={{
                name: store.name,
                taxNumber: store.taxNumber,
                branchName: null,
                address: store.address,
                phone: store.phone,
                footer: null,
              }}
            />
          </PrintSheet>
        ) : null}
      </div>
    </ReportScreen>
  );
}
