import { formatMoney, normalizePhone, reminderText, stripBidiControls, type CurrencyCode } from '@serva/core';
import { dayText } from '../../lib/dates';

/** The wa.me address of a phone typed any common way, or null when it is not a phone */
export function whatsappAddress(phone: string | null | undefined): string | null {
  const normal = phone ? normalizePhone(phone) : null;
  return normal ? normal.replace('+', '') : null;
}

/** The chat link that opens WhatsApp with the reminder typed in; null when the phone is not usable */
export function reminderLink(
  phone: string | null | undefined,
  v: {
    kind: 'before' | 'due' | 'late';
    name: string;
    amountMinor: number;
    currency: CurrencyCode;
    due: string;
    no: number;
    of: number;
    store: string;
    daysLate?: number;
  },
): string | null {
  const to = whatsappAddress(phone);
  if (!to) return null;
  const text = reminderText(v.kind, {
    name: v.name,
    amount: stripBidiControls(formatMoney(v.amountMinor, v.currency)),
    due: dayText(v.due),
    no: v.no,
    of: v.of,
    store: v.store,
    daysLate: v.daysLate,
  });
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
