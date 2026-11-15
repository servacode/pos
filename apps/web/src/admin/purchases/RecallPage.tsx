import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
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
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { dayText } from '../../lib/dates';
import { downloadCsv } from '../exportCsv';
import { getRecall, listExpiry, setBatchBlocked } from './api';
import { SectionHead } from './parts';

/**
 * «استدعاء دفعة (سحب من السوق)» (03 › الصيدليات): a batch number leads to its product, the receipt and supplier it came
 * in on, what is left of it in each branch, and every invoice and customer that got it (with the
 * phone). One press stops every till from selling it. The list prints, or goes to a CSV file.
 */
export function RecallPage() {
  const digits = useDigits();
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
    if (prefilled) void search(prefilled);
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
        s.customerName ?? '',
        s.customerPhone ?? '',
      ]),
    );
  }

  const blocked = found?.batches.some((b) => b.blocked) ?? false;
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
      header: 'بِيع',
      numeric: true,
      cell: (b) => formatQuantity(b.soldQty, digits),
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
      <title>استدعاء دفعة · SERFA</title>
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
                    title={`الدفعة ${found.batchNo}`}
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
                </section>
              </>
            )
          ) : null}
        </div>
      </div>
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
