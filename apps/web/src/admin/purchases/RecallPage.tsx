import { useState, type FormEvent } from 'react';
import type { RecallBatch, RecallResponse, RecallSale } from '@serva/core';
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
  TextField,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { AppShell } from '../../layout/AppShell';
import { errorMessage } from '../../lib/api';
import { downloadCsv } from '../exportCsv';
import { getRecall, setBatchBlocked } from './api';
import { SectionHead } from './parts';

/**
 * «سحب دفعة» (03 › الصيدليات): a batch number leads to its product, the receipt and supplier it came
 * in on, what is left of it in each branch, and every invoice and customer that got it (with the
 * phone). One press stops every till from selling it. The list prints, or goes to a CSV file.
 */
export function RecallPage() {
  const digits = useDigits();
  const [batchNo, setBatchNo] = useState('');
  const [found, setFound] = useState<RecallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function search(next?: string) {
    const q = (next ?? batchNo).trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setFound(await getRecall(q));
    } catch (e) {
      setFound(null);
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
          ? `أُوقف بيع الدفعة ${found.batchNo} في كل الفروع (${done.count} صنف).`
          : `رُفع الإيقاف عن الدفعة ${found.batchNo}.`,
      );
      await search(found.batchNo);
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
      cell: (b) => (b.expiryDate ? <bdi className="num">{b.expiryDate}</bdi> : '—'),
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
                <span className="num">{r.receivedOn}</span>
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
      cell: (b) => (b.blocked ? <Badge tone="danger">موقوفة</Badge> : <Badge tone="neutral">تُباع</Badge>),
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
    { key: 'date', header: 'التاريخ', cell: (s) => <span className="num">{s.date}</span> },
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
      <title>سحب دفعة · SERFA</title>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="سحب دفعة"
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
            <Button type="submit" loading={loading} disabled={!batchNo.trim()}>
              ابحث
            </Button>
          </form>
        </Card>
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
                <SectionHead title={`الدفعة ${found.batchNo}`} description="المنتج وأصل الدفعة وما بقي منها.">
                  <span className="flex flex-wrap items-center gap-2 print:hidden">
                    <Button
                      variant={blocked ? 'secondary' : 'primary'}
                      onClick={() => (blocked ? void block(false) : setConfirming(true))}
                    >
                      {blocked ? 'ارفع الإيقاف' : 'أوقف بيعها في كل الفروع'}
                    </Button>
                    <Button variant="secondary" onClick={() => window.print()}>
                      اطبع
                    </Button>
                    <Button variant="secondary" onClick={exportCsv} disabled={found.sales.length === 0}>
                      حمّل CSV
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
    </AppShell>
  );
}
