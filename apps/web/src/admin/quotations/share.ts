import { formatMoney, stripBidiControls, type Quotation } from '@serva/core';
import { dayText } from '../../lib/dates';
import { whatsappAddress } from '../installments/whatsapp';

const money = (minor: number, currency: Quotation['currency']) =>
  stripBidiControls(formatMoney(minor, currency));

/** «2» or «1.5», the quantity of a line as the customer reads it (the line's qty is in thousandths) */
function qtyText(thousandths: number): string {
  return String(thousandths / 1000);
}

/**
 * The offer as a WhatsApp message: who it is for, each line with its quantity and total, the discount
 * and the total, the day it stands until, then the notes and terms. Plain text, no Latin words.
 */
export function quotationMessage(q: Quotation, storeName: string | null): string {
  const lines: string[] = [];
  lines.push(storeName ? `عرض سعر من ${storeName}` : 'عرض سعر');
  lines.push(`رقم العرض: ${q.number}`);
  if (q.customerName) lines.push(`السادة: ${q.customerName}`);
  lines.push('');
  for (const [i, l] of q.lines.entries()) {
    const unit = l.packName ? ` ${l.packName}` : l.unitName ? ` ${l.unitName}` : '';
    lines.push(`${i + 1}. ${l.name}: ${qtyText(l.qty)}${unit} = ${money(l.priced.totalMinor, q.currency)}`);
  }
  lines.push('');
  if (q.totals.discountMinor > 0) lines.push(`الخصم: ${money(q.totals.discountMinor, q.currency)}`);
  lines.push(`الإجمالي: ${money(q.totals.totalMinor, q.currency)}`);
  lines.push(`الأسعار صالحة حتى ${dayText(q.validUntil)}`);
  if (q.notes) lines.push('', `ملاحظات: ${q.notes}`);
  if (q.terms) lines.push('', `الشروط: ${q.terms}`);
  return lines.join('\n');
}

/**
 * The chat link that opens WhatsApp with the offer typed in: on the customer's chat when the phone is a
 * usable one, else with no chat chosen (WhatsApp then asks whom to send it to).
 */
export function quotationWhatsappLink(phone: string | null | undefined, text: string): string {
  const to = whatsappAddress(phone) ?? '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
