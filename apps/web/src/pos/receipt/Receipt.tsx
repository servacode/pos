import { createPortal } from 'react-dom';
import type { CurrencyCode } from '@serva/core/currencies';
import { convert } from '@serva/core/money';
import type { BranchRow, SettingsRow } from '@serva/core/contracts/catalog';
import type { PaymentMethod, SalePayload } from '@serva/core/contracts/documents';
import { rateFor } from '@serva/core/sale';
import type { SyncDocument } from '@serva/sync';
import { cn, displayNumber, formatQuantity, Money, useDigits } from '@serva/ui';
import { clockText, dateText } from '../format';

export type PaperWidth = 80 | 58;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل على الحساب',
};

export function methodLabel(method: PaymentMethod, currency: CurrencyCode, base: CurrencyCode): string {
  if (method === 'cash' && currency !== base)
    return currency === 'USD' ? 'نقداً بالدولار' : `نقداً (${currency})`;
  return METHOD_LABEL[method];
}

export interface ReceiptData {
  doc: Pick<SyncDocument, 'number' | 'deviceTime' | 'payload'>;
  settings: SettingsRow;
  branch: BranchRow | null;
  storeName: string;
  branchName: string;
  deviceName: string;
  cashierName: string;
}

function Row({
  label,
  children,
  strong = false,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-2', strong && 'text-base font-bold')}>
      <span>{label}</span>
      <span className="num text-end">{children}</span>
    </div>
  );
}

const Rule = () => <hr className="border-0 border-t border-dashed border-ink" />;

/**
 * The sale receipt (21 › إيصال 80 مم; print/Receipt80): the store, the number and the moment, each
 * line with «quantity × price», the discounts, the total and its value in dollars, the payments,
 * the change, and the store's footer. Everything comes from the saved document and `settings`, so
 * a reprint is the same receipt, marked «نسخة».
 */
