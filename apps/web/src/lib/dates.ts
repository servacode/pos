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

/** «31/10/2026» for an ISO day «2026-10-31»: the field format, day first, whatever the browser's locale. */
export function slashDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

/**
 * The ISO day of what was typed: «31/10/2026», «31-10-2026», «٣١/١٠/٢٠٢٦», «1 5 2026» (day, month,
 * year), eight digits «31102026» or already «2026-10-31». Null when it is not a real calendar day.
 */
export function parseDayInput(text: string): string | null {
  const latin = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(latin);
  const local = /^(\d{1,2})[\s/.-](\d{1,2})[\s/.-](\d{4})$/.exec(latin);
  const digitsOnly = /^(\d{2})(\d{2})(\d{4})$/.exec(latin);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])] as [number, number, number];
  else if (local || digitsOnly) {
    const m = (local ?? digitsOnly)!;
    [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  } else return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}
