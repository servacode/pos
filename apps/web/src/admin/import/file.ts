import { IMPORT_FILE_MAX_ROWS } from '@serva/core';

/** A cell of a spreadsheet as the wizard sees it: text, a number, or nothing. */
export type FileCell = string | number | null;

export interface Sheet {
  name: string;
  /** Every row of the sheet, the header row included; fully empty rows are dropped */
  rows: FileCell[][];
}

/** The biggest file the wizard reads (a 20,000-row sheet is a few megabytes). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export class FileProblem extends Error {
  override readonly name = 'FileProblem';
}

/** The bytes of a file, through FileReader so it works wherever a File does. */
function bytesOf(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new FileProblem('تعذّرت قراءة الملف. جرّب فتحه في Excel وحفظه من جديد.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * The text of a CSV: UTF-8 when it is valid UTF-8, and Windows-1256 (the Arabic code page the old
 * programs and Excel on Arabic Windows save in) when it is not. A byte-order mark is dropped.
 */
export function decodeText(bytes: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1256').decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The delimiter a CSV uses: the one that splits the first lines into the most equal, widest rows. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ',';
  let bestScore = 0;
  for (const delimiter of [',', ';', '\t', '|']) {
    const rows = parseDelimited(sample, delimiter).filter((r) => r.length > 1 || (r[0] ?? '') !== '');
    const widths = rows.map((r) => r.length);
    const score =
      widths.length === 0 || widths[0]! < 2 ? 0 : widths.filter((w) => w === widths[0]).length * widths[0]!;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** RFC 4180: quoted fields with doubled quotes and line breaks inside; CRLF or LF between rows. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Drops fully empty rows and the empty columns at the end of every row. */
export function tidy(rows: FileCell[][]): FileCell[][] {
  const kept = rows.filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
  return kept.map((r) => {
    let end = r.length;
    while (end > 0 && (r[end - 1] === null || String(r[end - 1]).trim() === '')) end--;
    return r.slice(0, end);
  });
}

function tooBig(rows: FileCell[][], name: string): void {
  if (rows.length - 1 > IMPORT_FILE_MAX_ROWS) {
    throw new FileProblem(
      `الورقة «${name}» فيها أكثر من ${IMPORT_FILE_MAX_ROWS.toLocaleString('en')} صف. قسّمها إلى ملفات أصغر.`,
    );
  }
}

/** A cell from the xlsx reader: dates become their ISO day, yes/no become words. */
function cellOf(value: unknown): FileCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return String(value);
}

/**
 * Reads a .xlsx or .csv file into sheets. The xlsx reader is loaded only now, so the rest of the
 * app never pays for it.
 */
export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (file.size > MAX_FILE_BYTES) throw new FileProblem('الملف أكبر من 15 ميغابايت. قسّمه إلى ملفات أصغر.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) {
    throw new FileProblem('صيغة xls القديمة غير مدعومة. افتح الملف في Excel واحفظه بصيغة xlsx أو csv.');
  }
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    let sheets: { sheet: string; data: unknown[][] }[];
    try {
      sheets = (await readXlsxFile(file)) as { sheet: string; data: unknown[][] }[];
    } catch {
      throw new FileProblem('تعذّر فتح الملف. تأكد أنه xlsx سليم غير محمي بكلمة سر.');
    }
    const out = sheets
      .map((s) => ({ name: s.sheet, rows: tidy(s.data.map((row) => row.map(cellOf))) }))
      .filter((s) => s.rows.length > 0);
    for (const s of out) tooBig(s.rows, s.name);
    if (out.length === 0) throw new FileProblem('الملف فارغ.');
    return out;
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const text = decodeText(await bytesOf(file));
    const rows = tidy(parseDelimited(text, detectDelimiter(text)));
    if (rows.length === 0) throw new FileProblem('الملف فارغ.');
    tooBig(rows, 'CSV');
    return [{ name: 'CSV', rows }];
  }
  throw new FileProblem('اختر ملف xlsx أو csv.');
}