export function Receipt({
  data,
  width = 80,
  copy = false,
}: {
  data: ReceiptData;
  width?: PaperWidth;
  copy?: boolean;
}) {
  const digits = useDigits();
  const sale = data.doc.payload as unknown as SalePayload;
  const base = sale.currency;
  const at = Date.parse(data.doc.deviceTime);
  const foreignRate = sale.exchangeRates[0];
  const foreign = foreignRate ? (foreignRate.unit === base ? foreignRate.quote : foreignRate.unit) : null;
  const t = sale.totals;
  const pieces = sale.lines.reduce((n, l) => n + (l.unitName ? 1 : Math.round(l.baseQty / 1000)), 0);
  const amount = (minor: number, currency: CurrencyCode = base) => (
    <Money minor={minor} currency={currency} symbol={currency !== base} />
  );

  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label={`إيصال ${width} مم`}
      className={cn(
        'flex flex-col gap-2 bg-surface px-1 py-3 font-semibold text-ink',
        width === 80 ? 'w-[72mm] text-[13px]/[1.55]' : 'w-[48mm] text-[11px]/[1.5]',
      )}
    >
      {copy ? <p className="self-center border-2 border-ink px-3 text-base font-bold">نسخة</p> : null}
      <div className="flex flex-col items-center text-center">
        <span className={cn('font-bold', width === 80 ? 'text-xl' : 'text-base')}>
          {data.settings.storeName || data.storeName}
        </span>
        <span className="text-xs">
          {data.branchName}
          {data.branch?.address ? ` · ${data.branch.address}` : ''}
        </span>
        {data.branch?.phone || data.settings.taxNumber ? (
          <span className="text-xs">
            {data.branch?.phone ? (
              <>
                هاتف <bdi className="num">{data.branch.phone}</bdi>
              </>
            ) : null}
            {data.branch?.phone && data.settings.taxNumber ? ' · ' : null}
            {data.settings.taxNumber ? (
              <>
                الرقم الضريبي <bdi className="num">{data.settings.taxNumber}</bdi>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      <Rule />
      <div className="flex flex-col items-center">
        <span>فاتورة مبيعات</span>
        <bdi dir="ltr" className="num font-bold">
          {data.doc.number}
        </bdi>
        <span>
          {dateText(at, digits)} ، {clockText(at, digits)}
        </span>
        <span>
          الكاشير: {data.cashierName} · {data.deviceName}
        </span>
      </div>
      <Rule />
      <ul className="flex flex-col gap-1.5">
        {sale.lines.map((line) => (
          <li key={line.lineNo} className="flex flex-col">
            <span className="font-bold">{line.name}</span>
            <div className="flex justify-between gap-2">
              <bdi dir="rtl" className="num">
                {formatQuantity(line.qty, digits)}
                {line.unitName ? ` ${line.unitName}` : ''} ×{' '}
                <Money minor={line.unitPriceMinor} currency={base} symbol={false} />
              </bdi>
              <span className="num">{amount(line.priced.grossMinor)}</span>
            </div>
            {line.priced.lineDiscountMinor > 0 ? (
              <Row label={line.discount?.source === 'price_override' ? 'تعديل السعر' : 'خصم'}>
                <bdi dir="ltr">−</bdi>
                {amount(line.priced.lineDiscountMinor)}
              </Row>
            ) : null}
          </li>
        ))}
      </ul>
      <Rule />
      {t.discountMinor > 0 ? (
        <>
          <Row label="المجموع">{amount(t.grossMinor - t.lineDiscountMinor)}</Row>
          {t.invoiceDiscountMinor > 0 ? (
            <Row label="خصم الفاتورة">
              <bdi dir="ltr">−</bdi>
              {amount(t.invoiceDiscountMinor)}
            </Row>
          ) : null}
        </>
      ) : null}
      {t.taxMinor > 0 ? (
        <Row label={sale.taxInclusive ? 'منها ضريبة' : 'الضريبة'}>{amount(t.taxMinor)}</Row>
      ) : null}
      <Row label="الإجمالي" strong>
        <Money minor={t.totalMinor} currency={base} />
      </Row>
      {foreign && foreignRate ? (
        <Row
          label={
            <span className="text-xs">
              يعادل · سعر الصرف <bdi className="num">{displayNumber(foreignRate.rate, digits)}</bdi>
            </span>
          }
        >
          <Money
            minor={convert(t.totalMinor, base, foreign, rateFor(sale.exchangeRates, foreign, base))}
            currency={foreign}
          />
        </Row>
      ) : null}
      <Rule />
      {sale.payments.map((p) => (
        <div key={p.paymentNo} className="flex flex-col">
          <Row label={methodLabel(p.method, p.currency, base)}>
            <Money minor={p.amountMinor} currency={p.currency} />
          </Row>
          {p.reference ? (
            <Row label={<span className="text-xs">المرجع</span>}>
              <bdi dir="ltr">{p.reference}</bdi>
            </Row>
          ) : null}
        </div>
      ))}
      {sale.cashRounding && sale.cashRounding.roundingMinor !== 0 ? (
        <Row label={<span className="text-xs">تقريب النقد</span>}>
          <Money minor={sale.cashRounding.roundingMinor} currency={sale.cashRounding.currency} />
        </Row>
      ) : null}
      {sale.change ? (
        <Row label="الباقي للزبون" strong>
          <Money minor={sale.change.amountMinor} currency={sale.change.currency} />
        </Row>
      ) : null}
      <Rule />
      <Row label="عدد القطع">{displayNumber(String(pieces), digits)}</Row>
      {data.settings.receiptFooter ? (
        <p className="text-center text-xs whitespace-pre-line">{data.settings.receiptFooter}</p>
      ) : null}
      <p className="text-center">شكراً لزيارتكم</p>
      <p className="text-center text-[10px]">
        سيرفا ·{' '}
        <span lang="en" dir="ltr">
          Serva
        </span>
      </p>
    </div>
  );
}

/**
 * What `window.print()` prints: the receipt in a portal on <body>, with the paper's page size.
 * Hidden on screen; while it is mounted, the print stylesheet hides everything else.
 */
export function PrintableReceipt({
  data,
  width,
  copy,
}: {
  data: ReceiptData;
  width: PaperWidth;
  copy?: boolean;
}) {
  return createPortal(
    <div data-print-receipt="" className="hidden print:block">
      <style>{`@page { size: ${width}mm auto; margin: 0 }`}</style>
      <Receipt data={data} width={width} copy={copy} />
    </div>,
    document.body,
  );
}
