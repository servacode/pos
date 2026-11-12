import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { SaleDetail, SaleStatus } from '@serva/core';
import type { BranchRow, SettingsRow } from '@serva/core/contracts/catalog';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Money,
  PrintIcon,
  RetryIcon,
  Sheet,
  SkeletonText,
  formatQuantity,
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText, zonedClock } from '../../lib/dates';
import { PrintSheet, usePrint } from '../../lib/print';
import { Receipt, type ReceiptData } from '../../pos/receipt/Receipt';
import { useReport } from '../reports/useReport';
import { getSale } from './api';
import { METHOD_TEXT, SALE_STATUS_TEXT } from './labels';

export function StatusBadge({ status }: { status: SaleStatus }) {
  return (
    <Badge tone={status === 'paid' ? 'success' : status === 'returned' ? 'danger' : 'warning'}>
      {SALE_STATUS_TEXT[status]}
    </Badge>
  );
}

/** What the till's receipt component reads, from what the server kept of this sale. */
export function receiptDataOf(sale: SaleDetail, timezone: string): ReceiptData {
  const r = sale.receipt;
  return {
    kind: 'sale',
    doc: { number: sale.number, deviceTime: sale.deviceTime, payload: sale.payload as never },
    // The receipt reads only the store's name, tax number and footer, and the branch's address and phone
    settings: {
      storeName: r.storeName,
      taxNumber: r.taxNumber,
      receiptFooter: r.receiptFooter,
      timezone,
    } as SettingsRow,
    branch: { name: r.branchName, address: r.branchAddress, phone: r.branchPhone } as BranchRow,
    storeName: r.storeName,
    branchName: r.branchName,
    deviceName: r.deviceName,
    cashierName: r.cashierName,
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/** The A4 print: the same invoice as a full page, marked «نسخة». */
function InvoiceA4({ sale, data }: { sale: SaleDetail; data: ReceiptData }) {
  const me = useMe();
  const digits = useDigits();
  const p = sale.payload;
  const base = p.currency;
  const at = zonedClock(sale.deviceTime, me.tenant.timezone, digits);
  return (
    <div dir="rtl" lang="ar" aria-label="فاتورة A4" className="flex flex-col gap-4 p-2 text-sm text-ink">
      <div className="flex items-start justify-between border-b border-ink pb-2">
        <div>
          <p className="text-lg font-bold">{data.settings.storeName || data.storeName}</p>
          <p>
            {data.branchName}
            {data.branch?.address ? ` · ${data.branch.address}` : ''}
          </p>
          {data.branch?.phone ? (
            <p>
              هاتف <bdi className="num">{data.branch.phone}</bdi>
            </p>
          ) : null}
          {data.settings.taxNumber ? (
            <p>
              الرقم الضريبي <bdi className="num">{data.settings.taxNumber}</bdi>
            </p>
          ) : null}
        </div>
        <div className="text-end">
          <p className="text-xl font-bold">فاتورة مبيعات</p>
          <p className="inline-block border-2 border-ink px-3 font-bold">نسخة</p>
          <p>
            <bdi dir="ltr" className="num font-bold">
              {sale.number}
            </bdi>
          </p>
          <p>
            {dayText(sale.businessDate, digits)} ، {at}
          </p>
        </div>
      </div>
      <p>
        الكاشير: {sale.cashier.fullName ?? '—'} · {sale.device.name}
        {sale.customer ? ` · الزبون: ${sale.customer.name}` : ''}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink">
            <th className="py-1 text-start">الصنف</th>
            <th className="py-1 text-end">الكمية</th>
            <th className="py-1 text-end">السعر</th>
            <th className="py-1 text-end">الخصم</th>
            <th className="py-1 text-end">المجموع</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((line) => (
            <tr key={line.lineNo} className="border-b border-line">
              <td className="py-1">{line.name}</td>
              <td className="num py-1 text-end">
                {formatQuantity(line.qty, digits)}
                {line.unitName ? ` ${line.unitName}` : ''}
              </td>
              <td className="py-1 text-end">
                <Money minor={line.unitPriceMinor} currency={base} symbol={false} />
              </td>
              <td className="py-1 text-end">
                <Money minor={line.priced.lineDiscountMinor} currency={base} symbol={false} />
              </td>
              <td className="py-1 text-end">
                <Money minor={line.priced.totalMinor} currency={base} symbol={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto flex w-72 flex-col gap-1">
        {p.totals.invoiceDiscountMinor > 0 ? (
          <div className="flex justify-between">
            <dt>خصم الفاتورة</dt>
            <dd>
              <Money minor={p.totals.invoiceDiscountMinor} currency={base} />
            </dd>
          </div>
        ) : null}
        {p.totals.taxMinor > 0 ? (
          <div className="flex justify-between">
            <dt>{p.taxInclusive ? 'منها ضريبة' : 'الضريبة'}</dt>
            <dd>
              <Money minor={p.totals.taxMinor} currency={base} />
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-ink pt-1 text-base font-bold">
          <dt>الإجمالي</dt>
          <dd>
            <Money minor={p.totals.totalMinor} currency={base} />
          </dd>
        </div>
        {p.payments.map((pay) => (
          <div key={pay.paymentNo} className="flex justify-between">
            <dt>{METHOD_TEXT[pay.method]}</dt>
            <dd>
              <Money minor={pay.amountMinor} currency={pay.currency} />
            </dd>
          </div>
        ))}
        {p.change ? (
          <div className="flex justify-between">
            <dt>الباقي للزبون</dt>
            <dd>
              <Money minor={p.change.amountMinor} currency={p.change.currency} />
            </dd>
          </div>
        ) : null}
      </dl>
      {data.settings.receiptFooter ? (
        <p className="text-center whitespace-pre-line">{data.settings.receiptFooter}</p>
      ) : null}
      <p className="text-center text-xs">سيرفا · Serva</p>
    </div>
  );
}

type ReturnRow = SaleDetail['returns'][number];

/**
 * One invoice in a side panel: the receipt as the till printed it (marked «نسخة»), who sold it,
 * what came back of it, and the buttons to print it again on 80 mm or A4.
 */
export function InvoiceSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const digits = useDigits();
  const { data, error, loading, retry } = useReport(id, () => getSale(id!));
  const { paper, print } = usePrint();
  const receipt = data ? receiptDataOf(data, me.tenant.timezone) : null;

  const returnColumns: DataColumn<ReturnRow>[] = [
    {
      key: 'number',
      header: 'المرتجع',
      cell: (r) => (
        <bdi dir="ltr" className="num">
          {r.number}
        </bdi>
      ),
    },
    { key: 'date', header: 'اليوم', cell: (r) => dayText(r.businessDate, digits) },
    { key: 'reason', header: 'السبب', cell: (r) => r.reason },
    {
      key: 'total',
      header: 'المبلغ',
      numeric: true,
      cell: (r) => <Money minor={r.totalMinor} currency={data!.currency} />,
    },
  ];

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => !next && onClose()}
      closeOnOutsideClick
      title={data ? `الفاتورة ${data.number}` : 'الفاتورة'}
      description={data ? dayText(data.businessDate, digits) : undefined}
      footer={
        data ? (
          <div className="flex flex-wrap gap-2">
            <Button icon={<PrintIcon />} onClick={() => print('80mm')}>
              اطبع الفاتورة
            </Button>
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => print('A4')}>
              اطبعها على A4
            </Button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div aria-busy="true">
          <span className="sr-only">نحمّل الفاتورة…</span>
          <SkeletonText lines={6} />
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">{error}</Alert>
          <Button variant="secondary" icon={<RetryIcon />} onClick={retry}>
            أعد المحاولة
          </Button>
        </div>
      ) : null}
      {data && receipt ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} />
            {data.flags.length > 0 ? <Badge tone="warning">للمراجعة</Badge> : null}
          </div>
          <dl className="grid gap-4 rounded-card border border-line bg-surface-muted/50 p-4 sm:grid-cols-2">
            <Fact label="الفرع والجهاز">
              {data.branchName} · {data.device.name}
            </Fact>
            <Fact label="الكاشير">{data.cashier.fullName ?? '—'}</Fact>
            <Fact label="الزبون">
              {data.customer ? (
                data.customer.id ? (
                  <Link
                    to={`/customers/${encodeURIComponent(data.customer.id)}`}
                    className="font-semibold text-brand-ink underline-offset-4 hover:underline"
                  >
                    {data.customer.name}
                  </Link>
                ) : (
                  data.customer.name
                )
              ) : (
                '—'
              )}
            </Fact>
            <Fact label="طريقة الدفع">{data.methods.map((m) => METHOD_TEXT[m]).join(' + ') || '—'}</Fact>
          </dl>
          <div className="flex justify-center overflow-x-auto rounded-card border border-line bg-surface p-3 shadow-e1">
            <Receipt data={receipt} width={80} copy />
          </div>
          {data.returns.length > 0 ? (
            <DataTable
              caption={`مرتجعات الفاتورة ${data.number}`}
              columns={returnColumns}
              rows={data.returns}
              rowKey={(r) => r.id}
            />
          ) : null}
          {paper ? (
            <PrintSheet paper={paper}>
              {paper === '80mm' ? (
                <Receipt data={receipt} width={80} copy />
              ) : (
                <InvoiceA4 sale={data} data={receipt} />
              )}
            </PrintSheet>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
