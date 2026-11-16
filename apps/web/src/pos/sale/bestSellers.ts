import type { SalePayload } from '@serva/core/contracts/documents';
import type { OutboxEntry } from '@serva/sync';
import type { Catalog } from '../catalog';

/** At most this many tiles in the «الأكثر بيعاً» strip */
export const BEST_SELLERS_MAX = 6;
/** A product needs at least this many pieces sold on this device to count as a best seller */
const BEST_SELLERS_MIN_PIECES = 3;

/**
 * The products this device sold most, from the sales it still holds (the outbox keeps pending ones and
 * those confirmed in the last 30 days): product ids, best first. A product of the catalog only, never
 * a service, and none at all until the till has some history (display only).
 */
export function bestSellers(catalog: Catalog, entries: readonly OutboxEntry[]): string[] {
  const sold = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type !== 'sale') continue;
    const sale = entry.doc.payload as unknown as SalePayload;
    for (const line of sale.lines ?? []) {
      const item = catalog.byVariant.get(line.variantId);
      if (!item || item.isService) continue;
      sold.set(item.productId, (sold.get(item.productId) ?? 0) + line.baseQty / 1000);
    }
  }
  return [...sold]
    .filter(([, pieces]) => pieces >= BEST_SELLERS_MIN_PIECES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, BEST_SELLERS_MAX)
    .map(([productId]) => productId);
}
