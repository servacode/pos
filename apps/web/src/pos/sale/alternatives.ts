import { isAlternative } from '@serva/core/pharmacy';
import { sellableSplit } from '../../lib/sellable';
import type { Catalog, CatalogItem } from '../catalog';

/**
 * «بدائل متوفرة» (round 38, pharmacy): the items with the same active ingredient (and the same strength and
 * form where the asked-for one states them) that this branch can sell now, cheapest first. It reads the
 * catalogue the till already holds, so it works offline. Only an item with a generic name has any.
 */

export interface Alternative {
  item: CatalogItem;
  /** What can be sold now, base units (expired and recalled batches left out) */
  available: number;
}

/** What the till can sell of an item now: its batches' valid part when it keeps batches, else its stock */
export function availableOf(item: CatalogItem, today: string): number {
  if (item.isService) return 0;
  if (Array.isArray(item.stockBatches)) {
    const { sellable } = sellableSplit(item.stockBatches, today);
    return Math.max(
      0,
      item.stockQty === null || item.stockQty === undefined ? sellable : Math.min(sellable, item.stockQty),
    );
  }
  return Math.max(0, item.stockQty ?? 0);
}

export function alternativesFor(
  source: CatalogItem,
  catalog: Pick<Catalog, 'items'>,
  today: string,
): Alternative[] {
  if (!source.genericName) return [];
  return catalog.items
    .filter((other) => other.productId !== source.productId && isAlternative(source, other))
    .map((item) => ({ item, available: availableOf(item, today) }))
    .filter((a) => a.available > 0)
    .sort(
      (a, b) =>
        a.item.price.priceMinor - b.item.price.priceMinor || a.item.name.localeCompare(b.item.name, 'ar'),
    );
}
