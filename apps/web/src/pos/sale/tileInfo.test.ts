import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog';
import { expiryText, tileInfo } from './tileInfo';
import { isColourOption, swatchOf } from './swatch';

const piece = (over: Partial<CatalogItem>) => over as CatalogItem;

describe('what a tile says about its stock', () => {
  it('sums the stock, takes the nearest sellable expiry and flags serial products', () => {
    const info = tileInfo(
      [
        piece({
          stockQty: 5000,
          stockBatches: [
            { batchNo: 'A', expiry: '2026-12-01', qty: 3000 },
            { batchNo: 'B', expiry: '2026-11-20', qty: 2000 },
            { batchNo: 'C', expiry: '2026-11-15', qty: 1000, blocked: true },
            { batchNo: 'D', expiry: '2026-11-01', qty: 0 },
          ],
        }),
        piece({ stockQty: 2000, tracksSerial: true }),
      ],
      '2026-11-14',
    );
    expect(info.stockQty).toBe(7000);
    expect(info.expiry).toEqual({ days: 6, tone: 'danger' });
    expect(info.tracksSerial).toBe(true);
  });

  it('counts only what can be sold and keeps the expired quantity apart', () => {
    const info = tileInfo(
      [
        piece({
          stockQty: 102_000,
          stockBatches: [
            { batchNo: 'OLD', expiry: '2026-01-01', qty: 29_000 },
            { batchNo: 'NEW', expiry: '2027-06-30', qty: 73_000 },
          ],
        }),
      ],
      '2026-11-14',
    );
    expect(info.stockQty).toBe(73_000);
    expect(info.expiredQty).toBe(29_000);
    // The expired batch never sets the chip: the next sellable date does
    expect(info.expiry).toBeNull();
    const none = tileInfo(
      [piece({ stockQty: 5_000, stockBatches: [{ batchNo: 'OLD', expiry: '2026-01-01', qty: 5_000 }] })],
      '2026-11-14',
    );
    expect(none.stockQty).toBe(0);
    expect(none.expiredQty).toBe(5_000);
  });

  it('shows amber from 31 days, nothing past 90, and no stock when unknown', () => {
    const at = (expiry: string) =>
      tileInfo(
        [piece({ stockQty: null, stockBatches: [{ batchNo: null, expiry, qty: 1000 }] })],
        '2026-11-14',
      );
    expect(at('2026-12-20').expiry).toEqual({ days: 36, tone: 'warning' });
    expect(at('2027-06-01').expiry).toBeNull();
    expect(at('2027-06-01').stockQty).toBeNull();
  });

  it('words the days in Arabic', () => {
    const n = (x: number) => String(x);
    expect(expiryText(17, n)).toBe('ينتهي بعد 17 يوماً');
    expect(expiryText(5, n)).toBe('ينتهي بعد 5 أيام');
    expect(expiryText(0, n)).toBe('ينتهي اليوم');
    expect(expiryText(-3, n)).toBe('منتهية');
  });
});

describe('colour dots', () => {
  it('knows common colour names and only colour options', () => {
    expect(swatchOf('أسود')).toBe('#111111');
    expect(swatchOf('غير معروف')).toBeNull();
    expect(isColourOption('اللون')).toBe(true);
    expect(isColourOption('المقاس')).toBe(false);
  });
});
