import { toLatinDigits } from './text';

/**
 * Normalizes a phone number to E.164 (+963...).
 * Syrian mobiles are accepted in any common form: 09XXXXXXXX, 9XXXXXXXX, 9639XXXXXXXX, 009639..., +9639...
 * Foreign numbers are accepted only with a leading + or 00 and 8 to 15 digits.
 * Returns null when the input is not a valid phone number.
 */
export function normalizePhone(input: string): string | null {
  const raw = toLatinDigits(input).replace(/[\s\-().]/g, '');
  if (raw === '') return null;

  let digits: string;
  let international = false;
  if (raw.startsWith('+')) {
    digits = raw.slice(1);
    international = true;
  } else if (raw.startsWith('00')) {
    digits = raw.slice(2);
    international = true;
  } else {
    digits = raw;
  }
  if (!/^\d+$/.test(digits)) return null;

  if (!international) {
    // Local Syrian forms
    if (/^09\d{8}$/.test(digits)) return `+963${digits.slice(1)}`;
    if (/^9\d{8}$/.test(digits)) return `+963${digits}`;
    if (/^9639\d{8}$/.test(digits)) return `+${digits}`;
    return null;
  }

  if (digits.startsWith('963')) {
    return /^9639\d{8}$/.test(digits) ? `+${digits}` : null;
  }
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
