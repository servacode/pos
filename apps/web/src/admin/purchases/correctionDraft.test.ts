import { describe, expect, it } from 'vitest';
import type { PurchaseDetail, PurchaseDraft } from '@serva/core';
import { dropCorrection, draftOfDetail, keepCorrection, keptCorrection } from './correctionDraft';
import { newDocumentId, storeToday } from './api';

const detail = (over: Partial<PurchaseDetail> = {}): PurchaseDetail => ({
  id: 'pu-1',
  number: 'PUR-2026-000001',
  date: '2026-11-02',
  supplierId: 's-1',
  supplierName: 'معمل الأمل',
  payment: 'credit',
  reference: 'A-17',
  totalMinor: 1_560_000,
  branchId: 'b-1',
  notes: null,
  baseCurrency: 'SYP',
  correctedBy: { id: 'rv-1', number: 'PRV-2026-000001', date: '2026-11-03' },
  purchaseOrderId: 'o-1',
  lines: [
    {
      lineNo: 1,
      variantId: 'v-1',
      productId: 'p-1',
      name: 'قميص',
      qty: 12_000,
      costMinor: 1_560_000,
      batchNo: 'G-1',
      expiryDate: '2028-01-01',
      serials: ['A1', 'A2'],
    },
  ],
  ...over,
});

describe('a corrected invoice written again', () => {
  it('turns the invoice into a draft in its own currency, without the order it came from', () => {
    const draft = draftOfDetail(detail());
    expect(draft).toMatchObject({
      supplierId: 's-1',
      branchId: 'b-1',
      date: '2026-11-02',
      payment: 'credit',
      reference: 'A-17',
      currency: 'SYP',
      purchaseOrderId: null,
    });
    expect(draft.lines[0]).toMatchObject({
      variantId: 'v-1',
      qty: 12_000,
      costMinor: 1_560_000,
      batchNo: 'G-1',
      expiryDate: '2028-01-01',
      serials: ['A1', 'A2'],
    });
  });

  it('takes the dollars of a dollar invoice, with its rate', () => {
    const base = detail();
    const draft = draftOfDetail(
      detail({
        currency: 'USD',
        rate: '130',
        foreignTotalMinor: 12_000,
        lines: [{ ...base.lines[0]!, foreignCostMinor: 12_000 }],
      }),
    );
    expect(draft.currency).toBe('USD');
    expect(draft.rate).toBe('130');
    expect(draft.lines[0]?.costMinor).toBe(12_000);
  });

  it('keeps the draft in the tab until the invoice is saved, and drops it', () => {
    dropCorrection();
    expect(keptCorrection()).toBeNull();
    const draft: PurchaseDraft = draftOfDetail(detail());
    keepCorrection({ draft, original: 'PUR-2026-000001', reversal: 'PRV-2026-000001' });
    expect(keptCorrection()).toMatchObject({ original: 'PUR-2026-000001', reversal: 'PRV-2026-000001' });
    dropCorrection();
    expect(keptCorrection()).toBeNull();
  });
});

describe('the store’s day and a document id', () => {
  it('reads the day in the store’s own zone, not the device’s', () => {
    // 21:30 UTC on the 30th is already the 31st in Damascus (UTC+3), and still the 30th in New York
    const at = Date.UTC(2026, 9, 30, 21, 30);
    const real = Date.now;
    Date.now = () => at;
    try {
      expect(storeToday('Asia/Damascus')).toBe('2026-10-31');
      expect(storeToday('America/New_York')).toBe('2026-10-30');
    } finally {
      Date.now = real;
    }
  });

  it('makes a different id each time', () => {
    expect(newDocumentId()).not.toBe(newDocumentId());
  });
});
