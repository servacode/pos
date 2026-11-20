import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  COUNT_NOUNS,
  countNoun,
  type ExpiryRow,
  type RecallBatch,
  type RecallResponse,
  type RecallSale,
} from '@serva/core';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  ChatIcon,
  Dialog,
  EmptyState,
  formatQuantity,
  PageHeader,
  SearchIcon,
  SegmentedControl,
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { useIsPhone } from '../../lib/useIsPhone';
import { dayText } from '../../lib/dates';
import { registeredAdjective } from '../../lib/plural';
import { whatsappNumber } from '../../pos/receipt/whatsapp';
import { downloadCsv } from '../exportCsv';
import { getRecall, listExpiry, setBatchBlocked } from './api';
import { SectionHead } from './parts';

/** «3 زبائن معروفين · 2 فاتورتان بلا زبون»: who to call first, and what cannot be traced */
export function buyersSummary(sales: RecallSale[]): string {
  const known = new Set(
    sales.filter((s) => s.customerName || s.customerPhone).map((s) => s.customerPhone ?? s.customerName),
  );
  const anonymous = new Set(sales.filter((s) => !s.customerName && !s.customerPhone).map((s) => s.invoiceId))
    .size;
  const parts = [
    `${countNoun(known.size, COUNT_NOUNS.customer)} ${registeredAdjective(known.size)} في الفواتير`,
  ];
  if (anonymous > 0) parts.push(`${countNoun(anonymous, COUNT_NOUNS.invoice)} بلا زبون`);
  return parts.join(' · ');
}

/** What was sold of the batch once the returns are taken off (an older server sends no returns: all of it) */
export function netSold(b: Pick<RecallBatch, 'soldQty' | 'returnedQty'>): number {
  return Math.max(0, b.soldQty - (b.returnedQty ?? 0));
}

/** The one line on top: how much went out (after returns), to how many known buyers, what is left to pull back */
export function recallHeadline(found: RecallResponse, digits: 'latn' | 'arab'): string {
  const sold = found.batches.reduce((n, b) => n + netSold(b), 0);
  const left = found.batches.reduce((n, b) => n + b.branches.reduce((m, x) => m + Math.max(0, x.qty), 0), 0);
  const known = buyerList(found.sales).people.length;
  const parts = [
    `بِيع منها ${formatQuantity(sold, digits)} بعد المرتجع`,
    known > 0 ? `لـ ${countNoun(known, COUNT_NOUNS.customer)}` : 'ولا زبون معروف',
    `وبقي في الفروع ${formatQuantity(left, digits)}`,
  ];
  return parts.join(' · ');
}

/** The note a buyer gets: which batch, of what, what to do */
export function recallMessage(batchNo: string, product: string, store: string): string {
  return [
    `السلام عليكم، من ${store}.`,
    `نُعلمكم أن الدفعة ${batchNo} من «${product}» التي اشتريتموها سُحبت من السوق.`,
    'نرجو التوقف عن استعمالها والتواصل معنا لاستبدالها أو استرداد ثمنها.',
  ].join('\n');
}

/** The known buyers one by one (by phone, else by name), and the invoices that name nobody */
export function buyerList(sales: RecallSale[]): {
  people: { name: string; phone: string; invoices: number; qty: number }[];
  anonymous: { invoices: number; qty: number };
} {
  const people = new Map<string, { name: string; phone: string; ids: Set<string>; qty: number }>();
  const nobody = { ids: new Set<string>(), qty: 0 };
  for (const sale of sales) {
    if (!sale.customerName && !sale.customerPhone) {
      nobody.ids.add(sale.invoiceId);
      nobody.qty += sale.qty;
      continue;
    }
    const key = sale.customerPhone ?? sale.customerName ?? '';
    const row = people.get(key) ?? {
      name: sale.customerName ?? '',
      phone: sale.customerPhone ?? '',
      ids: new Set<string>(),
      qty: 0,
    };
    row.ids.add(sale.invoiceId);
    row.qty += sale.qty;
    people.set(key, row);
  }
  return {
    people: [...people.values()].map((x) => ({
      name: x.name,
      phone: x.phone,
      invoices: x.ids.size,
      qty: x.qty,
    })),
    anonymous: { invoices: nobody.ids.size, qty: nobody.qty },
  };
}

