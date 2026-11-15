import type { StockBatch } from '@serva/core/contracts/pharmacy';
import { batchState } from '@serva/core/pharmacy';

/**
 * ONE definition of «what can be sold» from an item's batches (the till, the lists and the dashboard use it):
 * the valid batches plus the no-batch row, even when that row runs below zero; expired, blocked and
 * empty batches are left out. Display only: the stock itself never changes.
 */
export function sellableQty(batches: readonly StockBatch[], today: string): number {
  return sellableSplit(batches, today).sellable;
}

/** The sellable quantity, with whether some batch is expired or blocked (then the stock is more than what can be sold) */
export function sellableSplit(
  batches: readonly StockBatch[],
  today: string,
): { sellable: number; expired: number; blocked: number } {
  let sellable = 0;
  let expired = 0;
  let blocked = 0;
  for (const b of batches) {
    const state = batchState(b, today);
    if (state === 'ok' || (state === 'empty' && b.qty < 0 && !b.batchNo)) sellable += b.qty;
    else if (state === 'expired') expired += b.qty;
    else if (state === 'blocked') blocked += b.qty;
  }
  return { sellable, expired, blocked };
}

/** The stock's name for a sellable amount: never more than the stock itself says (the batch ledger can run over it) */
export function capToStock(sellable: number | null, stockQty: number | null | undefined): number | null {
  if (sellable === null) return stockQty ?? null;
  if (stockQty === null || stockQty === undefined) return sellable;
  return Math.min(sellable, stockQty);
}

/**
 * THE STOCK RULE (till, product list, inventory, dashboard):
 * - on hand = the plain sum of stock levels; «ناقص» is how far negative combinations run;
 * - sellable = the sum of each combination's own stock with negatives counted as 0, so one combination
 *   below zero never hides what the others still have;
 * - the till only sees its own branch (sync scope), the admin lists all branches unless a branch is picked:
 *   when they differ, show the branch on the list rather than a different number;
 * - online reservations (reserved_qty) are not taken off anywhere, so nothing is «محجوز».
 */
export function sellableOnHand(qty: number): number {
  return Math.max(0, qty);
}

/** «ناقص»: how far below zero the combinations run, as a positive number (0 when none does) */
export function shortfallOf(qtys: readonly number[]): number {
  return qtys.reduce((sum, q) => (q < 0 ? sum - q : sum), 0);
}
