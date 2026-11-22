import type { InventoryRow } from '@serva/core';

/** A name that starts with = + - @ would be read by Excel as a formula: a quote in front keeps it text */
export const safeCell = (text: string) => (/^[=+\-@]/.test(text) ? `'${text}` : text);

/** The piece has a reorder level and the shelf is at or under it */
export const belowReorder = (r: InventoryRow) =>
  r.minStockQty !== null && r.minStockQty !== undefined && r.minStockQty > 0 && r.qty <= r.minStockQty;

export type StockFilter = 'all' | 'low' | 'nocost' | 'reorder';
export type Sort = 'name' | 'value' | 'qty';
