import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { SaleDetail } from '@serva/core';
import type { BranchRow, SettingsRow } from '@serva/core/contracts/catalog';
import {
  Alert,
  Badge,
  Button,
  PrintIcon,
  RetryIcon,
  Sheet,
  SkeletonText,
  TransferIcon,
  useDigits,
} from '@serva/ui';
import { useMe } from '../../auth/useAuth';
import { dayText } from '../../lib/dates';
import { useIsPhone } from '../../lib/useIsPhone';
import { DeliveryNoteA4, InvoiceA4, type A4SaleData } from '../../lib/a4/documents';
import { PrintSheet, usePrint } from '../../lib/print';
import { Receipt, type ReceiptData } from '../../pos/receipt/Receipt';
import { useReport } from '../reports/useReport';
import { WarrantyDevices } from '../warranty/WarrantyDevices';
import { getSale } from './api';
import { METHOD_TEXT } from './labels';
import { Amt, SaleStatusBadge } from './ui';

/** What the serial flags of a sale mean to the owner (03 › الإلكترونيات) */
const SERIAL_FLAG_TEXT: Record<string, string> = {
  unknown_serial: 'رقم تسلسلي لم يُستلم',
  serial_sold_twice: 'رقم تسلسلي مباع من قبل',
  serial_other_product: 'رقم تسلسلي لصنف آخر',
  serial_missing: 'بيعة بلا رقم تسلسلي',
};

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
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd>{children}</dd>
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
 * One invoice in a side panel (a bottom sheet on a phone): who sold it and to whom, what came back
 * of it, the receipt as the till printed it (marked «نسخة»), and the buttons to exchange or return
 * it at the till and to print it again on 80 mm or A4.
 */
