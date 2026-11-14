import { batchState } from '@serva/core/pharmacy';
import type { CatalogItem } from '../catalog';

/** What a tile says about its stock, beyond name and price (display only) */
export interface TileInfo {
  /** Stock on hand, thousandths; null when the till does not know it */
  stockQty: number | null;
  /** The nearest date among the sellable batches, with the days left (negative: past) */
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

export function tileInfo(pieces: readonly CatalogItem[], today: string): TileInfo {
  let stock: number | null = null;
  for (const p of pieces) {
    if (typeof p.stockQty === 'number') stock = (stock ?? 0) + p.stockQty;
  }
  let nearest: string | null = null;
  for (const p of pieces) {
    for (const b of p.stockBatches ?? []) {
      if (!b.expiry || batchState(b, today) === 'empty' || batchState(b, today) === 'blocked') continue;
      if (nearest === null || b.expiry < nearest) nearest = b.expiry;
    }
  }
  const days = nearest ? daysUntil(nearest, today) : null;
  return {
    stockQty: stock,
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
