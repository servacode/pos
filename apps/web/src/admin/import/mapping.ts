import {
  IMPORT_FIELDS,
  IMPORT_TYPE_LABELS,
  branchQtyKey,
  guessImportFields,
  normalizeArabic,
  type ImportRow,
  type ImportRowResult,
  type ImportType,
} from '@serva/core';
import type { FileCell } from './file';

/** For each column of the sheet, the field it feeds (a key of IMPORT_FIELDS, or «qty:<branch>»), or null. */
export type Mapping = (string | null)[];

export interface Branch {
  id: string;
  name: string;
}

/** The header row and the data rows under it. */
export interface Table {
  headers: string[];
  body: FileCell[][];
}

export function tableOf(rows: FileCell[][]): Table {
  const [head = [], ...body] = rows;
  const width = Math.max(head.length, ...body.map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const text = String(head[i] ?? '').trim() || `عمود ${String(i + 1)}`;
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    return n > 1 ? `${text} (${String(n)})` : text;
  });
  return { headers, body };
}

/** The fields a column may feed: the type's own, and for products one quantity column per branch. */
export function targetsOf(
  type: ImportType,
  branches: readonly Branch[],
): { key: string; label: string; required: boolean }[] {
  const fields = IMPORT_FIELDS[type].map((f) => ({
    key: f.key,
    label: f.label,
    required: f.required === true,
  }));
  if (type !== 'products' || branches.length < 2) return fields;
  return [
    ...fields,
    ...branches.map((b) => ({
      key: branchQtyKey(b.id),
      label: `الكمية الافتتاحية — ${b.name}`,
      required: false,
    })),
  ];
}

// ─── Remembering the mapping ─────────────────────────────────────────────────

const STORAGE_KEY = (type: ImportType) => `serva.import.mapping.${type}`;

type Saved = Record<string, string>;

function readSaved(type: ImportType): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(type));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

/** Remembers which field each header meant, per type, in this browser only. */
export function saveMapping(type: ImportType, headers: readonly string[], mapping: Mapping): void {
  const saved: Saved = {};
  headers.forEach((header, i) => {
    const key = mapping[i];
    if (key) saved[normalizeArabic(header)] = key;
  });
  try {
    localStorage.setItem(STORAGE_KEY(type), JSON.stringify(saved));
  } catch {
    // Private windows and full storage just forget it
  }
}

/**
 * The mapping to start from: what the owner chose last time for a header of the same name, then the
 * guess from the header's words for the rest. A field is fed by one column only.
 */
export function initialMapping(
  type: ImportType,
  headers: readonly string[],
  branches: readonly Branch[],
): Mapping {
  const allowed = new Set(targetsOf(type, branches).map((t) => t.key));
  const saved = readSaved(type);
  const guessed = guessImportFields(type, headers);
  const used = new Set<string>();
  const mapping: Mapping = headers.map((header) => {
    const remembered = saved[normalizeArabic(header)];
    const key = remembered && allowed.has(remembered) ? remembered : null;
    if (key && !used.has(key)) {
      used.add(key);
      return key;
    }
    return null;
  });
  return mapping.map((key, i) => {
    if (key) return key;
    const guess = guessed[i];
    if (guess && allowed.has(guess) && !used.has(guess)) {
      used.add(guess);
      return guess;
    }
    return null;
  });
}

/** Sets column `index` to feed `field`; the column that fed it before lets go. */
export function assign(mapping: Mapping, index: number, field: string | null): Mapping {
  return mapping.map((key, i) => (i === index ? field : field !== null && key === field ? null : key));
}

