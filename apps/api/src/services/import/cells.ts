import {
  getCurrency,
  parseDecimal,
  stripBidiControls,
  toLatinDigits,
  type CurrencyCode,
  type ImportIssue,
  type ImportRow,
} from '@serva/core';

/** A cell as the browser sent it. */
export type Cell = string | number | null | undefined;

/** The problems found in one row, by field, in the order they were found. */
export class Issues {
  readonly list: ImportIssue[] = [];

  add(field: string, message: string): void {
    if (!this.list.some((i) => i.field === field)) this.list.push({ field, message });
  }

  get any(): boolean {
    return this.list.length > 0;
  }
}

/** The text of a cell: invisible direction marks gone, inner runs of spaces folded, null when empty. */
export function textOf(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  const value = stripBidiControls(String(cell)).replace(/\s+/g, ' ').trim();
  return value === '' ? null : value;
}

/** A text of at most `max` characters, or a message on the field. */
export function shortText(
  row: ImportRow,
  key: string,
  max: number,
  label: string,
  issues: Issues,
): string | null {
  const value = textOf(row.values[key]);
  if (value !== null && value.length > max) {
    issues.add(key, `${label} أطول من ${max} حرفاً`);
    return null;
  }
  return value;
}

/** «1,250.50», «١٢٥٠٫٥» or the number 1250.5 as a decimal string; null when it is not a number. */
function decimalText(cell: Cell): string | null {
  const value = textOf(cell);
  if (value === null) return null;
  const latin = toLatinDigits(value).replace(/\s/g, '');
  // A European comma («12,5») is a decimal point when it stands alone with one to two digits after
  const text = /^-?\d+,\d{1,2}$/.test(latin) ? latin.replace(',', '.') : latin;
  return /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(text) ? text : null;
}

/** An amount of a cell in the minor units of `currency`; null when empty, a message when it is not an amount. */
export function amountOf(
  row: ImportRow,
  key: string,
  currency: CurrencyCode,
  label: string,
  issues: Issues,
  options: { signed?: boolean } = {},
): number | null {
  const cell = row.values[key];
  if (textOf(cell) === null) return null;
  const text = decimalText(cell);
  if (text === null) {
    issues.add(key, `${label} ليس رقماً`);
    return null;
  }
  const minor = Number(parseDecimal(text, getCurrency(currency).decimals));
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > 1e14) {
    issues.add(key, `${label} كبير جداً`);
    return null;
  }
  if (minor < 0 && !options.signed) {
    issues.add(key, `${label} لا يكون سالباً`);
    return null;
  }
  return minor;
}

/** A quantity of a cell in thousandths (12.5 is 12500); null when empty. */
export function quantityOf(
  row: ImportRow,
  key: string,
  label: string,
  issues: Issues,
  options: { allowsFraction?: boolean } = {},
): number | null {
  const cell = row.values[key];
  if (textOf(cell) === null) return null;
  const text = decimalText(cell);
  if (text === null) {
    issues.add(key, `${label} ليست رقماً`);
    return null;
  }
  const thousandths = Number(parseDecimal(text, 3));
  if (!Number.isSafeInteger(thousandths) || thousandths > 1_000_000_000) {
    issues.add(key, `${label} كبيرة جداً`);
    return null;
  }
  if (thousandths < 0) {
    issues.add(key, `${label} لا تكون سالبة`);
    return null;
  }
  if (options.allowsFraction === false && thousandths % 1000 !== 0) {
    issues.add(key, `${label} كسرية والوحدة لا تقبل الكسور`);
    return null;
  }
  return thousandths;
}

/** The first word that means yes («نعم», «جملة», 1, true…) */
export function truthy(value: string | null): boolean {
  if (value === null) return false;
  const v = toLatinDigits(value).toLowerCase();
  return ['نعم', 'اجل', 'أجل', 'yes', 'y', 'true', '1', 'جملة', 'wholesale'].includes(v);
}

/** A real calendar date as YYYY-MM-DD, or null. */
function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * A date cell as YYYY-MM-DD: «2027-06-30», «30/6/2027», «30-06-2027» (day first, as in Syria), or an
 * Excel serial number. Null when empty; a message on the field when it is not a date.
 */
export function dateOf(row: ImportRow, key: string, label: string, issues: Issues): string | null {
  const cell = row.values[key];
  const text = textOf(cell);
  if (text === null) return null;
  const latin = toLatinDigits(text).replace(/\s/g, '');
  let found: string | null = null;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:T.*)?$/.exec(latin);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(latin);
  if (iso) found = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else if (dmy) found = isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  else if (/^\d{5}(\.\d+)?$/.test(latin)) {
    // Excel counts days from 1899-12-30
    found = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(latin)) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  if (found === null) issues.add(key, `${label} ليس تاريخاً صحيحاً. اكتبه هكذا: 2027-06-30`);
  return found;
}

/** The items of a list cell («A1, A2» or one per line), trimmed, empty ones dropped. */
export function listOf(cell: Cell): string[] {
  const text = textOf(String(cell ?? '').replace(/[\n\r]+/g, ','));
  return text === null
    ? []
    : text
        .split(/[,،;؛\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
}
