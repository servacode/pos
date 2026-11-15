import { batchState } from '@serva/core/pharmacy';
import type { CatalogItem } from '../catalog';

/** What a tile says about its stock, beyond name and price (display only) */
export interface TileInfo {
  /** What can be sold, thousandths: expired and blocked batches left out; null when the till does not know the stock */
  stockQty: number | null;
  /** What sits in expired or blocked batches (counted in the stock, not sellable) */
  expiredQty: number;
  blockedQty: number;
  /** The nearest date among the sellable batches, with the days left */
  expiry: { days: number; tone: 'danger' | 'warning' } | null;
  tracksSerial: boolean;
}

const DAY = 86_400_000;

/** Days from `today` to `date`, both «YYYY-MM-DD» */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

/** An expiry chip appears from this many days out */
export const EXPIRY_CHIP_DAYS = 90;
/** Red under this many days */
export const EXPIRY_DANGER_DAYS = 30;

/** What can be sold from the batches: the one rule lives in lib/sellable (kept here under its old name) */
export { sellableQty } from '../../lib/sellable';

export function tileInfo(pieces: readonly CatalogItem[], today: string): TileInfo {
  let stock: number | null = null;
  let expiredQty = 0;
  let blockedQty = 0;
  let nearest: string | null = null;
  for (const p of pieces) {
    const batches = Array.isArray(p.stockBatches) ? p.stockBatches : null;
    let sellable: number | null = null;
    if (batches) {
      sellable = 0;
      let left = false;
      for (const b of batches) {
        const state = batchState(b, today);
        if (state === 'ok') {
          sellable += b.qty;
          if (b.expiry && (nearest === null || b.expiry < nearest)) nearest = b.expiry;
        } else if (state === 'empty' && b.qty < 0 && !b.batchNo) {
          // The no-batch row can run below zero: it takes from what can be sold, the same everywhere
          sellable += b.qty;
        } else if (state === 'expired') {
          expiredQty += b.qty;
          left = true;
        } else if (state === 'blocked') {
          blockedQty += b.qty;
          left = true;
        }
      }
      // Nothing expired or blocked: the stock is the stock, whatever the batches add up to
      if (!left) sellable = null;
    }
    if (typeof p.stockQty === 'number') {
      // Never more than the stock itself says: the batch ledger can run a few pieces over it
      stock = (stock ?? 0) + (sellable === null ? p.stockQty : Math.min(sellable, p.stockQty));
    }
  }
  const days = nearest ? daysUntil(nearest, today) : null;
  return {
    stockQty: stock,
    expiredQty,
    blockedQty,
    expiry:
      days !== null && days <= EXPIRY_CHIP_DAYS
        ? { days, tone: days <= EXPIRY_DANGER_DAYS ? 'danger' : 'warning' }
        : null,
    tracksSerial: pieces.some((p) => p.tracksSerial),
  };
}

/** «ينتهي بعد 17 يوماً», «ينتهي اليوم», «منتهية» */
export function expiryText(days: number, number: (n: number) => string): string {
  if (days < 0) return 'منتهية';
  if (days === 0) return 'ينتهي اليوم';
  if (days === 1) return 'ينتهي غداً';
  if (days === 2) return 'ينتهي بعد يومين';
  return `ينتهي بعد ${number(days)} ${days <= 10 ? 'أيام' : 'يوماً'}`;
}
