import { describe, expect, it } from 'vitest';
import {
  batchBlockInput,
  batchKey,
  expiryQuery,
  purchaseInput,
  recallQuery,
  stocktakeInput,
  supplierReturnInput,
  transferInput,
} from './purchases';

const V = '0192a3b4-c5d6-7e8f-9a0b-000000000001';
const S = '0192a3b4-c5d6-7e8f-9a0b-000000000002';
const B2 = '0192a3b4-c5d6-7e8f-9a0b-000000000003';

describe('batches on the purchase documents', () => {
  it('names a line by its item and batch', () => {
    expect(batchKey({ variantId: V })).toBe(`${V}||`);
    expect(batchKey({ variantId: V, batchNo: 'A', expiryDate: '2027-01-01' })).toBe(`${V}|A|2027-01-01`);
  });

  it('takes the same item twice in a receipt when the batches differ, not when they are the same', () => {
    const line = (batchNo: string | null, expiryDate: string | null) => ({
      variantId: V,
      qty: 1000,
      costMinor: 1,
      batchNo,
      expiryDate,
    });
    const base = { supplierId: S, date: '2026-10-30', payment: 'credit' as const };
    expect(
      purchaseInput.safeParse({ ...base, lines: [line('A', '2027-01-01'), line('B', '2027-02-01')] }).success,
    ).toBe(true);
    expect(
      purchaseInput.safeParse({ ...base, lines: [line('A', '2027-01-01'), line('A', '2027-01-01')] }).success,
    ).toBe(false);
    expect(purchaseInput.safeParse({ ...base, lines: [line(null, null), line(null, null)] }).success).toBe(
      false,
    );
  });

  it('lets a supplier return and a transfer name a batch, one line per item and batch', () => {
    const ret = (lines: object[]) =>
      supplierReturnInput.safeParse({ supplierId: S, date: '2026-10-30', refund: 'credit', lines });
    expect(
      ret([
        { variantId: V, qty: 1000, batchNo: 'A', expiryDate: '2027-01-01' },
        { variantId: V, qty: 1000, batchNo: 'B', expiryDate: '2027-02-01' },
      ]).success,
    ).toBe(true);
    expect(
      ret([
        { variantId: V, qty: 1000 },
        { variantId: V, qty: 2000 },
      ]).success,
    ).toBe(false);
    expect(
      transferInput.safeParse({
        fromBranchId: S,
        toBranchId: B2,
        date: '2026-10-30',
        lines: [{ variantId: V, qty: 1000, batchNo: 'A', expiryDate: '2027-01-01' }],
      }).success,
    ).toBe(true);
  });

  it('lets a count line name a batch, which is a count of that batch alone', () => {
    const parsed = stocktakeInput.parse({
      date: '2026-10-30',
      lines: [{ variantId: V, countedQty: 0, batchNo: '  A-01 ', expiryDate: '2026-10-25' }],
    });
    expect(parsed.lines[0]).toMatchObject({ batchNo: 'A-01', expiryDate: '2026-10-25' });
    expect(
      stocktakeInput.safeParse({ date: '2026-10-30', lines: [{ variantId: V, countedQty: -1 }] }).success,
    ).toBe(false);
  });

  it('reads the expiry query with one item and branch, and the block and recall inputs', () => {
    expect(expiryQuery.parse({})).toEqual({ days: 90 });
    expect(expiryQuery.parse({ days: '30', variantId: V, branchId: S })).toEqual({
      days: 30,
      variantId: V,
      branchId: S,
    });
    expect(expiryQuery.safeParse({ days: '0' }).success).toBe(false);
    expect(batchBlockInput.parse({ batchNo: ' C-09 ', reason: '' })).toEqual({
      batchNo: 'C-09',
      reason: null,
    });
    expect(batchBlockInput.safeParse({ batchNo: '' }).success).toBe(false);
    expect(recallQuery.parse({ batchNo: ' C-09' })).toEqual({ batchNo: 'C-09' });
    expect(recallQuery.safeParse({ batchNo: ' ' }).success).toBe(false);
  });
});
