import { Link, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type PurchaseOrderDetail,
  type PurchasePayment,
  type PurchaseRow,
  type SupplierListResponse,
} from '@serva/core';
import {
  AddIcon,
  Alert,
  Button,
  CashIcon,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MoreIcon,
  PackageOpenIcon,
  PrintIcon,
  SearchField,
  Select,
  TruckIcon,
  useDigits,
  UserIcon,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, monthStart } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { errorMessage } from '../../lib/api';
import { listPurchasePage, listSuppliers, storeToday, type PurchaseFilters } from './api';
import { Pager, useCursorPages } from '../pager';
import { ReportScreen } from '../reports/parts';
import { addDays } from '../reports/periods';
import { Amt, DownloadGlyph, PageTop, Panel, SalesPage, SxTable, type SxColumn } from '../sales/ui';
import { InvoiceStatus, PAYMENT_TEXT } from './pui';
import { dropCorrection, keepCorrection, keptCorrection, type KeptCorrection } from './correctionDraft';
import { PurchaseDetailDialog } from './PurchaseDetailDialog';
import { DuePanel } from './DuePanel';
import { DueMark } from './DueMark';
import { dueById, useSupplierDues } from './useSupplierDues';
import { getOrder } from './orderApi';
import { downloadCsv } from '../exportCsv';
import { pounds } from './PurchasesShared';
import { SupplierForm } from './SupplierForm';
import { PurchaseForm } from './PurchaseForm';
import { PurchasesStrip } from './PurchasesStrip';
import { PurchaseCards } from './PurchaseCards';
import { PaymentForm } from './PaymentForm';

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
            <PurchasesStrip
              hasSuppliers={suppliers !== null}
              totalOwedMinor={suppliers?.totalOwedMinor}
              base={base}
              owing={owing}
              owedUsd={owedUsd}
              month={month}
              active={active}
              summary={page?.summary}
            />
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
                <PurchaseCards items={items} base={base} today={today} dueOpen={dueOpen} onOpen={setOpened} />
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

export { SupplierForm, termsDaysOf } from './SupplierForm';
