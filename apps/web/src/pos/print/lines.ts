import type { CurrencyCode } from '@serva/core/currencies';
import type {
  GiftVoucherPayload,
  ReceiptPayload,
  ReturnPayload,
  SalePayload,
} from '@serva/core/contracts/documents';
import { formatMoney } from '@serva/core/money';
import { stripBidiControls } from '@serva/core/text';
import { formatQuantity } from '@serva/ui';
import { clockText, dateText } from '../format';
import { methodLabel, type ReceiptData } from '../receipt/Receipt';

/**
 * What a thermal printer prints, line by line (21 › إيصال 80 مم): the same receipt as the screen's,
 * as plain lines a canvas can draw (render.ts) and the printer takes as an image, because most
 * thermal printers carry no Arabic font. A line is a centred text, a «label … amount» pair (label
 * at the start, which is the right in Arabic), a barcode, or a rule.
 */
export type PrintLine =
  | { kind: 'center'; text: string; bold?: boolean; big?: boolean }
  | { kind: 'pair'; start: string; end: string; bold?: boolean }
  | { kind: 'text'; text: string; bold?: boolean }
  | { kind: 'barcode'; code: string }
  | { kind: 'rule' };

/** Under an exchange voucher, on the slip and on the screen's copy */
export const VOUCHER_NOTE = 'تُصرف في المحل بهذا الرقم، كلها أو على دفعات. لا تُصرف نقداً.';

const money = (minor: number, currency: CurrencyCode) => stripBidiControls(formatMoney(minor, currency));

function header(data: ReceiptData, title: string, number: string | null, at: number): PrintLine[] {
  const lines: PrintLine[] = [];
  lines.push({ kind: 'center', text: data.settings.storeName || data.storeName, bold: true, big: true });
  lines.push({
    kind: 'center',
    text: [data.branchName, data.branch?.address].filter(Boolean).join(' · '),
  });
  const contact = [
    data.branch?.phone ? `هاتف ${data.branch.phone}` : null,
    data.settings.taxNumber ? `الرقم الضريبي ${data.settings.taxNumber}` : null,
  ].filter(Boolean);
  if (contact.length) lines.push({ kind: 'center', text: contact.join(' · ') });
  lines.push({ kind: 'rule' });
  lines.push({ kind: 'center', text: title });
  if (number) lines.push({ kind: 'center', text: number, bold: true });
  lines.push({ kind: 'center', text: `${dateText(at)} ، ${clockText(at)}` });
  lines.push({ kind: 'center', text: `الكاشير: ${data.cashierName} · ${data.deviceName}` });
  lines.push({ kind: 'rule' });
  return lines;
}

const footer = (data: ReceiptData, thanks = true): PrintLine[] => [
  { kind: 'rule' },
  ...(data.settings.receiptFooter ? [{ kind: 'center' as const, text: data.settings.receiptFooter }] : []),
  ...(thanks ? [{ kind: 'center' as const, text: 'شكراً لزيارتكم' }] : []),
  { kind: 'center', text: 'سيرفا · Serva' },
];

