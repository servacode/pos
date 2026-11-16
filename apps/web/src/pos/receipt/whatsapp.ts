import type { SalePayload } from '@serva/core/contracts/documents';
import { formatMoney } from '@serva/core/money';
import { normalizePhone } from '@serva/core/phone';
import { stripBidiControls } from '@serva/core/text';
import { formatQuantity } from '@serva/ui';
import { methodLabel, type ReceiptData } from './Receipt';
import { serialText, warrantyText } from './warranty';

/** The wa.me address of a phone typed any common way (Syrian forms go to 963…), or null when it is not a phone */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const normal = phone ? normalizePhone(phone) : null;
  return normal ? normal.replace('+', '') : null;
}

/** A short plain-text receipt for the customer's chat: store, number, lines, total, paid, change or debt */
export function receiptText(data: ReceiptData): string {
  const sale = data.doc.payload as unknown as SalePayload;
  const base = sale.currency;
  const money = (minor: number, currency = base) => stripBidiControls(formatMoney(minor, currency));
  const out: string[] = [data.settings.storeName || data.storeName];
  out.push(`فاتورة رقم ${data.doc.number ?? ''}`.trim());
  if (sale.customerName) out.push(`الزبون: ${sale.customerName}`);
  out.push('');
  for (const l of sale.lines) {
    out.push(`${l.name} × ${formatQuantity(l.qty)} = ${money(l.priced.totalMinor)}`);
    if (data.contractVariantIds?.includes(l.variantId)) {
      const was = data.contractSavings?.[l.lineNo];
      out.push(was ? `سعر العقد (بدل ${money(l.priced.grossMinor + was)})` : 'سعر العقد');
    }
    const serial = serialText(l, data.settings);
    if (serial) out.push(serial);
    const warranty = warrantyText(l, data.doc.deviceTime, data.settings);
    if (warranty) out.push(warranty);
  }
  out.push('');
  const contractSaved = Object.values(data.contractSavings ?? {}).reduce((sum, n) => sum + n, 0);
  if (contractSaved > 0) out.push(`وفّرت ${money(contractSaved)} بسعر العقد`);
  out.push(`الإجمالي: ${money(sale.totals.totalMinor)}`);
  for (const p of sale.payments) {
    out.push(`${methodLabel(p.method, p.currency, base)}: ${money(p.amountMinor, p.currency)}`);
  }
  if (sale.cashRounding && sale.cashRounding.roundingMinor !== 0) {
    const r = sale.cashRounding;
    out.push(
      `قُرّب المبلغ إلى ${money(r.dueMinor, r.currency)} (فرق ${stripBidiControls(formatMoney(Math.abs(r.roundingMinor), r.currency, { decimals: 2, trimZeros: true }))})`,
    );
  }
  if (sale.change) out.push(`الباقي للزبون: ${money(sale.change.amountMinor, sale.change.currency)}`);
  const debt = sale.customerBalanceAfterMinor;
  if (sale.payments.some((p) => p.method === 'credit') && debt !== null && debt !== undefined) {
    out.push(`رصيدك الجديد: ${money(debt)}`);
  }
  out.push('', 'شكراً لزيارتكم');
  return out.join('\n');
}

/** The chat link that opens WhatsApp with the receipt typed in; null when the phone is not usable */
export function whatsappLink(phone: string | null | undefined, data: ReceiptData): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(receiptText(data))}` : null;
}