export function InvoiceSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const digits = useDigits();
  const phone = useIsPhone();
  const { data, error, loading, retry } = useReport(id, () => getSale(id!));
  const { paper, print } = usePrint();
  // What the A4 sheet holds: the invoice, or its delivery note with or without prices
  const [a4, setA4] = useState<'invoice' | 'delivery' | 'delivery-prices'>('invoice');
  const printA4 = (kind: typeof a4) => {
    setA4(kind);
    print('A4');
  };
  const receipt = data ? receiptDataOf(data, me.tenant.timezone, me.tenant.sectors) : null;
  const navigate = useNavigate();
  const [noTill, setNoTill] = useState(false);
  // What the printed receipt shows that a customer may not follow (read off the receipt itself)
  const [notes, setNotes] = useState({ oldPound: false, rounding: false });

  /** The return is done at the till: this browser opens it there only when it is paired as one. */
  async function toTill(number: string) {
    setNoTill(false);
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
    void navigate(`/pos?return=${encodeURIComponent(number)}`);
  }

  return (
    <Sheet
      open={id !== null}
      onOpenChange={(next) => !next && onClose()}
      closeOnOutsideClick
      side={phone ? 'bottom' : 'end'}
      title={data ? `الفاتورة ${data.number}` : 'الفاتورة'}
      description={data ? dayText(data.businessDate, digits) : undefined}
      footer={
        data ? (
          <div className="sx sx-sheet-f">
            {data.status !== 'returned' ? (
              <Button className="main" icon={<TransferIcon />} onClick={() => void toTill(data.number)}>
                استبدال / مرتجع
              </Button>
            ) : null}
            <div className="sx-tools">
              <Button variant="ghost" size="sm" icon={<PrintIcon />} onClick={() => print('80mm')}>
                اطبع الفاتورة
              </Button>
              <Button variant="ghost" size="sm" icon={<PrintIcon />} onClick={() => printA4('invoice')}>
                اطبعها على A4
              </Button>
              <Button variant="ghost" size="sm" icon={<PrintIcon />} onClick={() => printA4('delivery')}>
                إشعار تسليم
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<PrintIcon />}
                onClick={() => printA4('delivery-prices')}
              >
                إشعار تسليم بالأسعار
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="sx sx-sheet">
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
              <SaleStatusBadge status={data.status} />
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
            <dl className="sx-facts">
              <Fact label="الفرع والجهاز">
                {data.branchName} · {data.device.name}
              </Fact>
              <Fact label="الكاشير">{data.cashier.fullName ?? '—'}</Fact>
              <Fact label="الزبون">
                {data.customer ? (
                  data.customer.id ? (
                    <Link
                      to={`/customers/${encodeURIComponent(data.customer.id)}`}
                      className="text-brand-ink underline-offset-4 hover:underline"
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
            <dl className="sx-tots">
              <div>
                <dt className="sx-mute">{data.returnedMinor > 0 ? 'المجموع' : 'الإجمالي'}</dt>
                <dd>
                  <Amt minor={data.totalMinor} currency={data.currency} />
                </dd>
              </div>
              {data.returnedMinor > 0 ? (
                <>
                  <div>
                    <dt className="sx-mute">المرتجع</dt>
                    <dd>
                      <Amt minor={-data.returnedMinor} currency={data.currency} neg />
                    </dd>
                  </div>
                  <div className="grand">
                    <dt>الصافي</dt>
                    <dd>
                      <Amt minor={data.totalMinor - data.returnedMinor} currency={data.currency} />
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
            {noTill ? (
              <Alert tone="info" title="هذا المتصفح غير مربوط بكاشير">
                <span className="flex flex-col gap-2">
                  <span>
                    الاستبدال والمرتجع يتمّان على جهاز الكاشير: اختر «مرتجع» من قائمته واكتب رقم الفاتورة{' '}
                    <bdi dir="ltr" className="num font-semibold">
                      {data.number}
                    </bdi>
                    . أو اربط هذا المتصفح بالكاشير.
                  </span>
                  <Link to="/pos" className="w-fit font-semibold text-brand-ink underline underline-offset-4">
                    اربط هذا المتصفح بالكاشير
                  </Link>
                </span>
              </Alert>
            ) : null}
            <WarrantyDevices
              by={{ saleId: data.id }}
              storeName={receipt.storeName}
              branchName={receipt.branchName}
              customerName={data.customer?.name ?? null}
            />
            <details open className="sx-slip">
              <summary>الإيصال كما طُبع</summary>
              <div
                ref={(el) => {
                  if (!el) return;
                  const shown = el.textContent ?? '';
                  const next = {
                    oldPound: shown.includes('بالقديم'),
                    rounding: shown.includes('تقريب النقد'),
                  };
                  setNotes((prev) =>
                    prev.oldPound === next.oldPound && prev.rounding === next.rounding ? prev : next,
                  );
                }}
              >
                <Receipt data={receipt} width={80} copy />
              </div>
            </details>
            {notes.oldPound || notes.rounding ? (
              <p className="text-sm text-ink-muted">
                {notes.oldPound ? '«بالقديم»: المبلغ نفسه بالليرة القديمة، للعرض فقط. ' : ''}
                {notes.rounding
                  ? '«تقريب النقد»: فرق صغير يُقرَّب عند الدفع نقداً ليسهل إعطاء الباقي، وهو محسوب في الدفع.'
                  : ''}
              </p>
            ) : null}
            {data.returns.length > 0 ? (
              <ul className="sx-lines" aria-label={`مرتجعات الفاتورة ${data.number}`}>
                {data.returns.map((r: ReturnRow) => (
                  <li key={r.id} className="sx-ln returned">
                    <span className="nm">
                      <bdi dir="ltr" className="sx-n">
                        {r.number}
                      </bdi>
                    </span>
                    <span className="p">
                      <Amt minor={r.totalMinor} currency={data.currency} />
                    </span>
                    <span className="q">
                      {dayText(r.businessDate, digits)} · {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
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
      </div>
    </Sheet>
  );
}
