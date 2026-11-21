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

/**
 * A phone for contact details (a store, a customer, a supplier): everything normalizePhone accepts,
 * and a Syrian landline too — 011 2345678, +963 11 234 5678 — kept as +96311…
 * An area code is two digits (11 Damascus, 21 Aleppo, 31 Homs, …) followed by six or seven digits.
 * Logins and registration keep using normalizePhone: they need a mobile that can get a code.
 */
export function normalizeContactPhone(input: string): string | null {
  const mobile = normalizePhone(input);
  if (mobile) return mobile;
  const raw = toLatinDigits(input).replace(/[\s\-().]/g, '');
  let national: string;
  if (raw.startsWith('+963')) national = `0${raw.slice(4)}`;
  else if (raw.startsWith('00963')) national = `0${raw.slice(5)}`;
  else if (raw.startsWith('963') && raw.length >= 11) national = `0${raw.slice(3)}`;
  else national = raw;
  const match = /^0([1-8]\d)(\d{6,7})$/.exec(national);
  return match ? `+963${match[1]}${match[2]}` : null;
}
