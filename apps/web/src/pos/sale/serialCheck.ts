import type { SerialStockRow } from '@serva/core/contracts/purchases';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { OutboxEntry } from '@serva/sync';

/** What the till knows about a serial number a cashier typed or scanned (03 › الإلكترونيات) */
export type SerialVerdict =
  | { kind: 'ok' }
  /** Not in this branch's stock: never received, or received but not entered; a manager may let it through */
  | { kind: 'unknown' }
  /** Already sold, by a sale of this till (its number) or as the last pull saw it */
  | { kind: 'sold'; saleNumber: string | null }
  /** In stock, but as another product */
  | { kind: 'other_product' }
  /** Out with a customer on a rental: it is sold only after it comes back */
  | { kind: 'rented' };

/** A typed or scanned serial as stored: no spaces, capitals */
export const serialKey = (text: string): string => text.replace(/\s+/g, '').toUpperCase();

/**
 * Checks a serial against the branch's in-stock pieces as last pulled and this till's own sales
 * since (the outbox), so it works offline: a piece this till sold a minute ago is sold even though
 * the pull still says «في المحل».
 */
export function checkSerial(
  serial: string,
  variantId: string,
  rows: readonly SerialStockRow[],
  entries: readonly OutboxEntry[],
): SerialVerdict {
  for (const entry of entries) {
    if (entry.doc.type !== 'sale') continue;
    const sale = entry.doc.payload as unknown as SalePayload;
    if (sale.lines.some((l) => l.serials?.some((s) => serialKey(s) === serial))) {
      return { kind: 'sold', saleNumber: entry.doc.number ?? null };
    }
  }
  const row = rows.find((r) => r.serial === serial);
  if (!row) return { kind: 'unknown' };
  if (row.variantId !== variantId) return { kind: 'other_product' };
  if (row.status === 'rented') return { kind: 'rented' };
  if (row.status === 'sold') return { kind: 'sold', saleNumber: row.saleNumber ?? null };
  return { kind: 'ok' };
}
