import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CurrencyCode } from '@serva/core/currencies';
import { CURRENCIES } from '@serva/core/currencies';
import { convert, formatMoney } from '@serva/core/money';
import { oldPoundText, returnWindowDays } from '@serva/core/contracts/till';
import type { BranchRow, SettingsRow } from '@serva/core/contracts/catalog';
import type {
  PaymentMethod,
  ReceiptPayload,
  GiftVoucherPayload,
  ReturnPayload,
  SalePayload,
} from '@serva/core/contracts/documents';
import { rateFor } from '@serva/core/sale';
import type { SyncDocument } from '@serva/sync';
import { cn, displayNumber, formatQuantity, useDigits } from '@serva/ui';
import { ExactMoney } from '../ExactMoney';
import { packPiecesNote } from '../sale/packText';
import { clockText, dateText, isolateSizes } from '../format';
import { Bars } from '../../lib/Bars';
import { dayText } from '../../lib/dates';
import { discountLabel, VOUCHER_NOTE } from '../print/lines';
import { INSTALMENT_TITLE, instalmentRows } from '../print/instalmentLines';
import { DEPOSIT_BACK_NAME } from '../rentals/api';
import { ORDER_TYPE_TEXT } from './KitchenTicket';
import { serialText, warrantyText } from './warranty';

/** « (200 قطعة)» after the packs of a line sold by the box, nothing for single units. */
const packNote = (line: { qty: number; packQty?: number }, digits: Parameters<typeof formatQuantity>[1]) => {
  const note = packPiecesNote(line, (q) => formatQuantity(q, digits));
  return note === null ? '' : ` ${note}`;
};

export type PaperWidth = 80 | 58;

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'نقداً',
  card: 'بطاقة',
  wallet: 'شام كاش',
  transfer: 'تحويل',
  credit: 'آجل على الحساب',
  cheque: 'شيك',
  voucher: 'قسيمة',
  points: 'نقاط الولاء',
};

export function methodLabel(method: PaymentMethod, currency: CurrencyCode, base: CurrencyCode): string {
  if (method === 'cash' && currency !== base)
    return currency === 'USD' ? 'نقداً بالدولار' : `نقداً (${currency})`;
  return METHOD_LABEL[method];
}

export interface ReceiptData {
  /** A sale receipt unless it says return, receipt (a customer's payment) or gift (a gift voucher) */
  kind?: 'sale' | 'return' | 'receipt' | 'gift' | 'deposit';
  doc: Pick<SyncDocument, 'number' | 'deviceTime' | 'payload'>;
  settings: SettingsRow;
  branch: BranchRow | null;
  storeName: string;
  branchName: string;
  deviceName: string;
  cashierName: string;
  /** The salesperson of a sale, named when it is not the cashier (the receipt says «البائع») */
  sellerName?: string | null;
  /** «إيصال هدية»: the sale's slip with no prices or payments, for the person the gift goes to (display and print only) */
  giftReceipt?: boolean;
  /** What is left on each voucher a sale paid with, once the sale is counted */
  vouchersAfter?: { code: string; balanceMinor: number; currency: CurrencyCode }[];
  /** The catalog's services: a fee is work, not a piece, so «عدد القطع» leaves it out */
  serviceVariantIds?: readonly string[];
  /** The items whose price was the customer's contract price: their line says «سعر العقد» (display only) */
  contractVariantIds?: readonly string[];
  /** The tag of each line priced by the customer (contract or wholesale), by line number (display only) */
  priceTags?: Readonly<Record<number, 'contract' | 'wholesale'>>;
  /** What each contract-priced line saved against its shelf price, by line number (display only) */
  contractSavings?: Readonly<Record<number, number>>;
}

/** Why a line's price is the customer's: «سعر العقد» or «سعر الجملة» (null: the shelf price) */
export const priceTag = (data: ReceiptData, line: { lineNo: number; variantId: string }) =>
  data.priceTags?.[line.lineNo] ?? (data.contractVariantIds?.includes(line.variantId) ? 'contract' : null);

