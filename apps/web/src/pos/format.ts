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
export function dateText(ms: number, digits: Digits = 'latn'): string {
  const date = new Date(ms);
  return `${displayNumber(String(date.getDate()), digits)} ${MONTHS[date.getMonth()]} ${displayNumber(String(date.getFullYear()), digits)}`;
}

/** «3 س 12 د» since a moment. */
export function sinceText(from: number, now: number, digits: Digits = 'latn'): string {
  const minutes = Math.max(0, Math.floor((now - from) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const n = (v: number) => displayNumber(String(v), digits);
  return h > 0 ? `${n(h)} س ${n(m)} د` : `${n(m)} د`;
}

const pluralRules = new Intl.PluralRules('ar');

/** Arabic counted noun: count(3, ['قطعة واحدة','قطعتان','قطع','قطعة']) → «3 قطع». */
export function counted(
  n: number,
  [one, two, few, many]: readonly [string, string, string, string],
  digits: Digits = 'latn',
): string {
  const v = displayNumber(String(n), digits);
  switch (pluralRules.select(n)) {
    case 'one':
      return one;
    case 'two':
      return two;
    case 'few':
      return `${v} ${few}`;
    case 'many':
      return `${v} ${many}`;
    default:
      return `${v} ${many}`;
  }
}
