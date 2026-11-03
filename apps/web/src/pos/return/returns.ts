import type { ReturnPayload, SalePayload } from '@serva/core/contracts/documents';
import type { ReturnedLine } from '@serva/core/sale-return';
import type { OutboxEntry } from '@serva/sync';

/** How far back the till looks for an invoice to return from (08 › مرتجع مبيعات) */
export const RETURN_WINDOW_DAYS = 7;

export interface ReturnableSale {
  id: string;
  number: string;
  deviceTime: string;
  sale: SalePayload;
  /** What returns saved on this till already took back from it */
  returned: ReturnedLine[];
}

/**
 * The invoices of this till within the window, newest first, each with what was returned from
 * it here. Another till's returns of the same invoice reach the server, which flags an
 * over-return; this till only knows its own.
 */
export function returnableSales(entries: readonly OutboxEntry[], now: number): ReturnableSale[] {
  const since = now - RETURN_WINDOW_DAYS * 86_400_000;
  const returned = new Map<string, ReturnedLine[]>();
  for (const { doc } of entries) {
    if (doc.type !== 'return') continue;
    const ret = doc.payload as unknown as ReturnPayload;
    const list = returned.get(ret.saleId) ?? [];
    for (const l of ret.lines) list.push({ saleLineNo: l.saleLineNo, qty: l.qty, ...l.refund });
    returned.set(ret.saleId, list);
  }
  return entries
    .filter((e) => e.doc.type === 'sale' && e.doc.number && Date.parse(e.doc.deviceTime) >= since)
    .map((e) => ({
      id: e.doc.id,
      number: e.doc.number!,
      deviceTime: e.doc.deviceTime,
      sale: e.doc.payload as unknown as SalePayload,
      returned: returned.get(e.doc.id) ?? [],
    }))
    .sort((a, b) => b.deviceTime.localeCompare(a.deviceTime));
}

/** Matches the typed number by its end, as printed on the receipt («154» finds …-0000154) */
export function matchesNumber(number: string, typed: string): boolean {
  const digits = typed.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (!digits) return true;
  return number.replace(/\D/g, '').endsWith(digits) || number.includes(typed.trim());
}
