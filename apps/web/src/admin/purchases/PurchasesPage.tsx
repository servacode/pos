import { Link, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  contactPhoneSchema,
  orderLineCost,
  orderLineRemaining,
  packOptionsOf,
  rateText,
  type PurchaseCurrencyCode,
  type PurchaseDraft,
  type PurchaseOrderDetail,
  type PurchasePayment,
  type PurchaseRow,
  type SupplierListResponse,
  type SupplierRow,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  BookIcon,
  Button,
  Card,
  CardHeader,
  CashIcon,
  ChequeIcon,
  ChoiceCard,
  Dialog,
  EmptyState,
  formatQuantity,
  IconButton,
  Menu,
  MenuItem,
  Money,
  MoreIcon,
  NumberField,
  PackageOpenIcon,
  PrintIcon,
  ProductsIcon,
  RadioGroup,
  SearchField,
  Select,
  Switch,
  TextField,
  TruckIcon,
  useDigits,
  UserIcon,
  type BadgeTone,
  type Icon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, monthStart } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { ApiError, errorMessage } from '../../lib/api';
import { DateField } from '../../lib/DateField';
import { EXPIRY_SECTORS, serialWord, storeSells } from '../../lib/sectors';
import {
  addPurchasePhoto,
  createPurchase,
  createSupplier,
  getInventory,
  listPurchasePage,
  listSuppliers,
  moneyOf,
  newDocumentId,
  openSupplierBalance,
  paySupplier,
  qtyOf,
  storeToday,
  type PurchaseFilters,
} from './api';
import { Caption, LinesHead, LinesTable, RemoveLine } from './parts';
import { Pager, useCursorPages } from '../pager';
import { ReportScreen } from '../reports/parts';
import { addDays } from '../reports/periods';
import { Amt, DownloadGlyph, PageTop, Panel, SalesPage, SxTable, type SxColumn } from '../sales/ui';
import { InvoiceStatus, PAYMENT_TEXT } from './pui';
import { dropCorrection, keepCorrection, keptCorrection, type KeptCorrection } from './correctionDraft';
import { PackQty } from './PackQty';
import { SanityDialog } from './SanityDialog';
import { PurchaseDetailDialog } from './PurchaseDetailDialog';
import { SafeWarning } from './SafeWarning';
import { DuePanel } from './DuePanel';
import { DueMark } from './DueMark';
import { PaperFields } from './PaperFields';
import { dueById, useSupplierDues } from './useSupplierDues';
import { resizeImage } from '../../lib/images';
import { baseQtyOf, moneyText, packSummary, withPackChange } from './packLines';
import { purchaseWarnings, referenceCosts, usualUnitOf, type CostReference } from './purchaseSanity';
import { VariantPicker, type PickedVariant } from './VariantPicker';
import { getProduct } from '../catalog/api';
import { getOrder } from './orderApi';
import { findSupplierDuplicate, isAdvance, paymentProblem } from './supplierRules';
import { downloadCsv } from '../exportCsv';
import { useUsdRate, usdToBase } from '../../lib/useUsdRate';
import { CurrencyTerms } from './CurrencyTerms';
import {
  OpeningBalanceFields,
  emptyOpening,
  openingInput,
  openingRateOk,
  type OpeningState,
} from './OpeningBalanceFields';

/**
 * Each way of paying as a card and as a state in the list (هوية 4 › Badge): on the supplier's
 * account is still owed, so it reads as a warning; paid from the safe or the bank, as settled.
 */
const PAYMENT_LOOK: Record<PurchasePayment, { hint: string; icon: Icon; tone: BadgeTone }> = {
  credit: { hint: 'يُضاف إلى ما له عليك', icon: BookIcon, tone: 'warning' },
  cash: { hint: 'يُدفع الآن', icon: CashIcon, tone: 'success' },
  bank: { hint: 'يُحوَّل من حسابك', icon: ChequeIcon, tone: 'info' },
};

interface Line extends PickedVariant {
  /** Pieces, or packs of `packQty` pieces (thousandths) when the item has packs */
  qty: string;
  packQty: number;
  /** What one pack (or piece) cost, as typed; the total follows it */
  unitCost?: string;
  cost: string;
  /** «رقم الدفعة» and «تاريخ الانتهاء» (03 › الصيدليات), both optional */
  batch?: string;
  expiry?: string;
  /** Serial numbers or IMEIs, one per line of text (03 › الإلكترونيات) */
  serials?: string;
}

/** The spans of the invoice list: the whole history by default, or a period */
type Span = 'all' | 'month' | 'last' | 'quarter' | 'year';
const SPANS: { key: Span; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'last', label: 'الشهر الماضي' },
  { key: 'quarter', label: 'آخر ٩٠ يوماً' },
  { key: 'year', label: 'هذه السنة' },
];

