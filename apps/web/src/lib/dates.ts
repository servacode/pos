import type { Digits } from '@serva/ui';

/** Levantine month names, as on the boards and receipts («30 تشرين الأول 2026»). */
export const MONTHS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
] as const;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Digits only, in the store's digits, with no thousands separator: a year stays «2026». */
function digitsOf(text: string, digits: Digits): string {
  if (digits === 'latn') return text;
  let out = '';
  for (const ch of text) out += ch >= '0' && ch <= '9' ? ARABIC_DIGITS.charAt(Number(ch)) : ch;
  return out;
}

/** The store's calendar day of a moment, «2026-10-31», in its time zone (the reports' `date`). */
export function isoDay(ms: number, timeZone: string): string {
  const { year, month, day } = zonedParts(ms, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The first day of the month of an ISO day: «2026-10-01». */
export function monthStart(day: string): string {
  return `${day.slice(0, 8)}01`;
}

/** «31 تشرين الأول 2026» for an ISO day «2026-10-31». */
export function dayText(day: string, digits: Digits = 'latn'): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return day;
  return `${digitsOf(String(date), digits)} ${MONTHS[month - 1]} ${digitsOf(String(year), digits)}`;
}

/** «4:32 م» of a moment in the store's time zone. */
export function zonedClock(iso: string, timeZone: string, digits: Digits = 'latn'): string {
  const { hour, minute } = zonedParts(Date.parse(iso), timeZone);
  const h12 = hour % 12 || 12;
  return `${digitsOf(`${h12}:${pad(minute)}`, digits)} ${hour >= 12 ? 'م' : 'ص'}`;
}

/** «31 تشرين الأول 2026، 4:32 م» of a moment in the store's time zone. */
export function zonedDateTime(iso: string, timeZone: string, digits: Digits = 'latn'): string {
  const ms = Date.parse(iso);
  return `${dayText(isoDay(ms, timeZone), digits)}، ${zonedClock(iso, timeZone, digits)}`;
}