/**
 * «استدعاء دفعة (سحب من السوق)» (03 › الصيدليات): a batch number leads to its product, the receipt and supplier it came
 * in on, what is left of it in each branch, and every invoice and customer that got it (with the
 * phone). One press stops every till from selling it. The list prints, or goes to a CSV file.
 */
export function RecallPage() {
  const digits = useDigits();
  const me = useMe();
  const [params] = useSearchParams();
  const [batchNo, setBatchNo] = useState(() => params.get('batch')?.slice(0, 60) ?? '');
  const [found, setFound] = useState<RecallResponse | null>(null);
  // The results open under the search: on a phone they are below the fold, so they scroll into view
  const results = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [messaging, setMessaging] = useState(false);
  // The note the buyers get, editable before it goes; and who was already sent it in this session
  const [draft, setDraft] = useState('');
  const [sentTo, setSentTo] = useState<Set<string>>(() => new Set());
  const phone = useIsPhone();
  const [onShelf, setOnShelf] = useState<ExpiryRow[]>([]);
  // Which batches the picker offers: all, the stopped ones, those ending within three months, or those already past their date
  const [shelfFilter, setShelfFilter] = useState<'urgent' | 'all' | 'blocked' | 'soon' | 'expired'>('urgent');

  // The batches the stores hold, to pick from instead of typing a number blind (the same report the
  // expiry page reads: every batch on the shelf, blocked ones included)
  useEffect(() => {
    let alive = true;
    listExpiry(3650).then(
      (r) => alive && setOnShelf(r.items),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  // A red «استدعاء» on a batch row opens this page with its number: the search runs by itself
  const prefilled = params.get('batch')?.trim() ?? '';
  useEffect(() => {
    if (prefilled) void search(prefilled, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const typed = batchNo.trim().toLowerCase();
    const out: ExpiryRow[] = [];
    for (const row of onShelf) {
      if (!row.batchNo) continue;
      const key = `${row.variantId}|${row.batchNo}`;
      if (seen.has(key)) continue;
      // What needs a look first: stopped, past its date, or ending within the month (typing searches all)
      if (
        shelfFilter === 'urgent' &&
        !typed &&
        !row.blocked &&
        !(row.daysLeft !== null && row.daysLeft <= 30)
      )
        continue;
      if (shelfFilter === 'blocked' && !row.blocked) continue;
      if (shelfFilter === 'soon' && (row.daysLeft === null || row.daysLeft < 0 || row.daysLeft > 90))
        continue;
      if (shelfFilter === 'expired' && (row.daysLeft === null || row.daysLeft >= 0)) continue;
      if (typed && !row.batchNo.toLowerCase().includes(typed) && !row.name.toLowerCase().includes(typed))
        continue;
      seen.add(key);
      out.push(row);
    }
    return out.slice(0, 8);
  }, [onShelf, batchNo, shelfFilter]);

  /** `keepView`: the page the person is on stays as it is while the numbers are read again */
  async function search(next?: string, keepView = false) {
    const q = (next ?? batchNo).trim();
    if (!q) {
      setError('اكتب رقم الدفعة أو اضغط إحدى الدفعات المقترحة.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setFound(await getRecall(q));
      if (!keepView) {
        requestAnimationFrame(() =>
          results.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }),
        );
      }
    } catch (e) {
      if (!keepView) setFound(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function block(blocked: boolean) {
    if (!found) return;
    setError(null);
    setNote(null);
    try {
      const done = await setBatchBlocked({ batchNo: found.batchNo }, blocked);
      setNote(
        blocked
          ? `أُوقف بيع الدفعة ${found.batchNo} في كل الفروع (${countNoun(done.count, COUNT_NOUNS.item)}).`
          : `رُفع الإيقاف عن الدفعة ${found.batchNo}.`,
      );
      await search(found.batchNo, true);
      // the chips under the search box read the same flag: read them again too
      await listExpiry(3650).then(
        (r) => setOnShelf(r.items),
        () => undefined,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function exportCsv() {
    if (!found) return;
    downloadCsv(
      `recall-${found.batchNo}`,
      ['الفاتورة', 'التاريخ', 'الفرع', 'الصنف', 'الكمية', 'الزبون', 'الهاتف'],
      found.sales.map((s) => [
        s.invoiceNumber,
        s.date,
        s.branchName,
        s.name,
        s.qty / 1000,
        s.customerName ?? (s.customerPhone ? '' : 'بلا زبون'),
        s.customerPhone ?? '',
      ]),
    );
  }

  /** The people to call: one row per known customer with the pieces they got, then what cannot be traced */
  function exportBuyers() {
    if (!found) return;
    const { people, anonymous } = buyerList(found.sales);
    downloadCsv(
      `buyers-${found.batchNo}`,
      ['الزبون', 'الهاتف', 'الفواتير', 'الكمية'],
      [
        ...people.map((x) => [x.name, x.phone, x.invoices, x.qty / 1000]),
        ...(anonymous.invoices > 0 ? [['بلا زبون', '', anonymous.invoices, anonymous.qty / 1000]] : []),
      ],
    );
  }

  /** Copy every buyer's phone, one per line, for a message list or a call sheet */
  async function copyPhones() {
    if (!found) return;
    const phones = buyerList(found.sales)
      .people.map((x) => x.phone)
      .filter(Boolean);
    try {
      await navigator.clipboard?.writeText(phones.join('\n'));
      setNote(`نُسخت أرقام ${countNoun(phones.length, COUNT_NOUNS.customer)} إلى الحافظة.`);
    } catch {
      setError('تعذّر النسخ، استخدم «صدّر الزبائن».');
    }
  }

  const blocked = found?.batches.some((b) => b.blocked) ?? false;
  const anonymousQty = found ? buyerList(found.sales).anonymous.qty : 0;
  // «افتح الفاتورة»: the first invoice that names nobody, to find who bought
  const anonymousInvoice = found?.sales.find((s) => !s.customerName && !s.customerPhone)?.invoiceNumber;
  const batchColumns: DataColumn<RecallBatch>[] = [
    { key: 'name', header: 'الصنف', cell: (b) => b.name },
    {
      key: 'expiry',
      header: 'تنتهي',
      cell: (b) => (b.expiryDate ? <bdi className="num">{dayText(b.expiryDate, digits)}</bdi> : '—'),
    },
    {
      key: 'receipts',
      header: 'استُلمت من',
      cell: (b) =>
        b.receipts.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-col">
            {b.receipts.map((r) => (
              <span key={r.purchaseNumber}>
                {r.supplierName} · <bdi className="num">{r.purchaseNumber}</bdi> ·{' '}
                <span className="num">{dayText(r.receivedOn, digits)}</span>
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'left',
      header: 'المتبقي في الفروع',
      cell: (b) =>
        b.branches.length === 0 ? (
          '0'
        ) : (
          <span className="flex flex-col">
            {b.branches.map((x) => (
              <span key={x.branchId}>
                {x.branchName}: <span className="num">{formatQuantity(x.qty, digits)}</span>
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'sold',
      header: 'بِيع (بعد المرتجع)',
      numeric: true,
      cell: (b) => formatQuantity(netSold(b), digits),
    },
    {
      key: 'state',
      header: 'الحالة',
      cell: (b) =>
        b.blocked ? (
          <Badge tone="danger">موقوفة</Badge>
        ) : b.expiryDate && b.expiryDate < new Date().toISOString().slice(0, 10) ? (
          <Badge tone="warning">منتهية</Badge>
        ) : (
          <Badge tone="neutral">تُباع</Badge>
        ),
    },
  ];
  const saleColumns: DataColumn<RecallSale>[] = [
    {
      key: 'invoice',
      header: 'الفاتورة',
      cell: (s) => (
        <bdi dir="ltr" className="num font-semibold">
          {s.invoiceNumber}
        </bdi>
      ),
    },
    { key: 'date', header: 'التاريخ', cell: (s) => <span className="num">{dayText(s.date, digits)}</span> },
    { key: 'branch', header: 'الفرع', cell: (s) => s.branchName },
    { key: 'item', header: 'الصنف', cell: (s) => s.name },
    { key: 'qty', header: 'الكمية', numeric: true, cell: (s) => formatQuantity(s.qty, digits) },
    {
      key: 'customer',
      header: 'الزبون',
      cell: (s) => s.customerName ?? <span className="text-ink-subtle">—</span>,
    },
    {
      key: 'phone',
      header: 'الهاتف',
      cell: (s) =>
        s.customerPhone ? (
          <bdi dir="ltr" className="num">
            {s.customerPhone}
          </bdi>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ];

  return (
    <AppShell>
      <title>استدعاء دفعة · SERVA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="استدعاء دفعة (سحب من السوق)"
          description="اكتب رقم الدفعة لترى من أين جاءت وأين بقي منها ومن اشتراها، ثم أوقف بيعها في كل الفروع."
        />
        <Card className="print:hidden">
          <CardHeader icon={<SearchIcon />} title="ابحث عن دفعة" />
          <form
            aria-label="ابحث عن دفعة"
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="min-w-60 flex-1">
              <TextField
                label="رقم الدفعة"
                dir="ltr"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value.slice(0, 60))}
              />
            </div>
            <Button type="submit" loading={loading}>
              ابحث
            </Button>
          </form>
          {onShelf.some((r) => r.batchNo) ? (
            <div className="mt-4">
              <SegmentedControl
                label="الدفعات المعروضة"
                className="max-w-full overflow-x-auto"
                value={shelfFilter}
                onValueChange={setShelfFilter}
                options={[
                  { value: 'urgent', label: 'تحتاج انتباهك' },
                  { value: 'all', label: 'كل الدفعات' },
                  { value: 'soon', label: 'تنتهي قريباً' },
                  { value: 'expired', label: 'منتهية' },
                  { value: 'blocked', label: 'الموقوفة' },
                ]}
              />
            </div>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-sm font-semibold text-ink-muted">
                {batchNo.trim()
                  ? 'دفعات تطابق ما كتبت'
                  : shelfFilter === 'urgent'
                    ? 'دفعات تحتاج انتباهك أولاً، اضغط واحدة'
                    : 'دفعات في المخزون، اضغط واحدة'}
              </p>
              <ul aria-label="دفعات مقترحة" className="flex flex-wrap gap-2">
                {suggestions.map((row) => (
                  <li key={`${row.variantId}|${row.batchNo}`} className="max-w-full">
                    <button
                      type="button"
                      onClick={() => {
                        setBatchNo(row.batchNo!);
                        void search(row.batchNo!);
                      }}
                      className="flex min-h-11 max-w-full flex-col items-start rounded-control border border-line-control bg-surface px-3 py-1.5 text-start text-sm text-ink transition-colors duration-120 ease-standard hover:bg-surface-muted"
                    >
                      <span className="font-semibold">
                        <bdi dir="ltr" className="num">
                          {row.batchNo}
                        </bdi>{' '}
                        · {row.name}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {row.expiryDate ? (
                          <>
                            تنتهي <bdi className="num">{dayText(row.expiryDate, digits)}</bdi>
                          </>
                        ) : (
                          'بلا تاريخ انتهاء'
                        )}
                        {row.blocked ? ' · موقوفة' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
        <div ref={results} className="flex scroll-mt-24 flex-col gap-6">
          {error ? <Alert tone="error">{error}</Alert> : null}
          {note ? <Alert tone="success">{note}</Alert> : null}
          {found ? (
            found.batches.length === 0 ? (
              <EmptyState
                icon={SearchIcon}
                title={`لا دفعة بالرقم ${found.batchNo}.`}
                description="تأكد من الرقم كما كُتب على العلبة وفي فاتورة الشراء."
              />
            ) : (
              <>
                <section aria-label="الدفعة" className="flex flex-col gap-3">
                  <SectionHead
                    title={
                      <>
                        الدفعة <BatchNo no={found.batchNo} />
                      </>
                    }
                    description="المنتج وأصل الدفعة وما بقي منها."
                  >
                    <span className="flex flex-wrap items-center gap-2 print:hidden">
                      <Button
                        variant={blocked ? 'secondary' : 'primary'}
                        onClick={() => (blocked ? setLifting(true) : setConfirming(true))}
                      >
                        {blocked ? 'ارفع الإيقاف' : 'أوقف بيعها في كل الفروع'}
                      </Button>
                      <Button variant="secondary" onClick={() => window.print()}>
                        اطبع
                      </Button>
                      <Button variant="secondary" onClick={exportCsv} disabled={found.sales.length === 0}>
                        حمّل الجدول
                      </Button>
                    </span>
                  </SectionHead>
                  <p className="text-sm font-semibold text-ink" data-testid="recall-headline">
                    {recallHeadline(found, digits)}
                  </p>
                  <DataTable
                    caption="الدفعة وأصلها"
                    columns={batchColumns}
                    rows={found.batches}
                    rowKey={(b) => `${b.variantId}|${b.expiryDate ?? ''}`}
                  />
                </section>
                <section aria-label="من اشترى الدفعة" className="flex flex-col gap-3">
                  <SectionHead
                    title="من اشترى هذه الدفعة"
                    description="كل فاتورة بيعت منها، مع الزبون وهاتفه إن عُرف."
                  />
                  {found.sales.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <p
                        className="min-w-0 flex-1 text-sm text-ink-muted"
                        data-testid="recall-buyers-summary"
                      >
                        {buyersSummary(found.sales)}
                      </p>
                      {buyerList(found.sales).people.some((x) => x.phone) ? (
                        <Button
                          onClick={() => {
                            setDraft(
                              recallMessage(found.batchNo, found.batches[0]?.name ?? '', me.tenant.name),
                            );
                            setMessaging(true);
                          }}
                        >
                          راسل الزبائن
                        </Button>
                      ) : (
                        <span className="flex flex-col items-start gap-0.5">
                          <Button disabled>راسل الزبائن</Button>
                          <span className="text-xs text-ink-muted" data-testid="recall-no-phones">
                            لا رقم هاتف لأي مشترٍ، أضف رقمه من صفحة الزبون.
                          </span>
                        </span>
                      )}
                      <Button variant="secondary" onClick={exportBuyers}>
                        صدّر الزبائن
                      </Button>
                    </div>
                  ) : null}
                  {anonymousQty > 0 ? (
                    <Alert tone="warning">
                      <span data-testid="recall-anonymous">
                        فواتير بلا زبون: خرج منها{' '}
                        <bdi className="num font-semibold">
                          {Number.isInteger(anonymousQty / 1000)
                            ? countNoun(anonymousQty / 1000, COUNT_NOUNS.piece)
                            : `${formatQuantity(anonymousQty, digits)} قطعة`}
                        </bdi>{' '}
                        من هذه الدفعة ولا يمكن الوصول إلى مشتريها، فاحسبها ضمن المخاطرة.
                        {anonymousInvoice ? (
                          <>
                            {' '}
                            <Link
                              to={`/sales/invoices?q=${encodeURIComponent(anonymousInvoice)}`}
                              className="font-semibold underline"
                            >
                              افتح الفاتورة
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </Alert>
                  ) : null}
                  {phone && found.sales.length > 0 ? (
                    <ul aria-label="فواتير الدفعة" className="flex flex-col gap-2">
                      {found.sales.map((s) => (
                        <li
                          key={`${s.invoiceId}|${s.variantId}`}
                          className="flex flex-col gap-1 rounded-card border border-line bg-surface p-3 shadow-e1"
                        >
                          <span className="flex items-center justify-between gap-3 text-sm">
                            <bdi dir="ltr" className="num font-semibold">
                              {s.invoiceNumber}
                            </bdi>
                            <span className="num text-ink-muted">{dayText(s.date, digits)}</span>
                          </span>
                          <span className="text-sm text-ink">
                            {s.name} · <span className="num">{formatQuantity(s.qty, digits)}</span>
                          </span>
                          <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate font-semibold text-ink">
                              {s.customerName ?? <span className="text-ink-subtle">بلا زبون</span>}
                            </span>
                            {s.customerPhone ? (
                              <a
                                href={`tel:${s.customerPhone}`}
                                className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand-ink hover:underline"
                              >
                                <bdi dir="ltr" className="num">
                                  {s.customerPhone}
                                </bdi>
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <DataTable
                      caption="فواتير الدفعة"
                      columns={saleColumns}
                      rows={found.sales}
                      rowKey={(s) => `${s.invoiceId}|${s.variantId}`}
                      empty={
                        <EmptyState
                          icon={SearchIcon}
                          title="لم تُبَع هذه الدفعة بعد."
                          description="لا فاتورة تحمل رقمها."
                        />
                      }
                    />
                  )}
                </section>
              </>
            )
          ) : null}
        </div>
      </div>
      <Dialog
        open={messaging}
        onOpenChange={setMessaging}
        title="راسل الزبائن"
        actions={
          <>
            <Button variant="secondary" onClick={() => void copyPhones()}>
              انسخ كل الأرقام
            </Button>
            <Button variant="secondary" onClick={() => setMessaging(false)}>
              أغلق
            </Button>
          </>
        }
      >
        {found ? (
          <div className="flex flex-col gap-3">
            <label htmlFor="recall-text" className="text-sm font-semibold text-ink-muted">
              الرسالة (يمكنك تعديلها قبل الإرسال)
            </label>
            <textarea
              id="recall-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 700))}
              rows={5}
              className="w-full resize-y rounded-control border border-line-control bg-surface px-3 py-2.5 text-[0.9375rem] leading-relaxed text-ink caret-brand transition-[border-color,box-shadow] duration-120 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 focus:outline-hidden pointer-coarse:text-base"
            />
            <p className="text-sm text-ink-muted">
              اضغط «واتساب» أمام الزبون لتفتح محادثة جاهزة بهذه الرسالة. تُرسل كل رسالة منك.
            </p>
            <ul
              aria-label="زبائن الدفعة"
              className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto"
            >
              {buyerList(found.sales).people.map((x) => {
                const number = whatsappNumber(x.phone);
                const key = x.phone || x.name;
                return (
                  <li key={key} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-ink">{x.name || x.phone}</span>
                      {x.phone ? (
                        <bdi dir="ltr" className="num text-xs text-ink-muted">
                          {x.phone}
                        </bdi>
                      ) : null}
                    </span>
                    {number ? (
                      <span className="flex shrink-0 items-center gap-2">
                        {sentTo.has(key) ? (
                          <span className="text-sm font-semibold text-success-ink">أُرسلت ✓</span>
                        ) : null}
                        <a
                          href={`https://wa.me/${number}?text=${encodeURIComponent(draft)}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setSentTo((prev) => new Set(prev).add(key))}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-brand px-3 text-sm font-semibold text-on-brand"
                        >
                          <ChatIcon />
                          واتساب
                        </a>
                      </span>
                    ) : (
                      <span className="text-xs text-ink-subtle">بلا رقم</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`أوقف بيع الدفعة ${found?.batchNo ?? ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              تراجع
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                void block(true);
              }}
            >
              أوقف البيع
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          لن يبيع أي صندوق في أي فرع هذه الدفعة حتى ترفع الإيقاف. هل أنت متأكد؟
        </p>
      </Dialog>
      <Dialog
        open={lifting}
        onOpenChange={setLifting}
        title={`ارفع الإيقاف عن الدفعة ${found?.batchNo ?? ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setLifting(false)}>
              تراجع
            </Button>
            <Button
              onClick={() => {
                setLifting(false);
                void block(false);
              }}
            >
              ارفع الإيقاف
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          ستعود كل الصناديق في كل الفروع تبيع هذه الدفعة. هل أنت متأكد؟
        </p>
      </Dialog>
    </AppShell>
  );
}

/** A batch number kept in one piece, read left to right inside Arabic text («QA15-M1» never breaks at the dash) */
function BatchNo({ no }: { no: string }) {
  return (
    <bdi dir="ltr" className="num whitespace-nowrap">
      {no}
    </bdi>
  );
}
