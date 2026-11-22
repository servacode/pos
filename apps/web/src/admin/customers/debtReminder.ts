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

/**
 * «عيد ميلاد سعيد» on WhatsApp: the chat with the customer opened with a short greeting from the shop.
 * Null when the customer has no usable phone.
 */
export function birthdayLink(
  phone: string | null | undefined,
  v: { name: string; store: string },
): string | null {
  const to = whatsappAddress(phone);
  if (!to) return null;
  const text = `كل عام وأنتم بخير ${v.name}، عيد ميلاد سعيد! يتمنى لكم فريق ${v.store} عاماً مليئاً بالفرح، ويسعدنا أن نراكم دائماً.`;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/** Where a birthday falls against today: «today», in this month, or neither (no date, or another month) */
export function birthdayTiming(
  birthDate: string | null | undefined,
  today: string,
): 'today' | 'month' | null {
  if (!birthDate || birthDate.slice(5, 7) !== today.slice(5, 7)) return null;
  return birthDate.slice(8, 10) === today.slice(8, 10) ? 'today' : 'month';
}