/** One whole piece at its own price (no unit, no pack): the line's amount is its price, so it is said once */
export const single = (l: {
  qty: number;
  unitName: string | null;
  packQty: number;
  unitPriceMinor: number;
  priced: { grossMinor: number };
}): boolean =>
  l.qty === 1000 && !l.unitName && l.packQty === 1000 && l.unitPriceMinor === l.priced.grossMinor;

/** The store's own footer usually thanks the customer already: the fixed thanks only follows one that does not */
export const needsThanks = (footer: string | null | undefined): boolean => !footer || !footer.includes('شكر');

/** A payment's reference line («بنك سورية · 000123 · 2026-12-01»): the date in words, the rest as typed */
function Reference({ text }: { text: string }) {
  const digits = useDigits();
  const shown = text.replace(/(\d{4}-\d{2}-\d{2})/g, (day) => dayText(day, digits));
  return <bdi dir="auto">{shown}</bdi>;
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

/** The store, its branch, phone and tax number: the top of every slip */
function ReceiptHeader({ data, width, copy }: { data: ReceiptData; width: PaperWidth; copy: boolean }) {
  return (
    <>
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
    </>
  );
}

/** A receipt is paper: white with dark ink in dark mode too, so the preview looks like what prints */
/* eslint-disable no-restricted-syntax -- paper is white with dark ink whatever the theme: these are the light theme's own values */
export const PAPER = {
  '--color-surface': 'oklch(1 0 0)',
  '--color-ink': 'oklch(0.2048 0.019 171.49)',
  '--color-ink-muted': 'oklch(0.4644 0.0198 167.74)',
  '--color-ink-subtle': 'oklch(0.5133 0.0204 169.44)',
  '--color-line': 'oklch(0.9286 0.0076 164.93)',
} as CSSProperties;
/* eslint-enable no-restricted-syntax */

const slipClass = (width: PaperWidth) =>
  cn(
    'flex flex-col gap-2 bg-surface px-1 py-3 font-semibold text-ink',
    width === 80 ? 'w-[72mm] text-[13px]/[1.55]' : 'w-[48mm] text-[11px]/[1.5]',
  );

const REFUND_LABEL: Record<ReturnPayload['refunds'][number]['method'], string> = {
  cash: 'رُدّ نقداً',
  card: 'رُدّ إلى البطاقة',
  wallet: 'رُدّ إلى شام كاش',
  transfer: 'رُدّ بتحويل',
  voucher: 'قسيمة استبدال',
  account: 'حُسم من حساب الزبون',
};

/** A deposit document's code («DEP-…»): paid with, it reads «عربون», never «قسيمة» */
export function isDepositCode(code: string | null | undefined): boolean {
  return /^DEP-/i.test(code ?? '');
}

/** What a payment is called on a receipt: a deposit paid with is «عربون», the rest by method */
export function paymentLabel(
  p: { method: PaymentMethod; currency: CurrencyCode; reference?: string | null },
  base: CurrencyCode,
): string {
  return p.method === 'voucher' && isDepositCode(p.reference)
    ? 'عربون'
    : methodLabel(p.method, p.currency, base);
}

/** The payment voucher (08 › سند قبض): who paid, how much and how, toward their account. */
function PaymentVoucher({ data, width, copy }: { data: ReceiptData; width: PaperWidth; copy: boolean }) {
  const digits = useDigits();
  const r = data.doc.payload as unknown as ReceiptPayload;
  const at = Date.parse(data.doc.deviceTime);
  return (
    <div dir="rtl" lang="ar" aria-label={`سند قبض ${width} مم`} className={slipClass(width)} style={PAPER}>
      <ReceiptHeader data={data} width={width} copy={copy} />
      <Rule />
      <div className="flex flex-col items-center">
        <span>سند قبض</span>
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
      <Row label="استلمنا من">{r.customerName}</Row>
      <Row label="المبلغ" strong>
        <ExactMoney minor={r.amountMinor} currency={r.currency} />
      </Row>
      <Row label="الطريقة">{methodLabel(r.method, r.currency, r.currency)}</Row>
      {r.reference ? (
        <Row label={<span className="text-xs">المرجع</span>}>
          <Reference text={r.reference} />
        </Row>
      ) : null}
      {r.note ? <Row label={<span className="text-xs">ملاحظة</span>}>{r.note}</Row> : null}
      <p className="text-center text-xs">دفعة على الحساب</p>
      <Rule />
      <p className="text-center text-[10px]">
        سيرفا ·{' '}
        <span lang="en" dir="ltr">
          Serva
        </span>
      </p>
    </div>
  );
}

/** The return slip (08 › مرتجع مبيعات): what came back, from which invoice, and what was paid back. */
function ReturnReceipt({ data, width, copy }: { data: ReceiptData; width: PaperWidth; copy: boolean }) {
  const digits = useDigits();
  const ret = data.doc.payload as unknown as ReturnPayload;
  const at = Date.parse(data.doc.deviceTime);
  const amount = (minor: number) => <ExactMoney minor={minor} currency={ret.currency} symbol={false} />;
  const voucher = ret.refunds.find((r) => r.method === 'voucher');
  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label={`إيصال مرتجع ${width} مم`}
      className={slipClass(width)}
      style={PAPER}
    >
      <ReceiptHeader data={data} width={width} copy={copy} />
      <Rule />
      <div className="flex flex-col items-center">
        <span>مرتجع مبيعات</span>
        <bdi dir="ltr" className="num font-bold">
          {data.doc.number}
        </bdi>
        <span>
          عن الفاتورة{' '}
          <bdi dir="ltr" className="num">
            {ret.saleNumber}
          </bdi>
        </span>
        <span>
          {dateText(at, digits)} ، {clockText(at, digits)}
        </span>
        <span>
          الكاشير: {data.cashierName} · {data.deviceName}
        </span>
      </div>
      <Rule />
      <ul className="flex flex-col gap-1.5">
        {ret.lines.map((line) => (
          <li key={line.lineNo} className="flex flex-col">
            <span className="font-bold">{isolateSizes(line.name)}</span>
            <div className="flex justify-between gap-2">
              <bdi dir="rtl" className="num">
                {formatQuantity(line.qty, digits)}
              </bdi>
              <span className="num">{amount(line.refund.totalMinor)}</span>
            </div>
          </li>
        ))}
      </ul>
      <Rule />
      {ret.totals.taxMinor > 0 ? <Row label="منها ضريبة">{amount(ret.totals.taxMinor)}</Row> : null}
      <Row label="المبلغ المردود" strong>
        <ExactMoney minor={ret.totals.totalMinor} currency={ret.currency} />
      </Row>
      {ret.refunds.map((r, i) => (
        <div key={i} className="flex flex-col">
          {r.roundingMinor ? (
            <Row label="تقريب النقد">
              <bdi dir="ltr">{r.roundingMinor < 0 ? '−' : '+'}</bdi>
              <ExactMoney minor={Math.abs(r.roundingMinor)} currency={r.currency} />
            </Row>
          ) : null}
          <Row label={REFUND_LABEL[r.method]}>
            <ExactMoney minor={r.amountMinor} currency={r.currency} />
          </Row>
          {r.reference ? (
            <Row label={<span className="text-xs">المرجع</span>}>
              <Reference text={r.reference} />
            </Row>
          ) : null}
        </div>
      ))}
      <Row label={<span className="text-xs">السبب</span>}>{ret.reason}</Row>
      {voucher && data.doc.number ? (
        <>
          <Rule />
          <section aria-label="قسيمة الاستبدال" className="flex flex-col items-center gap-1 text-center">
            <span className="text-base font-bold">قسيمة استبدال</span>
            <ExactMoney
              minor={voucher.amountMinor}
              currency={voucher.currency}
              className="text-lg font-bold"
            />
            <div className="h-12 w-full px-2">
              <Bars code={data.doc.number} height={40} />
            </div>
            <bdi dir="ltr" className="num">
              {data.doc.number}
            </bdi>
            <span className="text-xs">{VOUCHER_NOTE}</span>
          </section>
        </>
      ) : null}
      <Rule />
      <p className="text-center text-[10px]">
        سيرفا ·{' '}
        <span lang="en" dir="ltr">
          Serva
        </span>
      </p>
    </div>
  );
}

