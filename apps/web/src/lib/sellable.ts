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
