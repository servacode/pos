import { describe, expect, it } from 'vitest';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import { receiptText } from './whatsapp';
import type { ReceiptData } from './Receipt';

const settings = {
  timezone: 'Asia/Damascus',
  businessDayCutoff: '00:00',
  sectors: ['medical_supplies'],
  storeName: 'مركز',
} as SettingsRow;

function data(extra: Partial<ReceiptData> = {}): ReceiptData {
  return {
    doc: {
      number: 'INV-1',
      deviceTime: '2026-10-30T09:00:00.000Z',
      payload: {
        currency: 'SYP',
        lines: [
          {
            variantId: 'v1',
            name: 'جهاز ضغط',
            qty: 1000,
            serials: ['BP-77'],
            warrantyMonths: 12,
            priced: { totalMinor: 150_000 },
          },
        ],
        totals: { totalMinor: 150_000 },
        payments: [{ method: 'cash', currency: 'SYP', amountMinor: 150_000 }],
        cashRounding: {
          currency: 'SYP',
          stepMinor: 500,
          exactMinor: 617_250,
          dueMinor: 617_000,
          roundingMinor: -250,
        },
      },
    } as unknown as ReceiptData['doc'],
    settings,
    branch: null,
    storeName: 'مركز',
    branchName: 'الرئيسي',
    deviceName: 'كاشير',
    cashierName: 'ليلى',
    ...extra,
  };
}

describe('the WhatsApp receipt text (round 18)', () => {
  it('names the serial, the warranty end, the contract price and the rounding', () => {
    const text = receiptText(data({ contractVariantIds: ['v1'] }));
    expect(text).toContain('سعر العقد');
    expect(text).toContain('BP-77');
    expect(text).toContain('الكفالة حتى 30 تشرين الأول 2027');
    expect(text).toContain('قُرّب المبلغ إلى');
  });

  it('says none of them when the sale has none', () => {
    const plain = data();
    (plain.doc.payload as { lines: object[] }).lines = [
      { variantId: 'v2', name: 'شاش', qty: 1000, priced: { totalMinor: 100 } },
    ];
    (plain.doc.payload as { cashRounding?: unknown }).cashRounding = undefined;
    const text = receiptText(plain);
    expect(text).not.toContain('سعر العقد');
    expect(text).not.toContain('الكفالة');
    expect(text).not.toContain('قُرّب');
  });
});