/** A gift voucher (03 › الألبسة: قسيمة هدية): its amount, who it is for, its bars and its code. */
function GiftVoucherSlip({ data, width, copy }: { data: ReceiptData; width: PaperWidth; copy: boolean }) {
  const title = data.kind === 'deposit' ? 'عربون' : 'قسيمة هدية';
  const digits = useDigits();
  const g = data.doc.payload as unknown as GiftVoucherPayload;
  const at = Date.parse(data.doc.deviceTime);
  return (
    <div dir="rtl" lang="ar" aria-label={`${title} ${width} مم`} className={slipClass(width)} style={PAPER}>
      <ReceiptHeader data={data} width={width} copy={copy} />
      <Rule />
      <section
        aria-label={data.kind === 'deposit' ? 'عربون' : 'قسيمة الهدية'}
        className="flex flex-col items-center gap-1 text-center"
      >
        <span className="text-base font-bold">{title}</span>
        {g.forName ? <span className="font-bold">إلى {g.forName}</span> : null}
        <ExactMoney minor={g.amountMinor} currency={g.currency} className="text-xl font-bold" />
        {data.doc.number ? (
          <>
            <div className="h-12 w-full px-2">
              <Bars code={data.doc.number} height={40} />
            </div>
            <bdi dir="ltr" className="num">
              {data.doc.number}
            </bdi>
          </>
        ) : null}
        <span className="text-xs">{VOUCHER_NOTE}</span>
        <span className="text-xs">
          {dateText(at, digits)} ، {clockText(at, digits)}
        </span>
      </section>
      <Rule />
      <p className="text-center text-[10px]">
        سيرفا ·{' '}
        <span lang="en" dir="ltr">
          Serva
        </span>
      </p>
    </div>
  );
}

