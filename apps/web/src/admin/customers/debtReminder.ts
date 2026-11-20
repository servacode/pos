import { formatMoney, stripBidiControls, type CurrencyCode } from '@serva/core';
import { whatsappAddress } from '../installments/whatsapp';

/**
 * «تذكير بالدين» on WhatsApp: the chat with the customer opened with a short text that names the
 * amount and the shop. Null when the customer has no usable phone, or owes nothing.
 */
export function debtReminderLink(
  phone: string | null | undefined,
  v: { name: string; balanceMinor: number; currency: CurrencyCode; store: string },
): string | null {
  if (v.balanceMinor <= 0) return null;
  const to = whatsappAddress(phone);
  if (!to) return null;
  const amount = stripBidiControls(formatMoney(v.balanceMinor, v.currency));
  const text = `السلام عليكم ${v.name}، نذكّركم بأن رصيدكم المستحق لدى ${v.store} ${amount}. نرجو التسديد في أقرب وقت، وشكراً لثقتكم.`;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
