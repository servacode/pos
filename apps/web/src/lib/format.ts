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

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
