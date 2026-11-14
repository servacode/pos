import { useState, type ReactNode } from 'react';
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
  useDigits,
  type DataColumn,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText } from '../../lib/dates';
import { DeliveryNoteA4, InvoiceA4, type A4SaleData } from '../../lib/a4/documents';
import { PrintSheet, usePrint } from '../../lib/print';
import { Receipt, type ReceiptData } from '../../pos/receipt/Receipt';
import { useReport } from '../reports/useReport';
import { WarrantyDevices } from '../warranty/WarrantyDevices';
import { getSale } from './api';
import { METHOD_TEXT, SALE_STATUS_TEXT } from './labels';

/** What the serial flags of a sale mean to the owner (03 › الإلكترونيات) */
const SERIAL_FLAG_TEXT: Record<string, string> = {
  unknown_serial: 'رقم تسلسلي لم يُستلم',
  serial_sold_twice: 'رقم تسلسلي مباع من قبل',
  serial_other_product: 'رقم تسلسلي لصنف آخر',
};

export function StatusBadge({ status }: { status: SaleStatus }) {
  return (
    <Badge tone={status === 'paid' ? 'success' : status === 'returned' ? 'danger' : 'warning'}>
      {SALE_STATUS_TEXT[status]}
    </Badge>
  );
}

/** What the till's receipt component reads, from what the server kept of this sale. */
export function receiptDataOf(
  sale: SaleDetail,
  timezone: string,
  sectors?: SettingsRow['sectors'],
): ReceiptData {
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
      sectors,
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

/** What the A4 documents read, from what the server kept of this sale and its customer. */
export function a4DataOf(sale: SaleDetail, timezone: string): A4SaleData {
  const r = sale.receipt;
  const c = sale.customerDetails;
  return {
    store: {
      name: r.storeName,
      taxNumber: r.taxNumber,
      branchName: r.branchName,
      address: r.branchAddress,
      phone: r.branchPhone,
      footer: r.receiptFooter,
    },
    number: sale.number,
    deviceTime: sale.deviceTime,
    timezone,
    customer: sale.customer
      ? {
          name: sale.customer.name,
          phone: c?.phone ?? null,
          taxNumber: c?.taxNumber ?? null,
          address: c?.address ?? null,
        }
      : null,
    payload: sale.payload,
    cashierName: sale.cashier.fullName,
    copy: true,
  };
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
  // What the A4 sheet holds: the invoice, or its delivery note with or without prices
  const [a4, setA4] = useState<'invoice' | 'delivery' | 'delivery-prices'>('invoice');
  const printA4 = (kind: typeof a4) => {
    setA4(kind);
    print('A4');
  };
  const receipt = data ? receiptDataOf(data, me.tenant.timezone, me.tenant.sectors) : null;

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
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => printA4('invoice')}>
              اطبعها على A4
            </Button>
            <Button variant="secondary" icon={<PrintIcon />} onClick={() => printA4('delivery')}>
              إشعار تسليم
            </Button>
            <Button variant="ghost" icon={<PrintIcon />} onClick={() => printA4('delivery-prices')}>
              إشعار تسليم بالأسعار
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
            {data.flags.flatMap((f) =>
              SERIAL_FLAG_TEXT[f]
                ? [
                    <Badge key={f} tone="warning">
                      {SERIAL_FLAG_TEXT[f]}
                    </Badge>,
                  ]
                : [],
            )}
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
          <WarrantyDevices
            by={{ saleId: data.id }}
            storeName={receipt.storeName}
            branchName={receipt.branchName}
            customerName={data.customer?.name ?? null}
          />
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
              ) : a4 === 'invoice' ? (
                <InvoiceA4 data={a4DataOf(data, me.tenant.timezone)} />
              ) : (
                <DeliveryNoteA4
                  data={a4DataOf(data, me.tenant.timezone)}
                  withPrices={a4 === 'delivery-prices'}
                />
              )}
            </PrintSheet>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
