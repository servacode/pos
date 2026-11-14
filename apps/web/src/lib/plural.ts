/**
 * The counted word in Arabic: «قطعة» for one and for eleven or more, «قطعتان» for two, «قطع» for
 * three to ten (whole numbers only; anything else takes the singular form).
 */
export function countWord(count: number, forms: { one: string; two?: string; few: string }): string {
  if (!Number.isInteger(count)) return forms.one;
  const n = Math.abs(count);
  if (n === 2 && forms.two) return forms.two;
  return n >= 3 && n <= 10 ? forms.few : forms.one;
}

/** «قطعة / قطعتان / قطع» for a count of pieces. */
export const pieces = (count: number): string => countWord(count, { one: 'قطعة', two: 'قطعتان', few: 'قطع' });

/** «صف / صفان / صفوف» for a count of rows. */
export const rows = (count: number): string => countWord(count, { one: 'صف', two: 'صفان', few: 'صفوف' });

/** «منتج / منتجان / منتجات» for a count of products. */
export const products = (count: number): string =>
  countWord(count, { one: 'منتجاً', two: 'منتجين', few: 'منتجات' });