function spanRange(span: Span, today: string): { from?: string; to?: string } {
  if (span === 'month') return { from: monthStart(today), to: today };
  if (span === 'last') {
    const end = addDays(monthStart(today), -1);
    return { from: monthStart(end), to: end };
  }
  if (span === 'quarter') return { from: addDays(today, -89), to: today };
  if (span === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return {};
}

const PAGE_SIZE = 50;
/** A phone shows cards that are tall: twenty to a page keeps the list short (round 60) */
const PHONE_PAGE_SIZE = 12;

/**
 * «المشتريات» (08 › فاتورة شراء): the purchases (paged, searched and filtered by the server), a new
 * purchase (goods into the stock at what they cost), a payment to a supplier, and what is owed. Round 44: the
 * Sales language (hero strip, filter bar, status badges, cards on a phone, page navigation).
 */
export function PurchasesPage() {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const today = storeToday(me.tenant.timezone);
  const [notice, setNotice] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'buy' | 'pay' | 'supplier'>('list');
  // «ابحث في المتجر» sends a purchase number here as ?q=PUR-…
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(typed);
  const [span, setSpan] = useState<Span>('all');
  const [supplierId, setSupplierId] = useState('');
  const [payment, setPayment] = useState('');
  const [opened, setOpened] = useState<PurchaseRow | null>(null);
  // «استلم البضاعة» on a purchase order sends the order's number here as ?order=…
  const orderId = params.get('order');
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  // «صحّح الفاتورة»: the draft of the invoice to write again, and the two documents it came from. It is kept in
  // the tab's session storage too, so a closed page does not lose it
  const [correction, setCorrection] = useState<KeptCorrection | null>(null);
  const [kept, setKept] = useState<KeptCorrection | null>(() => keptCorrection());
  const [month, setMonth] = useState<{ count: number; totalMinor: number } | null | 'failed'>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const loadSuppliers = useCallback(() => {
    let alive = true;
    listSuppliers().then(
      (s) => alive && setSuppliers(s),
      (e: unknown) => alive && setError(errorMessage(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => loadSuppliers(), [loadSuppliers]);

  const filters = useMemo<PurchaseFilters>(
    () => ({ ...spanRange(span, today), supplierId, payment, q }),
    [span, today, supplierId, payment, q],
  );
  const fetchKey = JSON.stringify({ ...filters, phone });
  const {
    data: page,
    error: listError,
    loading,
    retry,
    topRef,
    pager,
  } = useCursorPages(fetchKey, (cursor) =>
    listPurchasePage(filters, cursor, phone ? PHONE_PAGE_SIZE : PAGE_SIZE),
  );
  const items = useMemo(() => page?.items ?? [], [page]);

  // This month's total, whatever the list shows: one small request (the invoices corrected are not in it)
  const [monthTick, setMonthTick] = useState(0);
  useEffect(() => {
    let alive = true;
    listPurchasePage({ from: monthStart(today), to: today }, null, 1).then(
      (r) => alive && setMonth(r.summary ?? 'failed'),
      () => alive && setMonth('failed'),
    );
    return () => {
      alive = false;
    };
  }, [today, monthTick]);

  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    getOrder(orderId)
      .then((o) => {
        if (!alive) return;
        setOrder(o);
        setMode('buy');
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [orderId]);

  // «دفعة» on a supplier's row sends its id here as ?pay=…: the payment window opens on that supplier
  // Round 64: «ادفع» on a due invoice sends ?pay=…&amount=… (the invoice's open amount): the window opens with it typed
  const payId = params.get('pay');
  const payAmount = Number(params.get('amount'));
  const payKey = payId ? `${payId}/${payAmount}` : null;
  const payOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!payKey || payOpened.current === payKey || !suppliers) return;
    payOpened.current = payKey;
    if (suppliers.items.some((x) => x.id === payId && !x.archived)) setMode('pay');
  }, [payKey, payId, suppliers]);
  const closePay = () => {
    setMode('list');
    if (params.has('pay') || params.has('amount')) {
      payOpened.current = null;
      setParams(
        (old) => {
          const next = new URLSearchParams(old);
          next.delete('pay');
          next.delete('amount');
          return next;
        },
        { replace: true },
      );
    }
  };
  const dues = useSupplierDues(monthTick);
  const dueOpen = useMemo(() => dueById(dues), [dues]);

  const base = suppliers?.baseCurrency ?? me.settings.baseCurrency;
  // After a save the form closes and the page is left scrolled down: bring the success message into view
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice && mode === 'list') noticeRef.current?.scrollIntoView?.({ block: 'start' });
  }, [notice, mode]);
  const reload = useCallback(() => {
    setError(null);
    retry();
    loadSuppliers();
    setMonthTick((n) => n + 1);
  }, [retry, loadSuppliers]);
  const done = (message: string) => {
    setNotice(message);
    setOrder(null);
    setCorrection(null);
    setKept(null);
    dropCorrection();
    closePay();
    reload();
  };
  const startCorrection = (c: KeptCorrection) => {
    keepCorrection(c);
    setKept(c);
    setCorrection(c);
    setOpened(null);
    setMode('buy');
    // The old invoice is turned back: the supplier's balance on screen is read again
    reload();
  };

  const owing = (suppliers?.items ?? [])
    .filter((s) => s.balanceMinor > 0 && !s.archived)
    .sort((a, b) => b.balanceMinor - a.balanceMinor);
  const owedUsd = (suppliers?.items ?? []).reduce((sum, s) => sum + Math.max(0, s.usdBalanceMinor ?? 0), 0);
  const active = [span !== 'all', supplierId !== '', payment !== '', q !== ''].filter(Boolean).length;
  const clearAll = () => {
    setSpan('all');
    setSupplierId('');
    setPayment('');
    setTyped('');
    setQ('');
  };

  async function exportAll() {
    setExporting(true);
    try {
      const rows: PurchaseRow[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 100; i++) {
        const r: Awaited<ReturnType<typeof listPurchasePage>> = await listPurchasePage(filters, cursor, 200);
        rows.push(...r.items);
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      exportPurchases(rows, today);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  const moreFilters = (
    <>
      <Select label="المورد" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
        <option value="">كل الموردين</option>
        {(suppliers?.items ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select label="طريقة الدفع" value={payment} onChange={(e) => setPayment(e.target.value)}>
        <option value="">الكل</option>
        {(Object.keys(PAYMENT_TEXT) as PurchasePayment[]).map((k) => (
          <option key={k} value={k}>
            {PAYMENT_TEXT[k]}
          </option>
        ))}
      </Select>
      <div role="radiogroup" aria-label="المدة" className="sx-chips scroll">
        {SPANS.map((x) => (
          <label key={x.key} className="sx-chip">
            <input
              type="radio"
              name="purchase-span"
              checked={span === x.key}
              onChange={() => setSpan(x.key)}
            />
            {x.label}
          </label>
        ))}
      </div>
      <Button
        variant="ghost"
        icon={<DownloadGlyph size={20} />}
        loading={exporting}
        disabled={loading || items.length === 0}
        onClick={() => void exportAll()}
      >
        صدّر إلى إكسل
      </Button>
    </>
  );

  const columns: SxColumn<PurchaseRow>[] = [
    {
      key: 'number',
      header: 'الرقم',
      lead: true,
      cell: (p) => (
        <>
          <button type="button" className="sx-rowbtn" onClick={() => setOpened(p)}>
            <bdi dir="ltr" className="sx-n sx-no">
              {p.number}
            </bdi>
          </button>
          {p.reference ? (
            <span className="sx-subline">
              رقمها عند المورد <bdi className="sx-n">{p.reference}</bdi>
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: 'date',
      header: 'التاريخ',
      cell: (p) => <span className="sx-mute">{dayText(p.date, digits)}</span>,
    },
    { key: 'supplier', header: 'المورد', cell: (p) => p.supplierName },
    { key: 'status', header: 'الدفع', cell: (p) => <InvoiceStatus row={p} /> },
    {
      key: 'due',
      header: 'الاستحقاق',
      cell: (p) =>
        p.payment === 'credit' && !p.correctedBy ? (
          <DueMark dueDate={p.dueDate} today={today} open={dueOpen.has(p.id)} />
        ) : (
          <span className="sx-sub">—</span>
        ),
    },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      strong: true,
      cellClass: (p) => (p.correctedBy ? 'sx-sub' : undefined),
      cell: (p) => (
        <span className="px-dual">
          <Amt minor={p.totalMinor} currency={base} />
          {p.currency === 'USD' && p.foreignTotalMinor ? (
            <span className="usd">
              <Amt minor={p.foreignTotalMinor} currency="USD" />
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'more',
      header: <span className="sr-only">إجراءات</span>,
      cell: (p) => (
        <span className="px-actions">
          <Button variant="ghost" size="xs" aria-label={`تفاصيل ${p.number}`} onClick={() => setOpened(p)}>
            التفاصيل
          </Button>
          <Menu
            label={`المزيد: ${p.number}`}
            align="end"
            trigger={<IconButton label={`المزيد: ${p.number}`} icon={<MoreIcon />} />}
          >
            <MenuItem
              icon={<PrintIcon size={16} />}
              render={(props) => <Link to={`/labels?purchase=${p.id}`} {...props} />}
            >
              الملصقات
            </MenuItem>
          </Menu>
        </span>
      ),
    },
  ];

  const noSuppliers = suppliers !== null && suppliers.items.length === 0;
  const emptyState = noSuppliers ? (
    <EmptyState
      icon={TruckIcon}
      title="لا موردين بعد."
      description="أضف مورداً أولاً، ثم سجّل فواتير الشراء منه."
    />
  ) : active > 0 ? (
    <EmptyState
      icon={PackageOpenIcon}
      title="لا فاتورة تطابق التصفية."
      description="جرّب رقماً آخر أو اسماً آخر أو مدة أطول."
      action={
        <Button variant="secondary" onClick={clearAll}>
          امسح التصفية
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={PackageOpenIcon}
      title="لا فواتير شراء بعد."
      description="سجّل أول فاتورة من «فاتورة شراء»، فتدخل البضاعة المخزون بكلفتها."
    />
  );

  return (
    <ReportScreen me={me} access={['purchases.manage']} title="المشتريات">
      <SalesPage>
        <PageTop
          title="المشتريات والموردون"
          subtitle={
            mode === 'buy'
              ? 'فاتورة شراء جديدة: البضاعة تدخل المخزون بكلفتها.'
              : 'فواتير الشراء من الموردين، وما لكل مورد عليك.'
          }
          actions={
            mode === 'buy' ? null : (
              <>
                <Button variant="ghost" icon={<UserIcon />} onClick={() => setMode('supplier')}>
                  مورد جديد
                </Button>
                <Button
                  variant="secondary"
                  icon={<CashIcon />}
                  onClick={() => setMode('pay')}
                  disabled={!suppliers?.items.length}
                >
                  دفعة لمورد
                </Button>
                <Button icon={<AddIcon />} onClick={() => setMode('buy')} disabled={!suppliers?.items.length}>
                  فاتورة شراء
                </Button>
              </>
            )
          }
        />
        {error ? (
          <Alert tone="error">
            <span className="flex flex-wrap items-center gap-3">
              {error}
              <Button variant="secondary" size="sm" onClick={reload}>
                أعد المحاولة
              </Button>
            </span>
          </Alert>
        ) : null}
        {notice && mode === 'list' ? (
          <div ref={noticeRef} className="scroll-mt-36 sm:scroll-mt-28">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}
        {kept && mode === 'list' ? (
          <Alert tone="warning" title={`صُحّحت الفاتورة ${kept.original} ولم تُسجَّل نسختها الجديدة`}>
            <span className="px-draftbar">
              المستند {kept.reversal} أخرج البضاعة ورجّع ما للمورد. أكمل كتابة الفاتورة، أو اتركها إن لم تعد
              تريدها.
              <Button
                size="sm"
                onClick={() => {
                  setCorrection(kept);
                  setMode('buy');
                }}
              >
                أكمل كتابة الفاتورة
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  dropCorrection();
                  setKept(null);
                }}
              >
                اتركها
              </Button>
            </span>
          </Alert>
        ) : null}
        {mode === 'buy' && suppliers ? (
          <PurchaseForm
            suppliers={suppliers.items}
            order={order}
            correction={correction}
            onSaved={(n, photoFailed) =>
              done(
                `سُجّلت الفاتورة ${n} ودخلت البضاعة المخزون.${photoFailed ? ' تعذّر رفع الصورة: أضفها من تفاصيل الفاتورة.' : ''}`,
              )
            }
            onCancel={() => {
              setOrder(null);
              setCorrection(null);
              setMode('list');
              // The old invoice is already turned back: leaving the draft says so, and it is kept to pick up again
              if (correction) {
                setNotice(
                  `صُحّحت الفاتورة ${correction.original} بالمستند ${correction.reversal}، ولم تُسجَّل النسخة الجديدة بعد. تجدها محفوظة هنا لتكملها.`,
                );
                reload();
              }
            }}
          />
        ) : (
          <>
            <section aria-label="أرقام المشتريات" className="sx-card sx-strip px-strip">
              <div>
                <span className="sx-eyebrow">المستحق للموردين</span>
                <span className="v big">
                  {suppliers ? <Amt minor={suppliers.totalOwedMinor} currency={base} /> : '…'}
                </span>
                <span className="note">
                  {owing[0] ? (
                    <>
                      أكبر مستحق: {owing[0].name}
                      {owedUsd > 0 ? (
                        <>
                          {' · '}منه <Amt minor={owedUsd} currency="USD" />
                        </>
                      ) : null}
                    </>
                  ) : suppliers ? (
                    'لا شيء عليك لأي مورد'
                  ) : null}
                </span>
              </div>
              <div>
                <span className="sx-eyebrow">مشتريات هذا الشهر</span>
                <span className="v">
                  {month === null ? (
                    '…'
                  ) : month === 'failed' ? (
                    <span className="sx-sub">—</span>
                  ) : (
                    <Amt minor={month.totalMinor} currency={base} />
                  )}
                </span>
                <span className="note">
                  {month && month !== 'failed' ? (
                    <>
                      <span className="sx-n">{month.count.toLocaleString('en-US')}</span> فاتورة سارية
                    </>
                  ) : null}
                </span>
              </div>
              <div>
                <span className="sx-eyebrow">{active > 0 ? 'نتائج التصفية' : 'كل الفواتير'}</span>
                <span className="v">
                  {page?.summary ? (
                    <Amt minor={page.summary.totalMinor} currency={base} />
                  ) : (
                    <span className="sx-sub">—</span>
                  )}
                </span>
                <span className="note">
                  {page?.summary ? (
                    <>
                      <span className="sx-n">{page.summary.count.toLocaleString('en-US')}</span> فاتورة، من
                      غير المصحَّحة
                    </>
                  ) : null}
                </span>
              </div>
            </section>
            <DuePanel dues={dues} />
            {owing.length > 0 && !phone ? (
              <Panel
                title="أكبر المستحقات للموردين"
                aside={
                  <Link to="/suppliers" className="sx-linkbtn">
                    كل الموردين
                  </Link>
                }
              >
                <ul className="sx-cards" aria-label="أكبر المستحقات">
                  {owing.slice(0, 3).map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/suppliers/${s.id}/statement`}
                        className="sx-icard"
                        aria-label={`كشف حساب ${s.name}`}
                      >
                        <span className="px-owe-name">{s.name}</span>
                        <span className="t">
                          <Amt minor={s.balanceMinor} currency={base} />
                        </span>
                        <span className="d">
                          {s.usdBalanceMinor && s.usdBalanceMinor > 0 ? (
                            <>
                              منه <Amt minor={s.usdBalanceMinor} currency="USD" />
                            </>
                          ) : (
                            'كشف الحساب'
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
            <div className="sx-card sx-filterbar print:hidden">
              <div className="sx-search">
                <SearchField
                  label="ابحث برقم الفاتورة أو المورد"
                  placeholder="رقم الفاتورة أو المورد أو رقمها عند المورد"
                  value={typed}
                  onValueChange={setTyped}
                />
              </div>
              {phone ? (
                <details className="px-more" open={active > (q ? 1 : 0)}>
                  <summary>تصفية أخرى</summary>
                  {moreFilters}
                </details>
              ) : (
                moreFilters
              )}
            </div>
            <div ref={topRef}>
              {phone && items.length > 0 && !loading ? (
                <ul className="sx-cards" aria-label="فواتير الشراء">
                  {items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="sx-icard px-amt-first"
                        aria-label={`تفاصيل ${p.number}`}
                        onClick={() => setOpened(p)}
                      >
                        <span className="n">{p.number}</span>
                        <span className="st">
                          <InvoiceStatus row={p} />
                        </span>
                        <span className="d">
                          {p.supplierName} · {dayText(p.date, digits)}
                        </span>
                        <span className={`t ${p.correctedBy ? 'sx-sub' : ''}`}>
                          <Amt minor={p.totalMinor} currency={base} />
                        </span>
                        {(p.payment === 'credit' && !p.correctedBy && p.dueDate) ||
                        p.reference ||
                        (p.currency === 'USD' && p.foreignTotalMinor) ? (
                          <span className="x">
                            {p.payment === 'credit' && !p.correctedBy && p.dueDate ? (
                              <>
                                تستحق <DueMark dueDate={p.dueDate} today={today} open={dueOpen.has(p.id)} />
                              </>
                            ) : null}
                            {p.reference ? (
                              <>
                                {p.payment === 'credit' && !p.correctedBy && p.dueDate ? ' · ' : ''}
                                رقمها عند المورد {p.reference}
                              </>
                            ) : null}
                            {p.currency === 'USD' && p.foreignTotalMinor ? (
                              <>
                                {' · '}
                                <Amt minor={p.foreignTotalMinor} currency="USD" />
                              </>
                            ) : null}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <SxTable
                  caption="فواتير الشراء"
                  columns={columns}
                  rows={items}
                  rowKey={(p) => p.id}
                  onRowClick={(p) => setOpened(p)}
                  loading={loading}
                  error={listError ?? undefined}
                  onRetry={retry}
                  empty={emptyState}
                />
              )}
            </div>
            <Pager noun="الفواتير" pager={pager} />
            {opened ? (
              <PurchaseDetailDialog
                purchase={opened}
                onClose={() => setOpened(null)}
                onCorrected={(c) =>
                  startCorrection({ draft: c.draft, original: opened.number, reversal: c.reversal.number })
                }
                onRewrite={(draft, reversal) => {
                  setCorrection({ draft, original: opened.number, reversal });
                  setOpened(null);
                  setMode('buy');
                }}
              />
            ) : null}
          </>
        )}
        {mode === 'supplier' ? (
          <SupplierForm
            suppliers={suppliers?.items ?? []}
            onSaved={() => done('أُضيف المورد.')}
            onCancel={() => setMode('list')}
          />
        ) : null}
        {mode === 'pay' && suppliers ? (
          <PaymentForm
            suppliers={suppliers.items.filter((x) => !x.archived)}
            {...(payId ? { initialSupplierId: payId } : {})}
            {...(payAmount > 0 ? { initialAmountMinor: payAmount } : {})}
            base={base}
            onSaved={(n) => done(`سُجّل سند الدفع ${n}.`)}
            onCancel={closePay}
          />
        ) : null}
      </SalesPage>
    </ReportScreen>
  );
}

const pounds = (minor: number) => minor / 100;

/** The purchases on screen as a CSV file (Excel opens it in Arabic). */
function exportPurchases(rows: PurchaseRow[], day: string) {
  downloadCsv(
    `المشتريات-${day}`,
    ['الرقم', 'التاريخ', 'المورد', 'رقمها عند المورد', 'طريقة الدفع', 'الإجمالي'],
    rows.map((p) => [
      p.number,
      p.date,
      p.supplierName,
      p.reference ?? '',
      PAYMENT_TEXT[p.payment],
      pounds(p.totalMinor),
    ]),
  );
}

function useSaving() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      return await work();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      return null;
    } finally {
      setSaving(false);
    }
  }
  return { saving, error, fields, run, setFields };
}

/** The payment days typed (Arabic digits too): a whole number up to 365, or null when empty or wrong */
export function termsDaysOf(text: string): number | null {
  const clean = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  if (clean === '' || clean.length > 3) return null;
  const n = Number(clean);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
}

/** «مورد جديد»: the window to add a supplier (shared with «الموردون») */
export function SupplierForm({
  suppliers,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const s = useSaving();
  const duplicate = findSupplierDuplicate(suppliers, name, phone);
  // Round 47: «رصيد افتتاحي», posted once the supplier is saved; its own id keeps a retry from posting it twice
  const [opening, setOpening] = useState<OpeningState>(emptyOpening);
  const [openingId] = useState(newDocumentId);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const openingWanted = opening.amount.trim() !== '';
  const openingReady =
    !openingWanted || (openingInput(opening, openingId) !== null && openingRateOk(opening));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="مورد جديد"
      description="من تشتري منه البضاعة. يظهر هنا ما له عليك بعد كل فاتورة ودفعة."
    >
      <form
        aria-label="مورد جديد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (duplicate && !confirmed) {
            setConfirmed(true);
            return;
          }
          // A phone that cannot be right is told here, before anything is sent
          const wrong = contactPhoneSchema.safeParse(phone);
          if (!wrong.success) {
            s.setFields({ phone: wrong.error.issues[0]?.message ?? 'رقم الهاتف غير صحيح' });
            return;
          }
          if (!openingReady) return;
          void s
            .run(async () => {
              // The supplier is saved once; when the balance then fails, only the balance is tried again
              const days = termsDaysOf(terms);
              const id =
                createdId ??
                (await createSupplier({ name, phone, ...(days !== null ? { termsDays: days } : {}) })).id;
              setCreatedId(id);
              const input = openingInput(opening, openingId);
              if (input) await openSupplierBalance(id, input);
              return id;
            })
            .then((r) => r && onSaved());
        }}
      >
        {s.error && !Object.keys(s.fields).length ? <Alert tone="error">{s.error}</Alert> : null}
        {duplicate ? (
          <Alert tone="warning">
            {duplicate.by === 'phone'
              ? `هذا الرقم مسجّل للمورد «${duplicate.supplier.name}».`
              : `يوجد مورد بالاسم نفسه «${duplicate.supplier.name}».`}{' '}
            <Link className="font-semibold underline" to={`/suppliers/${duplicate.supplier.id}/statement`}>
              افتح المورد
            </Link>
            {confirmed ? ' اضغط «أضِفه رغم ذلك» لتأكيد أنه مورد آخر.' : ''}
          </Alert>
        ) : null}
        <TextField
          label="اسم المورد"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={s.fields.name}
        />
        <TextField
          label="الجوال"
          hint="اختياري"
          dir="ltr"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (s.fields.phone) s.setFields({});
          }}
          error={s.fields.phone}
        />
        <NumberField
          label="أيام السداد"
          hint="اختياري: كم يوماً يمهلك هذا المورد. تبدأ منها مواعيد استحقاق فواتيره"
          decimals={0}
          value={terms}
          onValueChange={setTerms}
          error={s.fields.termsDays}
        />
        <OpeningBalanceFields
          value={opening}
          onChange={setOpening}
          base={me.settings.baseCurrency}
          errors={s.fields}
        />
        {createdId ? (
          <Alert tone="info">
            حُفظ المورد. اضغط «احفظ» لتسجيل رصيده الافتتاحي، أو «إلغاء» لتركه بلا رصيد.
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button type="submit" loading={s.saving} disabled={!openingReady}>
            {duplicate && confirmed ? 'أضِفه رغم ذلك' : 'احفظ'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * What a purchase order is still owed, as the lines of a purchase: the rest of each quantity at the
 * order's unit cost, which stays when the quantity is changed (the line's total follows it)
 */
function linesOfOrder(order: PurchaseOrderDetail): Line[] {
  return order.lines
    .filter((l) => orderLineRemaining(l) > 0)
    .map((l) => {
      const left = orderLineRemaining(l);
      return {
        variantId: l.variantId,
        name: l.name,
        qty: String(left / 1000),
        packQty: 1000,
        unitCost: moneyText(l.unitCostMinor),
        cost: moneyText(orderLineCost(l.unitCostMinor, left)),
      };
    });
}

/** The invoice a correction gives back, as the lines of a new one to fix and save (costs in the invoice's currency) */
function linesOfDraft(draft: PurchaseDraft): Line[] {
  return draft.lines.map((l) => ({
    variantId: l.variantId,
    productId: l.productId,
    name: l.name,
    qty: String(l.qty / 1000),
    packQty: 1000,
    cost: moneyText(l.costMinor),
    batch: l.batchNo ?? '',
    expiry: l.expiryDate ?? '',
    ...(l.serials && l.serials.length > 0 ? { serials: l.serials.join('\n') } : {}),
  }));
}

/** The grid of a purchase line: the item, its quantity, its cost and the bin. */
const LINE_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_14rem_8rem_9rem_2.5rem]';

function PurchaseForm({
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
          <div
            className={`grid grid-cols-1 gap-4 ${payment === 'credit' ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}
          >
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
          <CurrencyTerms
            label="عملة الفاتورة"
            currency={currency}
            onCurrency={setCurrency}
            rate={rate}
            onRate={setRate}
            storeRate={storeRate}
            error={s.fields.rate ?? s.fields.currency}
            className="mt-5"
          />
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
        <Card>
          <CardHeader icon={<CashIcon />} title="الدفع" description="كيف دُفع ثمن البضاعة." />
          <RadioGroup legend="الدفع" hideLegend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {(Object.keys(PAYMENT_TEXT) as PurchasePayment[]).map((p) => {
                const PayIcon = PAYMENT_LOOK[p].icon;
                return (
                  <ChoiceCard
                    key={p}
                    name="purchase-payment"
                    value={p}
                    checked={payment === p}
                    onChange={() => setPayment(p)}
                    title={PAYMENT_TEXT[p]}
                    description={PAYMENT_LOOK[p].hint}
                    leading={<PayIcon />}
                  />
                );
              })}
            </div>
          </RadioGroup>
          <SafeWarning active={payment === 'cash' && !usd} amountMinor={total} />
        </Card>
      </div>
      {/* The totals stay in view: beside the form on a wide screen, over the bottom edge on a phone. */}
      <div className="sticky z-10 max-lg:bottom-3 max-lg:rounded-card max-lg:shadow-e3 lg:top-24">
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink max-lg:hidden">ملخص الفاتورة</h2>
          <dl className="flex flex-col gap-3 text-sm max-lg:hidden">
            <SummaryRow term="المورد">{supplier?.name ?? '—'}</SummaryRow>
            {supplier ? (
              <SummaryRow term="له عليك الآن">
                <Money minor={supplier.balanceMinor} currency={base} />
              </SummaryRow>
            ) : null}
            {supplier?.usdBalanceMinor ? (
              <SummaryRow term="منه بالدولار">
                <Money minor={supplier.usdBalanceMinor} currency="USD" />
              </SummaryRow>
            ) : null}
            {usd ? (
              <SummaryRow term="سعر الدولار">{rate ? <span className="num">{rate}</span> : '—'}</SummaryRow>
            ) : null}
            <SummaryRow term="الدفع">{PAYMENT_TEXT[payment]}</SummaryRow>
            {dueDate ? <SummaryRow term="تستحق في">{dayText(dueDate, digits)}</SummaryRow> : null}
            {adjusted ? (
              <SummaryRow term="مجموع الورقة">
                <Money minor={gross} currency={invoiceCurrency} />
              </SummaryRow>
            ) : null}
            {(discountN ?? 0) > 0 ? (
              <SummaryRow term="خصم المورد">
                −<Money minor={discountN ?? 0} currency={invoiceCurrency} />
              </SummaryRow>
            ) : null}
            {(chargesN ?? 0) > 0 ? (
              <SummaryRow term="رسوم إضافية">
                +<Money minor={chargesN ?? 0} currency={invoiceCurrency} />
              </SummaryRow>
            ) : null}
            <SummaryRow term="الأصناف">
              <span className="num">{used.length}</span>
            </SummaryRow>
            <SummaryRow term="الكمية">
              <span className="num">{formatQuantity(pieces, digits)}</span>
            </SummaryRow>
          </dl>
          <div className="flex items-center justify-between gap-x-3 gap-y-1 rounded-control bg-surface-total px-4 py-3 lg:flex-col lg:items-start">
            <span className="text-sm font-semibold whitespace-nowrap text-ink-muted">مجموع الفاتورة</span>
            <Money
              minor={total}
              currency={invoiceCurrency}
              className="text-2xl font-bold text-ink"
              unitClassName="text-base font-semibold text-ink-subtle"
            />
            {usd ? (
              <span className="text-sm text-ink-muted">
                تدخل المخزون بـ <Money minor={totalBase} currency={base} className="font-semibold" />
              </span>
            ) : null}
          </div>
          <div className="flex gap-3 lg:flex-col">
            <Button
              type="submit"
              loading={s.saving}
              disabled={!ready}
              aria-describedby={notReadyWhy ? 'purchase-not-ready' : undefined}
              className="flex-1 lg:w-full"
            >
              سجّل الفاتورة
            </Button>
            <Button variant="ghost" onClick={onCancel} className="lg:w-full">
              إلغاء
            </Button>
          </div>
          {pastLines.length > 0 ? (
            <Switch
              label="تاريخ الانتهاء الماضي صحيح، سجّله"
              description={`${pastLines.map((l) => l.name).join('، ')}: دفعة منتهية الصلاحية.`}
              checked={pastOk}
              onCheckedChange={setPastOk}
            />
          ) : null}
          {skipped > 0 && used.length > 0 ? (
            <p role="status" className="text-sm text-ink-muted">
              {skipped === 1 ? 'سطر واحد بكمية صفر' : `${skipped} أسطر بكمية صفر`} لن يُسجَّل
              {order ? '، ويبقى على الطلبية' : ''}.
            </p>
          ) : null}
          {notReadyWhy ? (
            <p id="purchase-not-ready" aria-live="polite" className="text-sm font-semibold text-warning-ink">
              {notReadyWhy}
            </p>
          ) : null}
        </Card>
      </div>
    </form>
  );
}

function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{term}</dt>
      <dd className="min-w-0 truncate text-end font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** A supplier the store owes in dollars and in nothing else: its payment starts in dollars */
function dollarsOnly(supplier: SupplierRow | undefined): boolean {
  return (
    (supplier?.usdBalanceMinor ?? 0) > 0 && (supplier?.balanceMinor ?? 0) - (supplier?.usdBookMinor ?? 0) <= 0
  );
}

function PaymentForm({
  suppliers,
  initialSupplierId,
  initialAmountMinor,
  base,
  onSaved,
  onCancel,
}: {
  suppliers: SupplierRow[];
  /** An amount to start with (the open amount of a due invoice) */
  initialAmountMinor?: number;
  /** The supplier the window opens on (from a supplier's row), else the first one that is owed */
  initialSupplierId?: string;
  base: SupplierListResponse['baseCurrency'];
  onSaved: (number: string) => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const todayDay = storeToday(me.tenant.timezone);
  // The payment's own id, kept until it is saved: a retry never pays the supplier twice
  const [docId] = useState(newDocumentId);
  const owing = suppliers.filter((x) => x.balanceMinor > 0);
  const [supplierId, setSupplierId] = useState(
    (suppliers.find((x) => x.id === initialSupplierId) ?? owing[0] ?? suppliers[0])?.id ?? '',
  );
  const [amount, setAmount] = useState(initialAmountMinor ? moneyText(initialAmountMinor) : '');
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque'>('cash');
  const [date, setDate] = useState(todayDay);
  const [bank, setBank] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [dueDate, setDueDate] = useState(todayDay);
  const chequeReady = method !== 'cheque' || (bank.trim() !== '' && chequeNo.trim() !== '' && dueDate !== '');
  const [advance, setAdvance] = useState(false);
  const s = useSaving();
  // A payment in dollars (decision 11): from the dollar safe, at the rate of the day; the difference from the
  // rate the debt was booked at is the exchange difference
  const known = useUsdRate();
  const storeRate = base === 'SYP' ? known : null;
  const [currency, setCurrency] = useState<PurchaseCurrencyCode>(() =>
    dollarsOnly(suppliers.find((x) => x.id === supplierId)) ? 'USD' : 'SYP',
  );
  const [rate, setRate] = useState('');
  useEffect(() => {
    if (storeRate) setRate((typed) => typed || storeRate);
  }, [storeRate]);
  const usd = currency === 'USD';
  const rateOk = !usd || (/^\d{1,7}(\.\d{1,4})?$/.test(rateText(rate)) && Number(rateText(rate)) > 0);
  const minor = moneyOf(amount);
  const supplier = suppliers.find((x) => x.id === supplierId);
  const problem = paymentProblem(amount, minor);
  // What is owed in the currency being paid: the dollars, or the pounds that are not dollars' book value
  const owedIn = !supplier
    ? 0
    : usd
      ? (supplier.usdBalanceMinor ?? 0)
      : supplier.balanceMinor - (supplier.usdBookMinor ?? 0);
  const over = minor !== null && supplier ? isAdvance(minor, owedIn) : false;
  const exchange = (() => {
    if (!usd || !supplier || !minor || !rateOk) return null;
    const owedUsd = supplier.usdBalanceMinor ?? 0;
    const book = supplier.usdBookMinor ?? 0;
    const paid = usdToBase(minor, base, rateText(rate));
    if (paid === null) return null;
    const settled =
      owedUsd <= 0
        ? paid
        : minor >= owedUsd
          ? book + (usdToBase(minor - owedUsd, base, rateText(rate)) ?? 0)
          : Math.round((book * minor) / owedUsd);
    return { paid, difference: paid - settled };
  })();
  /** A supplier owed in dollars only is paid in dollars: the form starts there */
  function chooseSupplier(id: string) {
    setSupplierId(id);
    setAdvance(false);
    const onlyDollars = dollarsOnly(suppliers.find((x) => x.id === id));
    setCurrency(onlyDollars ? 'USD' : 'SYP');
    if (onlyDollars && method === 'cheque') setMethod('cash');
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="دفعة لمورد"
      description="تنقص ما له عليك بقدرها، وتخرج من الخزنة أو من البنك."
    >
      <form
        aria-label="دفعة لمورد"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!minor || (over && !advance) || !chequeReady || !rateOk) return;
          void s
            .run(() =>
              paySupplier({
                id: docId,
                supplierId,
                date,
                amountMinor: minor,
                method: method === 'cheque' ? 'bank' : method,
                ...(usd ? { currency: 'USD' as const, rate: rateText(rate) } : {}),
                ...(method === 'cheque'
                  ? { cheque: { bank: bank.trim(), number: chequeNo.trim(), dueDate } }
                  : {}),
                note: null,
                ...(over ? { advance: true } : {}),
              }),
            )
            .then((r) => r && onSaved(r.number));
        }}
      >
        {s.error ? <Alert tone="error">{s.error}</Alert> : null}
        <Select
          label="المورد"
          value={supplierId}
          onChange={(e) => chooseSupplier(e.target.value)}
          hint={
            supplier ? (
              <>
                له عليك الآن <Money minor={supplier.balanceMinor} currency={base} className="font-semibold" />
                {supplier.usdBalanceMinor ? (
                  <>
                    {' '}
                    (منه <Money minor={supplier.usdBalanceMinor} currency="USD" className="font-semibold" />)
                  </>
                ) : null}
              </>
            ) : undefined
          }
        >
          {suppliers.map((sup) => (
            <option key={sup.id} value={sup.id}>
              {sup.name}
            </option>
          ))}
        </Select>
        <CurrencyTerms
          label="عملة الدفعة"
          currency={currency}
          onCurrency={(next) => {
            setCurrency(next);
            setAdvance(false);
            if (next === 'USD' && method === 'cheque') setMethod('cash');
          }}
          rate={rate}
          onRate={setRate}
          storeRate={storeRate}
          error={s.fields.rate ?? s.fields.currency}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label={usd ? 'المبلغ بالدولار' : 'المبلغ بالليرة'}
            inputMode="decimal"
            autoComplete="off"
            dir="ltr"
            autoFocus
            value={amount}
            inputClassName="num"
            onChange={(e) => {
              setAmount(e.target.value);
              setAdvance(false);
            }}
            error={problem ?? s.fields.amountMinor}
          />
          <DateField label="التاريخ" value={date} onChange={setDate} required />
        </div>
        {exchange && exchange.difference !== 0 ? (
          <Alert tone={exchange.difference > 0 ? 'warning' : 'info'}>
            تدفع <Money minor={exchange.paid} currency={base} className="font-semibold" /> بسعر اليوم، وكان
            الدين مسجّلاً {exchange.difference > 0 ? 'بأقل منها: خسارة' : 'بأكثر منها: ربح'} صرف{' '}
            <Money minor={Math.abs(exchange.difference)} currency={base} className="font-semibold" /> تُسجَّل
            في «فروقات صرف محققة».
          </Alert>
        ) : null}
        {over ? (
          <Alert tone="warning">
            المبلغ أكبر مما للمورد عليك. الفرق يبقى دفعة مقدّمة له عندك، فيصير رصيده لك عنده.
            <Switch label="نعم، هذه دفعة مقدّمة" checked={advance} onCheckedChange={setAdvance} />
          </Alert>
        ) : null}
        <RadioGroup legend="من أين">
          <div className="grid grid-cols-1 gap-2">
            {(usd ? (['cash', 'bank'] as const) : (['cash', 'bank', 'cheque'] as const)).map((m) => (
              <ChoiceCard
                key={m}
                name="supplier-payment-method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                title={
                  m === 'cash' ? (usd ? 'من خزنة الدولار' : 'من الخزنة') : m === 'bank' ? 'من البنك' : 'بشيك'
                }
                leading={m === 'cash' ? <CashIcon /> : <ChequeIcon />}
              />
            ))}
          </div>
        </RadioGroup>
        <SafeWarning active={method === 'cash' && !usd} amountMinor={minor} />
        {method === 'cheque' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="البنك" value={bank} onChange={(e) => setBank(e.target.value)} required />
            <TextField
              label="رقم الشيك"
              dir="ltr"
              inputMode="numeric"
              value={chequeNo}
              onChange={(e) => setChequeNo(e.target.value)}
              inputClassName="num"
              required
            />
            <DateField
              label="تاريخ الاستحقاق"
              value={dueDate}
              onChange={setDueDate}
              required
              className="sm:col-span-2"
            />
            {dueDate > todayDay ? (
              <Alert tone="info" className="sm:col-span-2">
                الشيك مؤجّل: ينقص من دين المورد الآن، ويبقى المبلغ في «شيكات مستحقة الدفع» ولا يخرج من البنك
                حتى تسجّله «صُرف» من صفحة الشيكات.
              </Alert>
            ) : null}
            {dueDate !== '' && dueDate < todayDay ? (
              <Alert tone="warning" className="sm:col-span-2">
                تاريخ الاستحقاق مضى. تأكّد من التاريخ قبل أن تسجّل الدفعة.
              </Alert>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onCancel}>
            إلغاء
          </Button>
          <Button
            type="submit"
            loading={s.saving}
            disabled={!minor || (over && !advance) || !chequeReady || !rateOk}
          >
            سجّل الدفعة
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
