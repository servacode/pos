/** A text that starts like this would run as a formula when Excel opens the file */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A value Excel must keep as written, a barcode: written as ="…" */
export class TextCell {
  constructor(readonly text: string) {}
}
export type CsvCell = string | number | TextCell;

/**
 * One cell as CSV text: quoted when it holds a comma, quote or line break. A text that could run as a
 * formula gets a leading apostrophe (as the import's error report does); a real number is never touched.
 */
function cell(value: CsvCell): string {
  // A code of digits kept as text (Excel would show 6221031234567 as 6.22103E+12)
  if (value instanceof TextCell) {
    return /^[0-9A-Za-z]+$/.test(value.text) ? `"=""${value.text}"""` : cell(value.text);
  }
  const raw = String(value);
  const text = typeof value === 'string' && FORMULA_START.test(value) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The CSV text of a table: UTF-8 BOM (so Excel reads Arabic), CRLF line breaks. */
export function csvText(headers: string[], rows: CsvCell[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Saves a table as a CSV file the browser downloads. */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  const blob = new Blob([csvText(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
