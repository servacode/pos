import { getCurrency, type CurrencyCode } from '@serva/core';
import type { TrialBalance } from '../reports/contracts';
import { normalSide } from '../reports/labels';

/** An amount in minor units as a plain decimal a spreadsheet can add up: 125000 SYP → «1250». */
export function minorToDecimal(minor: number, currency: CurrencyCode): string {
  const { decimals } = getCurrency(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

const FORMULA_STARTS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * One CSV field, quoted. Text that a spreadsheet would run as a formula (an account named «=1+1»)
 * gets a leading apostrophe; numbers are passed with `numeric` and kept as they are.
 */
export function csvField(value: string, numeric = false): string {
  const first = value.charAt(0);
  const safe = !numeric && FORMULA_STARTS.has(first) ? `'${value}` : value;
  return `"${safe.split('"').join('""')}"`;
}

/** A debit-signed balance split into its debit and credit columns. */
function sides(debitSigned: number): [number, number] {
  return debitSigned >= 0 ? [debitSigned, 0] : [0, -debitSigned];
}

/** A balance signed on the account's normal side (the server's form) turned debit-signed. */
export function debitSigned(minor: number, type: Parameters<typeof normalSide>[0]): number {
  return normalSide(type) === 'debit' ? minor : -minor;
}

/**
 * «ميزان المراجعة بالمجاميع والأرصدة» (19) as CSV for Excel: a byte-order mark so Excel reads the
 * Arabic, CRLF lines, every balance in a debit and a credit column, and the totals line.
 */
export function trialBalanceCsv(report: TrialBalance, base: CurrencyCode): string {
  const n = (minor: number) => csvField(minorToDecimal(minor, base), true);
  const header = [
    'رمز الحساب',
    'اسم الحساب',
    'رصيد أول المدة مدين',
    'رصيد أول المدة دائن',
    'مدين',
    'دائن',
    'رصيد آخر المدة مدين',
    'رصيد آخر المدة دائن',
  ].map((title) => csvField(title));
  const lines = report.rows.map((row) => {
    const [openDebit, openCredit] = sides(debitSigned(row.openingMinor, row.type));
    const [closeDebit, closeCredit] = sides(debitSigned(row.closingMinor, row.type));
    return [
      csvField(row.accountCode),
      csvField(row.accountName),
      n(openDebit),
      n(openCredit),
      n(row.debitMinor),
      n(row.creditMinor),
      n(closeDebit),
      n(closeCredit),
    ];
  });
  const totals = [
    csvField(''),
    csvField('المجموع'),
    csvField(''),
    csvField(''),
    n(report.totals.debitMinor),
    n(report.totals.creditMinor),
    csvField(''),
    csvField(''),
  ];
  const BOM = '\uFEFF';
  return `${BOM}${[header, ...lines, totals].map((cells) => cells.join(',')).join('\r\n')}\r\n`;
}

/** Saves text as a file through the browser's download. */
export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