export function receiptLines(data: ReceiptData, copy = false): PrintLine[] {
  const at = Date.parse(data.doc.deviceTime);
  const lines: PrintLine[] = copy ? [{ kind: 'center', text: '— نسخة —', bold: true }] : [];
  if (data.kind === 'return') {
    const r = data.doc.payload as unknown as ReturnPayload;
    lines.push(...header(data, 'مرتجع مبيعات', data.doc.number, at));
    lines.push({ kind: 'center', text: `عن الفاتورة ${r.saleNumber}` });
    for (const l of r.lines) {
      lines.push({ kind: 'text', text: l.name, bold: true });
      lines.push({ kind: 'pair', start: formatQuantity(l.qty), end: money(l.refund.totalMinor, r.currency) });
    }
    lines.push({ kind: 'rule' });
    lines.push({
      kind: 'pair',
      start: 'المبلغ المردود',
      end: money(r.totals.totalMinor, r.currency),
      bold: true,
    });
    lines.push({ kind: 'pair', start: 'السبب', end: r.reason });
    const voucher = r.refunds.find((x) => x.method === 'voucher');
    if (voucher && data.doc.number) {
      lines.push({ kind: 'rule' });
      lines.push({ kind: 'center', text: 'قسيمة استبدال', bold: true, big: true });
      lines.push({
        kind: 'center',
        text: money(voucher.amountMinor, voucher.currency),
        bold: true,
        big: true,
      });
      lines.push({ kind: 'barcode', code: data.doc.number });
      lines.push({ kind: 'center', text: data.doc.number });
      lines.push({ kind: 'center', text: VOUCHER_NOTE });
    }
    return [...lines, ...footer(data, false)];
  }
  if (data.kind === 'gift') {
    const g = data.doc.payload as unknown as GiftVoucherPayload;
    lines.push(...header(data, 'قسيمة هدية', data.doc.number, at));
    if (g.forName) lines.push({ kind: 'center', text: `إلى ${g.forName}`, bold: true });
    lines.push({ kind: 'center', text: money(g.amountMinor, g.currency), bold: true, big: true });
    if (data.doc.number) {
      lines.push({ kind: 'barcode', code: data.doc.number });
      lines.push({ kind: 'center', text: data.doc.number });
    }
    lines.push({ kind: 'center', text: VOUCHER_NOTE });
    return [...lines, ...footer(data)];
  }
  if (data.kind === 'receipt') {
    const r = data.doc.payload as unknown as ReceiptPayload;
    lines.push(...header(data, 'سند قبض', data.doc.number, at));
    lines.push({ kind: 'pair', start: 'استلمنا من', end: r.customerName });
    lines.push({ kind: 'pair', start: 'المبلغ', end: money(r.amountMinor, r.currency), bold: true });
    lines.push({ kind: 'pair', start: 'الطريقة', end: methodLabel(r.method, r.currency, r.currency) });
    if (r.reference) lines.push({ kind: 'pair', start: 'المرجع', end: r.reference });
    lines.push({ kind: 'center', text: 'دفعة على الحساب' });
    return [...lines, ...footer(data, false)];
  }
  const sale = data.doc.payload as unknown as SalePayload;
  const base = sale.currency;
  lines.push(...header(data, 'فاتورة مبيعات', data.doc.number, at));
  lines.push(...serviceLines(sale));
  for (const l of sale.lines) {
    lines.push({ kind: 'text', text: l.name, bold: true });
    lines.push({
      kind: 'pair',
      start: `${formatQuantity(l.qty)}${l.unitName ? ` ${l.unitName}` : ''} × ${money(l.unitPriceMinor, base)}`,
      end: money(l.priced.grossMinor, base),
    });
    if (l.priced.lineDiscountMinor > 0) {
      lines.push({
        kind: 'pair',
        start: discountLabel(l.discount),
        end: `−${money(l.priced.lineDiscountMinor, base)}`,
      });
    }
    if (l.serials?.length) lines.push({ kind: 'text', text: `IMEI ${l.serials.join('، ')}` });
  }
  lines.push({ kind: 'rule' });
  const t = sale.totals;
  if (t.invoiceDiscountMinor > 0) {
    lines.push({ kind: 'pair', start: 'خصم الفاتورة', end: `−${money(t.invoiceDiscountMinor, base)}` });
  }
  if (t.taxMinor > 0) {
    lines.push({
      kind: 'pair',
      start: sale.taxInclusive ? 'منها ضريبة' : 'الضريبة',
      end: money(t.taxMinor, base),
    });
  }
  lines.push({ kind: 'pair', start: 'الإجمالي', end: money(t.totalMinor, base), bold: true });
  lines.push({ kind: 'rule' });
  for (const p of sale.payments) {
    lines.push({
      kind: 'pair',
      start: methodLabel(p.method, p.currency, base),
      end: money(p.amountMinor, p.currency),
    });
    if (p.reference) lines.push({ kind: 'pair', start: 'المرجع', end: p.reference });
  }
  if (sale.change) {
    lines.push({
      kind: 'pair',
      start: 'الباقي للزبون',
      end: money(sale.change.amountMinor, sale.change.currency),
      bold: true,
    });
  }
  return [...lines, ...footer(data)];
}

/** What a line's discount is called on the receipt: a promotion by its name. */
export function discountLabel(discount: { source: string; reason: string | null } | null): string {
  if (discount?.source === 'promotion') return discount.reason ?? 'عرض';
  return discount?.source === 'price_override' ? 'تعديل السعر' : 'خصم';
}

const ORDER_TYPES: Record<string, string> = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };

/** «رقم الطلب 17» big for the call, and the table or «سفري» (restaurants and cafés only). */
export function serviceLines(sale: Pick<SalePayload, 'service'>): PrintLine[] {
  const service = sale.service;
  if (!service) return [];
  const lines: PrintLine[] = [];
  if (service.orderNo !== null) {
    lines.push({ kind: 'center', text: `رقم الطلب ${service.orderNo}`, bold: true, big: true });
  }
  lines.push({
    kind: 'center',
    text: service.table ? `طاولة ${service.table}` : (ORDER_TYPES[service.orderType] ?? ''),
    bold: true,
  });
  lines.push({ kind: 'rule' });
  return lines;
}