/** What a gift receipt says about changing the piece: the store's return window, the invoice number to bring */
export function giftNote(data: ReceiptData): string {
  const days = returnWindowDays(data.settings.till, data.settings.sectors);
  return `للاستبدال أو الإرجاع خلال ${days} يوماً من تاريخ الشراء، أحضر هذا الإيصال.`;
}

/** «إيصال هدية»: the pieces and their count, never a price, a discount or a payment; the invoice barcode stays so the till finds it */
function GiftReceiptSlip({ data, width, copy }: { data: ReceiptData; width: PaperWidth; copy: boolean }) {
  const digits = useDigits();
  const sale = data.doc.payload as unknown as SalePayload;
  const at = Date.parse(data.doc.deviceTime);
  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label={`إيصال هدية ${width} مم`}
      style={PAPER}
      className={cn(
        'flex flex-col gap-2 bg-surface px-1 py-3 font-semibold text-ink',
        width === 80 ? 'w-[72mm] text-[13px]/[1.55]' : 'w-[48mm] text-[11px]/[1.5]',
      )}
    >
      <ReceiptHeader data={data} width={width} copy={copy} />
      <Rule />
      <div className="flex flex-col items-center">
        <span className="text-lg font-bold">إيصال هدية</span>
        <bdi dir="ltr" className="num font-bold">
          {data.doc.number}
        </bdi>
        <span>
          {dateText(at, digits)} ، {clockText(at, digits)}
        </span>
      </div>
      <Rule />
      {sale.lines.map((line) => (
        <div key={line.lineNo} className="flex items-baseline justify-between gap-2">
          <span className="font-bold">{isolateSizes(line.name)}</span>
          <span className="num text-end">{formatQuantity(line.baseQty, digits)}</span>
        </div>
      ))}
      <Rule />
      <p className="text-center text-xs">{giftNote(data)}</p>
      {data.doc.number ? (
        <div className="flex flex-col items-center gap-0.5" aria-label="باركود الفاتورة">
          <div className="h-12 w-full px-2">
            <Bars code={data.doc.number} height={40} />
          </div>
          <bdi dir="ltr" className="num text-[10px]">
            {data.doc.number}
          </bdi>
        </div>
      ) : null}
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
  if (data.kind === 'return') return <ReturnReceipt data={data} width={width} copy={copy} />;
  if (data.kind === 'receipt') return <PaymentVoucher data={data} width={width} copy={copy} />;
  if (data.kind === 'gift' || data.kind === 'deposit')
    return <GiftVoucherSlip data={data} width={width} copy={copy} />;
  if (data.giftReceipt) return <GiftReceiptSlip data={data} width={width} copy={copy} />;
  const sale = data.doc.payload as unknown as SalePayload;
  const base = sale.currency;
  const at = Date.parse(data.doc.deviceTime);
  const foreignRate = sale.exchangeRates[0];
  const foreignCode = foreignRate ? (foreignRate.unit === base ? foreignRate.quote : foreignRate.unit) : null;
  // The dollar line only while the store still offers that currency (or the sale was paid in it)
  const offered =
    foreignCode !== null &&
    ((data.settings.enabledCurrencies ?? []).includes(foreignCode) ||
      sale.payments.some((p) => p.currency === foreignCode));
  const foreign = offered ? foreignCode : null;
  const t = sale.totals;
  const oldPound = data.settings.till?.showOldPound === true && base === 'SYP';
  // A discount keeps its fraction (37.5, not 38): the lines then add up to the total the same way the kernel did
  const exact = (minor: number) => (
    <ExactMoney
      minor={minor}
      currency={base}
      symbol={false}
      {...(minor % 10 ** CURRENCIES[base].decimals !== 0 ? { decimals: CURRENCIES[base].decimals } : {})}
    />
  );
  const contractSaved = Object.values(data.contractSavings ?? {}).reduce((sum, n) => sum + n, 0);
  // The deposit handed back on a rental is money, not a piece sold
  const pieces = sale.lines
    .filter((l) => !l.name.startsWith(DEPOSIT_BACK_NAME) && !data.serviceVariantIds?.includes(l.variantId))
    .reduce((n, l) => n + (l.unitName ? 1 : Math.round(l.baseQty / 1000)), 0);
  const amount = (minor: number, currency: CurrencyCode = base) => (
    <ExactMoney minor={minor} currency={currency} symbol={currency !== base} />
  );

  return (
    <div
      dir="rtl"
      lang="ar"
      aria-label={`إيصال ${width} مم`}
      style={PAPER}
      className={cn(
        'flex flex-col gap-2 bg-surface px-1 py-3 font-semibold text-ink',
        width === 80 ? 'w-[72mm] text-[13px]/[1.55]' : 'w-[48mm] text-[11px]/[1.5]',
      )}
    >
      <ReceiptHeader data={data} width={width} copy={copy} />
      <Rule />
      <div className="flex flex-col items-center">
        <span>فاتورة مبيعات</span>
        <bdi dir="ltr" className="num font-bold">
          {data.doc.number}
        </bdi>
        <span>
          {dateText(at, digits)} ، {clockText(at, digits)}
        </span>
        <span>الكاشير: {data.cashierName}</span>
        {data.sellerName && data.sellerName !== data.cashierName ? (
          <span>البائع: {data.sellerName}</span>
        ) : null}
        {sale.customerName ? <span>الزبون: {sale.customerName}</span> : null}
      </div>
      <Rule />
      {sale.service ? (
        <>
          <div className="flex flex-col items-center font-bold">
            {sale.service.orderNo !== null ? (
              <span className="text-2xl">رقم الطلب {sale.service.orderNo}</span>
            ) : null}
            <span>
              {sale.service.table ? `طاولة ${sale.service.table}` : ORDER_TYPE_TEXT[sale.service.orderType]}
            </span>
          </div>
          <Rule />
        </>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {sale.lines.map((line) => (
          <li key={line.lineNo} className="flex flex-col">
            {single(line) ? (
              // One piece: the name and its amount on one row, not «25,000 × 1» and then 25,000 again
              <div className="flex justify-between gap-2">
                <span className="font-bold">{isolateSizes(line.name)}</span>
                <span className="num">{amount(line.priced.grossMinor)}</span>
              </div>
            ) : (
              <>
                <span className="font-bold">{isolateSizes(line.name)}</span>
                <div className="flex justify-between gap-2">
                  <bdi dir="rtl" className="num">
                    {formatQuantity(line.qty, digits)}
                    {line.unitName ? ` ${line.unitName}` : ''}
                    {packNote(line, digits)} ×{' '}
                    <ExactMoney minor={line.unitPriceMinor} currency={base} symbol={false} />
                  </bdi>
                  <span className="num">{amount(line.priced.grossMinor)}</span>
                </div>
              </>
            )}
            {line.priced.lineDiscountMinor > 0 ? (
              <Row label={discountLabel(line.discount)}>
                <bdi dir="ltr">−{exact(line.priced.lineDiscountMinor)}</bdi>
              </Row>
            ) : null}
            {priceTag(data, line) ? (
              <span className="text-xs">
                {priceTag(data, line) === 'wholesale' ? 'سعر الجملة' : 'سعر العقد'}
                {data.contractSavings?.[line.lineNo] ? (
                  <>
                    {' '}
                    · بدل <s>{amount(line.priced.grossMinor + data.contractSavings[line.lineNo]!)}</s>
                  </>
                ) : null}
              </span>
            ) : null}
            {line.serials?.length ? (
              <span className="text-start">
                <bdi dir="ltr" className="num">
                  {serialText(line, data.settings)}
                </bdi>
              </span>
            ) : null}
            {warrantyText(line, data.doc.deviceTime, data.settings) ? (
              <span className="text-xs">{warrantyText(line, data.doc.deviceTime, data.settings)}</span>
            ) : null}
            {line.batches && line.batches.length > 0 ? (
              <span className="flex flex-col text-xs">
                {line.batches.map((b, n) => (
                  <span key={n}>
                    دفعة <bdi dir="ltr">{b.batchNo ?? '—'}</bdi>
                    {b.expiry ? (
                      <>
                        {' '}
                        · تنتهي <bdi>{dayText(b.expiry, digits)}</bdi>
                      </>
                    ) : null}
                    {/* One batch holds the whole line: the line above already says how many */}
                    {line.batches!.length > 1 ? (
                      <>
                        {' '}
                        × <bdi className="num">{formatQuantity(b.qty, digits)}</bdi>
                      </>
                    ) : null}
                  </span>
                ))}
              </span>
            ) : line.batchNo ? (
              <span className="text-xs">
                دفعة <bdi dir="ltr">{line.batchNo}</bdi>
                {line.batchExpiry ? (
                  <>
                    {' '}
                    · تنتهي <bdi>{dayText(line.batchExpiry, digits)}</bdi>
                  </>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <Rule />
      {t.discountMinor > 0 ? (
        <>
          <Row label="المجموع">{exact(t.grossMinor - t.lineDiscountMinor)}</Row>
          {t.invoiceDiscountMinor > 0 ? (
            <Row label="خصم الفاتورة">
              <bdi dir="ltr">−{exact(t.invoiceDiscountMinor)}</bdi>
            </Row>
          ) : null}
        </>
      ) : null}
      {contractSaved > 0 ? <Row label="وفّرت">{amount(contractSaved)}</Row> : null}
      {t.taxMinor > 0 && t.taxMinor * 100 >= t.totalMinor ? (
        <Row label={sale.taxInclusive ? 'منها ضريبة' : 'الضريبة'}>{amount(t.taxMinor)}</Row>
      ) : null}
      <Row label="الإجمالي" strong>
        <ExactMoney minor={t.totalMinor} currency={base} />
      </Row>
      {oldPound ? (
        <Row label={<span className="text-xs">بالقديم</span>}>
          <bdi className="num">{oldPoundText(t.totalMinor)}</bdi>
        </Row>
      ) : null}
      {foreign && foreignRate ? (
        <Row
          label={
            <span className="text-xs">
              يعادل · سعر الصرف <bdi className="num">{displayNumber(foreignRate.rate, digits)}</bdi>
            </span>
          }
        >
          <ExactMoney
            minor={convert(t.totalMinor, base, foreign, rateFor(sale.exchangeRates, foreign, base))}
            currency={foreign}
          />
        </Row>
      ) : null}
      <Rule />
      {sale.payments.map((p) => (
        <div key={p.paymentNo} className="flex flex-col">
          <Row label={paymentLabel(p, base)}>
            <ExactMoney minor={p.amountMinor} currency={p.currency} />
          </Row>
          {p.reference ? (
            <Row label={<span className="text-xs">المرجع</span>}>
              <Reference text={p.reference} />
            </Row>
          ) : null}
        </div>
      ))}
      {sale.payments.some((p) => p.method === 'credit') ? (
        <>
          {sale.customerBalanceAfterMinor !== null && sale.customerBalanceAfterMinor !== undefined ? (
            <Row label="رصيد الزبون الجديد" strong>
              <ExactMoney minor={sale.customerBalanceAfterMinor} currency={base} />
            </Row>
          ) : null}
          {sale.installmentPlan ? (
            <div className="flex flex-col gap-0.5 pt-2" aria-label={INSTALMENT_TITLE}>
              <span className="text-center font-bold">{INSTALMENT_TITLE}</span>
              {instalmentRows(sale.installmentPlan, (m) => formatMoney(m, base)).map((r) => (
                <Row
                  key={r.label + (r.date ?? '')}
                  label={
                    r.date ? (
                      <>
                        {r.label} · <bdi dir="ltr">{r.date}</bdi>
                      </>
                    ) : (
                      r.label
                    )
                  }
                  strong={r.bold}
                >
                  {r.value}
                </Row>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-1 pt-3" aria-label="توقيع المستلم">
            <span className="text-xs">توقيع المستلم</span>
            <span className="mt-4 block border-b border-dashed border-current" />
          </div>
        </>
      ) : null}
      {data.vouchersAfter
        ?.filter((v) => !isDepositCode(v.code) || v.balanceMinor > 0)
        .map((v) => (
          <Row
            key={v.code}
            label={
              <span className="text-xs">
                {isDepositCode(v.code) ? 'الباقي من العربون' : 'الباقي على القسيمة'}
              </span>
            }
          >
            <ExactMoney minor={v.balanceMinor} currency={v.currency} />
          </Row>
        ))}
      {sale.cashRounding && sale.cashRounding.roundingMinor !== 0 ? (
        <Row label={<span className="text-xs">تقريب النقد</span>}>
          <ExactMoney minor={sale.cashRounding.roundingMinor} currency={sale.cashRounding.currency} />
        </Row>
      ) : null}
      {sale.change ? (
        <Row label="الباقي للزبون" strong>
          <ExactMoney minor={sale.change.amountMinor} currency={sale.change.currency} />
        </Row>
      ) : null}
      {sale.change && oldPound && sale.change.currency === base ? (
        <Row label={<span className="text-xs">الباقي بالقديم</span>}>
          <bdi className="num">{oldPoundText(sale.change.amountMinor)}</bdi>
        </Row>
      ) : null}
      {sale.prescription && (sale.prescription.ref || sale.prescription.doctor) ? (
        <>
          <Rule />
          {sale.prescription.ref ? (
            <Row label="رقم الوصفة">
              <bdi dir="ltr">{sale.prescription.ref}</bdi>
            </Row>
          ) : null}
          {sale.prescription.doctor ? <Row label="الطبيب">{sale.prescription.doctor}</Row> : null}
          {sale.prescription.patientName ? <Row label="المريض">{sale.prescription.patientName}</Row> : null}
        </>
      ) : null}
      <Rule />
      {pieces > 0 ? <Row label="عدد القطع">{displayNumber(String(pieces), digits)}</Row> : null}
      {data.settings.receiptFooter ? (
        <p className="text-center text-xs whitespace-pre-line">{data.settings.receiptFooter}</p>
      ) : null}
      {needsThanks(data.settings.receiptFooter) ? <p className="text-center">شكراً لزيارتكم</p> : null}
      {data.doc.number ? (
        <div className="flex flex-col items-center gap-0.5" aria-label="باركود الفاتورة">
          <div className="h-12 w-full px-2">
            <Bars code={data.doc.number} height={40} />
          </div>
          <bdi dir="ltr" className="num text-[10px]">
            {data.doc.number}
          </bdi>
        </div>
      ) : null}
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
