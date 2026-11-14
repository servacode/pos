export type NumberFormat = 'latn' | 'arab';

export function formatNumber(value: number, numberFormat: NumberFormat = 'latn'): string {
  return new Intl.NumberFormat(`ar-u-nu-${numberFormat}`).format(value);
}

const dayRules = new Intl.PluralRules('ar');

export function formatDays(count: number, numberFormat: NumberFormat = 'latn'): string {
  const n = formatNumber(count, numberFormat);
  switch (dayRules.select(count)) {
    case 'zero':
      return `${n} يوم`;
    case 'one':
      return 'يوم واحد';
    case 'two':
      return 'يومان';
    case 'few':
      return `${n} أيام`;
    case 'many':
      return `${n} يوماً`;
    default:
      return `${n} يوم`;
  }
}

/** «أبو سامر», «أم خالد», «عبد الله»: the first word alone would be only half of the name. */
const NAME_PREFIXES = new Set(['أبو', 'ابو', 'أم', 'ام', 'عبد']);

/** Titles before a name: «د. سامر» is greeted as «سامر», never as «د.» */
const TITLES = new Set([
  'د',
  'م',
  'أ',
  'ا',
  'دكتور',
  'الدكتور',
  'مهندس',
  'المهندس',
  'أستاذ',
  'الأستاذ',
  'استاذ',
]);
const isTitle = (word: string) => TITLES.has(word.replace(/[.،]+$/u, ''));

export function firstName(fullName: string): string {
  const all = fullName.trim().split(/\s+/);
  const words = all.length > 1 && isTitle(all[0]!) ? all.slice(1) : all;
  const first = words[0] ?? fullName;
  const second = words[1];
  return NAME_PREFIXES.has(first) && second ? `${first} ${second}` : first;
}
