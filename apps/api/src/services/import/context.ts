import type { ImportData, ImportIssue, ImportRowResult, ImportStatus } from '@serva/core';
import type { Transaction } from '@serva/db';
import type { AccessClaims } from '../../auth/tokens';
import { AppError } from '../../errors';
import type { RequestMeta } from '../../types';
import type { CatalogContext } from '../catalog/common';

/** What every importer works with: the chunk's transaction, who is importing, and the options. */
export interface ImportContext {
  tx: Transaction;
  auth: AccessClaims;
  meta: RequestMeta;
  now: Date;
  input: ImportData;
  catalog: CatalogContext;
}

/** The answer for each row, kept by line so every importer fills the same shape. */
export class Results {
  private readonly byLine = new Map<number, ImportRowResult>();

  constructor(lines: number[]) {
    for (const line of lines) this.byLine.set(line, { line, status: 'skip', errors: [], notes: [] });
  }

  set(line: number, status: ImportStatus, notes: string[] = []): void {
    const row = this.byLine.get(line)!;
    row.status = status;
    row.errors = [];
    row.notes = [...row.notes, ...notes];
  }

  fail(line: number, errors: ImportIssue[]): void {
    const row = this.byLine.get(line)!;
    row.status = 'error';
    row.errors = errors;
    row.notes = [];
  }

  statusOf(line: number): ImportStatus {
    return this.byLine.get(line)!.status;
  }

  note(line: number, note: string): void {
    this.byLine.get(line)!.notes.push(note);
  }

  all(): ImportRowResult[] {
    return [...this.byLine.values()].sort((a, b) => a.line - b.line);
  }
}

/**
 * Which import field a server field path is about: «variants.0.barcodes.1.code» is the barcode,
 * «nameAr» the name… Unknown paths belong to the row as a whole.
 */
const PATH_FIELDS: [RegExp, string][] = [
  [/^nameAr/, 'name'],
  [/^nameEn/, 'nameEn'],
  [/^categoryId/, 'category'],
  [/^unitId/, 'unit'],
  [/^taxRateId/, 'tax'],
  [/^brand/, 'brand'],
  [/^season/, 'season'],
  [/variants\.\d+\.barcodes/, 'barcode'],
  [/variants\.\d+\.sku/, 'sku'],
  [/variants\.\d+\.attributes/, 'size'],
  [/variants\.\d+\.price/, 'price'],
  [/variants\.\d+\.wholesalePriceMinor/, 'wholesalePrice'],
  [/variants\.\d+\.minStockQty/, 'minStock'],
  [/^phone/, 'phone'],
  [/^name$/, 'name'],
  [/^taxNumber/, 'taxNumber'],
  [/^address/, 'address'],
  [/^notes/, 'notes'],
  [/^creditLimitMinor/, 'creditLimit'],
  [/^priceTier/, 'priceTier'],
];

export function fieldOfPath(path: string): string {
  return PATH_FIELDS.find(([pattern]) => pattern.test(path))?.[1] ?? '_';
}

/** The index of the variant a server path names («variants.2.price» is 2), or null. */
export function variantIndexOf(path: string): number | null {
  const m = /^variants\.(\d+)/.exec(path);
  return m ? Number(m[1]) : null;
}

/** The messages of a failed row from what the services and schemas threw. */
export function issuesOf(error: unknown): { path: string; message: string }[] {
  if (error instanceof AppError) {
    if (error.fields) {
      const entries = Object.entries(error.fields);
      // The dotted path is the precise one; the top-level key repeats it
      const dotted = entries.filter(([key]) => key.includes('.'));
      const chosen = dotted.length > 0 ? dotted : entries;
      return chosen.map(([path, message]) => ({ path, message }));
    }
    return [{ path: '_', message: error.message }];
  }
  throw error;
}
