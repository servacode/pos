/**
 * Built-in option values (03 › الألبسة): the sizes, shoe numbers, children's ages and colours a
 * shop starts with, so a product's pieces are a few taps, not typing. The store's own values (from
 * GET /v1/products/options) are offered beside them, so a value added once is there for every
 * product.
 */

export interface PresetGroup {
  label: string;
  values: readonly string[];
}

export interface OptionKind {
  /** The option's name on the pieces and the labels */
  name: string;
  /** The button that picks it for the first option */
  pick: string;
  groups: readonly PresetGroup[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
const even = (from: number, to: number) => range(from, to).filter((n) => Number(n) % 2 === 0);

const years = (n: number) => (n === 2 ? 'سنتان' : n <= 10 ? `${n} سنوات` : `${n} سنة`);

export const SIZE_KINDS: readonly OptionKind[] = [
  {
    name: 'المقاس',
    pick: 'مقاس',
    groups: [
      { label: 'بالحروف', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'] },
      { label: 'بالأرقام', values: even(28, 56) },
      { label: 'مقاس واحد', values: ['فري سايز'] },
    ],
  },
  {
    name: 'النمرة',
    pick: 'نمرة (أحذية)',
    groups: [
      { label: 'أطفال', values: range(18, 34) },
      { label: 'كبار', values: range(35, 47) },
    ],
  },
  {
    name: 'العمر',
    pick: 'عمر (أطفال)',
    groups: [
      {
        label: 'رضّع',
        values: [
          'حديث الولادة',
          '0-3 أشهر',
          '3-6 أشهر',
          '6-9 أشهر',
          '9-12 شهراً',
          '12-18 شهراً',
          '18-24 شهراً',
        ],
      },
      { label: 'أطفال', values: range(2, 16).map((n) => years(Number(n))) },
    ],
  },
  {
    name: 'الحجم',
    pick: 'حجم (عطور)',
    groups: [
      {
        label: 'بالمل',
        values: ['10 مل', '30 مل', '50 مل', '75 مل', '100 مل', '125 مل', '150 مل', '200 مل'],
      },
    ],
  },
];

export const COLOURS: PresetGroup = {
  label: 'الألوان',
  values: [
    'أبيض',
    'أسود',
    'رمادي',
    'فضي',
    'كحلي',
    'أزرق',
    'سماوي',
    'تركوازي',
    'أخضر',
    'زيتي',
    'أحمر',
    'خمري',
    'زهري',
    'فوشيا',
    'بنفسجي',
    'أصفر',
    'برتقالي',
    'بني',
    'بيج',
    'كريمي',
    'ذهبي',
    'ملوّن',
  ],
};

export const COLOUR_NAME = 'اللون';

/** The built-in groups for an option, by its name (none for a name the shop made up). */
export function presetGroups(name: string): readonly PresetGroup[] {
  const n = name.trim();
  if (n === COLOUR_NAME || n === 'الألوان') return [COLOURS];
  return SIZE_KINDS.find((k) => k.name === n)?.groups ?? [];
}

/**
 * Adds a value where it belongs: a built-in value takes its place among the built-in ones already
 * chosen (so the pieces come out S, M, L whatever order they were tapped in); the shop's own go last.
 */
export function insertValue(
  values: readonly string[],
  value: string,
  groups: readonly PresetGroup[],
): string[] {
  if (values.includes(value)) return [...values];
  const order = groups.flatMap((g) => g.values);
  const at = order.indexOf(value);
  if (at < 0) return [...values, value];
  const next = values.findIndex((v) => {
    const i = order.indexOf(v);
    return i < 0 || i > at;
  });
  return next < 0 ? [...values, value] : [...values.slice(0, next), value, ...values.slice(next)];
}