/** The required fields no column feeds yet. */
export function missingRequired(type: ImportType, mapping: Mapping): string[] {
  const fed = new Set(mapping.filter((k): k is string => k !== null));
  return IMPORT_FIELDS[type].filter((f) => f.required && !fed.has(f.key)).map((f) => f.label);
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface PreparedRow extends ImportRow {
  /** Set for a row the wizard does not send: it repeats an earlier row of the file */
  duplicateOf?: number;
}

/** The identity of a row inside the file: its barcode, or for customers and suppliers its phone. */
function identityOf(type: ImportType, values: ImportRow['values']): string | null {
  const key = type === 'products' ? 'barcode' : 'phone';
  const raw = values[key];
  const text = raw === null || raw === undefined ? '' : normalizeArabic(String(raw)).replace(/\s+/g, '');
  return text === '' ? null : text;
}

/** A product row that is a size or colour of a product: it travels with the rows of its name. */
function groupKeyOf(values: ImportRow['values']): string | null {
  const has = (k: string) => values[k] !== null && values[k] !== undefined && String(values[k]).trim() !== '';
  if (!has('size') && !has('colour')) return null;
  return `${normalizeArabic(String(values.name ?? ''))}|${normalizeArabic(String(values.brand ?? ''))}`;
}

/**
 * The rows to send. A cell goes as it is in the file (the server reads it); rows with no cell at
 * all are dropped. A row that repeats an earlier barcode (or phone) of the file is marked and not
 * sent, so a dry run and the real run see the same thing. The rows of one product with sizes are
 * brought together, because they must arrive in one request.
 */
export function prepareRows(type: ImportType, table: Table, mapping: Mapping): PreparedRow[] {
  const rows: PreparedRow[] = [];
  table.body.forEach((cells, index) => {
    const values: ImportRow['values'] = {};
    mapping.forEach((key, column) => {
      if (!key) return;
      const cell = cells[column];
      if (cell !== null && cell !== undefined && String(cell).trim() !== '') values[key] = cell;
    });
    if (Object.keys(values).length === 0) return;
    rows.push({ line: index + 2, values });
  });
  const firstSeen = new Map<string, number>();
  for (const row of rows) {
    const id = identityOf(type, row.values);
    if (id === null) continue;
    const earlier = firstSeen.get(id);
    if (earlier !== undefined) row.duplicateOf = earlier;
    else firstSeen.set(id, row.line);
  }
  if (type !== 'products') return rows;
  const groups = new Map<string, PreparedRow[]>();
  const order: (string | PreparedRow)[] = [];
  for (const row of rows) {
    const key = row.duplicateOf === undefined ? groupKeyOf(row.values) : null;
    if (key === null) {
      order.push(row);
    } else if (groups.has(key)) {
      groups.get(key)!.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  return order.flatMap((item) => (typeof item === 'string' ? groups.get(item)! : [item]));
}

/**
 * Chunks for the server: about `size` rows each, but never splitting the rows of one product with
 * sizes across two requests (they must create one product).
 */
export function chunkRows(
  type: ImportType,
  rows: readonly PreparedRow[],
  size = 200,
  max = 500,
): PreparedRow[][] {
  const chunks: PreparedRow[][] = [];
  let current: PreparedRow[] = [];
  let currentKey: string | null = null;
  for (const row of rows) {
    const key = type === 'products' ? groupKeyOf(row.values) : null;
    const sameGroup = key !== null && key === currentKey;
    if (current.length >= max || (current.length >= size && !sameGroup)) {
      chunks.push(current);
      current = [];
    }
    current.push(row);
    currentKey = key;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ─── Files out ───────────────────────────────────────────────────────────────

const BOM = '﻿';

/** One CSV field, quoted; text a spreadsheet would run as a formula gets an apostrophe. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** The template of a type: the field names as headers, a sample row, and the hints as a second sheet line. */
export function templateCsv(type: ImportType): string {
  const fields = IMPORT_FIELDS[type];
  const lines = [fields.map((f) => csvField(f.label)), fields.map((f) => csvField(f.example))];
  return `${BOM}${lines.map((l) => l.join(',')).join('\r\n')}\r\n`;
}

export const templateName = (type: ImportType) => `قالب-استيراد-${IMPORT_TYPE_LABELS[type]}.csv`;

export interface ReportRow {
  line: number;
  status: string;
  field: string;
  message: string;
}

const STATUS_WORDS: Record<ImportRowResult['status'], string> = {
  create: 'جديد',
  update: 'تحديث',
  skip: 'تُرك',
  error: 'خطأ',
};

export const statusWord = (status: ImportRowResult['status']) => STATUS_WORDS[status];

/** The refused rows and the skipped duplicates as a CSV the owner can fix and import again. */
export function reportCsv(type: ImportType, rows: readonly ReportRow[]): string {
  const labels = new Map(IMPORT_FIELDS[type].map((f) => [f.key, f.label]));
  const header = ['السطر في الملف', 'الحالة', 'الحقل', 'السبب'].map(csvField).join(',');
  const body = rows.map((r) =>
    [String(r.line), r.status, labels.get(r.field) ?? (r.field === '_' ? '' : r.field), r.message]
      .map(csvField)
      .join(','),
  );
  return `${BOM}${[header, ...body].join('\r\n')}\r\n`;
}

/**
 * What a row that repeats an earlier row's barcode (or phone) answers. A product row that says a
 * different size or colour than the first one is refused and named (its size would be lost
 * otherwise); an identical repeat is just skipped.
 */
export function duplicateAnswer(
  type: ImportType,
  row: PreparedRow,
  first: PreparedRow | undefined,
): { status: 'skip' | 'error'; message: string } {
  const text = (r: PreparedRow | undefined, k: string) => String(r?.values[k] ?? '').trim();
  const wanted = [text(row, 'size'), text(row, 'colour')].filter(Boolean).join(' · ');
  const earlier = [text(first, 'size'), text(first, 'colour')].filter(Boolean).join(' · ');
  if (type === 'products' && wanted !== earlier) {
    return {
      status: 'error',
      message: `الباركود مكرر: سبق في السطر ${String(row.duplicateOf)}${wanted ? ` فلم يُستورد «${wanted}»` : ''}. أعطِ كل مقاس ولون باركوداً خاصاً به`,
    };
  }
  return { status: 'skip', message: `مكرر في الملف: سبق في السطر ${String(row.duplicateOf)}` };
}
