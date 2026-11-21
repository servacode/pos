import {
  barcodeCell,
  guessPriceListFields,
  parsePriceCell,
  type PriceListField,
  type PriceListItem,
  type PriceListStatus,
} from '@serva/core';
import type { FileCell } from '../import/file';
import { tableOf, type Table } from '../import/mapping';

/** For each field, the index of the column of the sheet that feeds it (null: none). */
export type Columns = Record<PriceListField, number | null>;

export const NO_COLUMNS: Columns = { barcode: null, name: null, generic: null, price: null };

/** How many of the first rows may be a title above the headers. */
const HEADER_SEARCH = 10;

/** The row that holds the headers: the first of the top rows where a price column is recognised. */
export function detectHeaderRow(rows: readonly FileCell[][]): number {
  for (let i = 0; i < Math.min(rows.length, HEADER_SEARCH); i++) {
    const headers = rows[i]!.map((c) => String(c ?? ''));
    if (guessPriceListFields(headers).includes('price')) return i;
  }
  return 0;
}

export function tableAt(rows: readonly FileCell[][], headerRow: number): Table {
  return tableOf(rows.slice(headerRow) as FileCell[][]);
}

/** The columns to start from, guessed from the headers. */
export function guessColumns(headers: readonly string[]): Columns {
  const columns: Columns = { ...NO_COLUMNS };
  guessPriceListFields(headers).forEach((field, index) => {
    if (field) columns[field] = index;
  });
  return columns;
}

/** Whether the mapping can be sent: a price, and at least one way to find the piece. */
export function columnsReady(c: Columns): boolean {
  return c.price !== null && (c.barcode !== null || c.name !== null || c.generic !== null);
}

export interface PriceListFileRow {
  row: number;
  barcode: string | null;
  name: string | null;
  generic: string | null;
  priceMinor: number;
}

const text = (cell: FileCell | undefined): string | null => {
  const t = cell === null || cell === undefined ? '' : String(cell).trim();
  return t === '' ? null : t;
};

/**
 * The rows to send. `headerRow` is the sheet row of the headers, so `row` is the line the owner sees
 * in Excel. A row with no usable price or nothing to find the piece by goes to `invalid`.
 */
export function rowsOf(
  table: Table,
  columns: Columns,
  decimals: number,
  headerRow: number,
): { rows: PriceListFileRow[]; invalid: number[] } {
  const rows: PriceListFileRow[] = [];
  const invalid: number[] = [];
  const at = (cells: FileCell[], index: number | null) => (index === null ? undefined : cells[index]);
  table.body.forEach((cells, i) => {
    const row = headerRow + i + 2;
    const priceMinor = parsePriceCell((at(cells, columns.price) ?? null) as string | number | null, decimals);
    const barcode = barcodeCell((at(cells, columns.barcode) ?? null) as string | number | null);
    const name = text(at(cells, columns.name));
    const generic = text(at(cells, columns.generic));
    if (priceMinor === null || (!barcode && !name && !generic)) invalid.push(row);
    else rows.push({ row, barcode, name, generic, priceMinor });
  });
  return { rows, invalid };
}

export const STATUS_WORDS: Record<Exclude<PriceListStatus, 'change' | 'same'>, string> = {
  unmatched: 'لا صنف بهذا الباركود أو الاسم',
  ambiguous: 'أكثر من صنف بهذا الاسم',
  other_currency: 'سعره بعملة غير عملة المتجر',
  duplicate: 'مكرر في الملف',
};

export interface Grouped {
  change: PriceListItem[];
  same: PriceListItem[];
  rest: PriceListItem[];
}

export function group(items: readonly PriceListItem[]): Grouped {
  const out: Grouped = { change: [], same: [], rest: [] };
  for (const item of [...items].sort((a, b) => a.row - b.row)) {
    out[item.status === 'change' ? 'change' : item.status === 'same' ? 'same' : 'rest'].push(item);
  }
  return out;
}

/** The products whose labels the owner prints after the change; the labels screen reads them from here. */
export const LABEL_QUEUE_KEY = 'serva.labels.queue';
export const LABEL_QUEUE_MAX = 1000;

export function queueLabels(productIds: readonly string[]): number {
  const ids = [...new Set(productIds)].slice(0, LABEL_QUEUE_MAX);
  try {
    sessionStorage.setItem(LABEL_QUEUE_KEY, JSON.stringify(ids));
  } catch {
    // Private windows forget it; the labels screen then opens empty
  }
  return ids.length;
}

export function takeLabelQueue(): string[] {
  try {
    const raw = sessionStorage.getItem(LABEL_QUEUE_KEY);
    sessionStorage.removeItem(LABEL_QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
