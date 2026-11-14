import { displayNumber, type Digits } from '@serva/ui';
import { MONTHS } from '../lib/dates';

/** «4:32 م» in the store's digits. */
export function clockText(ms: number, digits: Digits = 'latn'): string {
  const date = new Date(ms);
  const hours = date.getHours();
  const h12 = hours % 12 || 12;
  return `${displayNumber(`${h12}:${String(date.getMinutes()).padStart(2, '0')}`, digits)} ${hours >= 12 ? 'م' : 'ص'}`;
}

/** «30 تشرين الأول 2026». */
/** Digits only, never grouped: a year is «2026», not «2,026». */
function plainDigits(text: string, digits: Digits): string {
  return digits === 'latn' ? text : [...text].map((ch) => displayNumber(ch, digits)).join('');
}

export function dateText(ms: number, digits: Digits = 'latn'): string {
  const date = new Date(ms);
  return `${displayNumber(String(date.getDate()), digits)} ${MONTHS[date.getMonth()]} ${plainDigits(String(date.getFullYear()), digits)}`;
}

/** «3 س 12 د» since a moment. */
export function sinceText(from: number, now: number, digits: Digits = 'latn'): string {
  const minutes = Math.max(0, Math.floor((now - from) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const n = (v: number) => displayNumber(String(v), digits);
  return h > 0 ? `${n(h)} س ${n(m)} د` : `${n(m)} د`;
}

/** The number of the noun's form (never the engine's rules, which differ between browsers) */
function form(n: number): 'one' | 'two' | 'few' | 'many' {
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  // 3 to 10 take the plural; 11 and over take the singular after the number («11 فاتورة»)
  return Number.isInteger(n) && n >= 3 && n <= 10 ? 'few' : 'many';
}

/** «فاتورة واحدة، فاتورتان، 6 فواتير، 12 فاتورة» */
export const INVOICES = ['فاتورة واحدة', 'فاتورتان', 'فواتير', 'فاتورة'] as const;

/** Arabic counted noun: count(3, ['قطعة واحدة','قطعتان','قطع','قطعة']) → «3 قطع». */
export function counted(
  n: number,
  [one, two, few, many]: readonly [string, string, string, string],
  digits: Digits = 'latn',
): string {
  const v = displayNumber(String(n), digits);
  switch (form(n)) {
    case 'one':
      return one;
    case 'two':
      return two;
    case 'few':
      return `${v} ${few}`;
    default:
      return `${v} ${many}`;
  }
}
