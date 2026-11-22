/**
 * The one definition of the stock numbers, shared by the home page, the products page and the inventory
 * page, so the same word never counts two different things:
 *
 * - kinds: the stocked combinations (a size and colour, a barcode item); services are not stock.
 * - pieces: what sits on the shelf over all branches; a combination below zero adds nothing.
 * - soldOut («نفد»): a combination at zero or below. Below zero is not counted twice: it is the
 *   subset `negative` («سالب»), told once as «منها سالب N».
 *
 * Quantities are in thousandths, as the server sends them.
 */
export interface StockCountRow {
  variantId: string;
  /** The product the combination belongs to (a row without it counts as its own product) */
  productId?: string | null | undefined;
  qty: number;
}

export interface StockCounts {
  kinds: number;
  pieces: number;
  soldOut: number;
  negative: number;
  soldOutProducts: number;
}

/** Rows may repeat a combination (one per branch): each combination is added up first */
export function countStock(rows: readonly StockCountRow[]): StockCounts {
  const perKind = new Map<string, { qty: number; product: string }>();
  for (const row of rows) {
    const seen = perKind.get(row.variantId);
    if (seen) seen.qty += row.qty;
    else perKind.set(row.variantId, { qty: row.qty, product: row.productId ?? row.variantId });
  }
  const kinds = [...perKind.values()];
  return {
    kinds: kinds.length,
    pieces: kinds.reduce((sum, kind) => sum + Math.max(0, kind.qty), 0),
    soldOut: kinds.filter((kind) => kind.qty <= 0).length,
    negative: kinds.filter((kind) => kind.qty < 0).length,
    soldOutProducts: new Set(kinds.filter((kind) => kind.qty <= 0).map((kind) => kind.product)).size,
  };
}

/** «سالب 2»: the combinations below zero, said once, as part of the «نفد» count */
export const negativeNote = (negative: number): string => `منها سالب ${negative}`;
