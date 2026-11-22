import { describe, expect, it } from 'vitest';
import type { StockBatch } from '@serva/core/contracts/pharmacy';
import { capToStock, sellableQty, sellableSplit } from './sellable';

const batch = (b: Partial<StockBatch> & { qty: number }): StockBatch =>
  ({ batchNo: null, expiry: null, blocked: false, ...b }) as StockBatch;

describe('sellable stock (one rule)', () => {
  const today = '2026-11-15';
  it('counts valid batches and the no-batch row even below zero', () => {
    const batches = [batch({ batchNo: 'A', qty: 175 }), batch({ qty: -1 })];
    expect(sellableQty(batches, today)).toBe(174);
  });
  it('leaves expired and blocked batches out and reports them', () => {
    const batches = [
      batch({ batchNo: 'A', qty: 10 }),
      batch({ batchNo: 'B', qty: 4, expiry: '2026-01-01' }),
      batch({ batchNo: 'C', qty: 3, blocked: true }),
    ];
    expect(sellableSplit(batches, today)).toEqual({ sellable: 10, expired: 4, blocked: 3 });
  });
  it('never goes over the stock itself', () => {
    expect(capToStock(12, 10)).toBe(10);
    expect(capToStock(null, 7)).toBe(7);
    expect(capToStock(5, null)).toBe(5);
  });
});
