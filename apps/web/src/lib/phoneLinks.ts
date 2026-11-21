/**
 * A phone as typed («0944 111 222», «+963944111222») in the form wa.me and tel: want: digits only,
 * with Syria's country code in place of a leading zero. Null when there is nothing to call.
 */
export function internationalDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `963${digits.slice(1)}`;
  return digits;
}

/** The WhatsApp chat with this phone, or null. */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const digits = internationalDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
