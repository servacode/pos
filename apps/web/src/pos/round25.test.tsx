import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { posSets, product } from '../test/pos';
import { saleScreen } from '../test/renderPos';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import { isolateSizes } from './format';
import { receiptLines } from './print/lines';
import { Receipt, type ReceiptData } from './receipt/Receipt';
import { RENTAL_DEPOSIT_REF, shiftActivity } from './shift/shift';

const settings = {
  timezone: 'Asia/Damascus',
  businessDayCutoff: '00:00',
  sectors: ['clothing'],
  storeName: 'بوتيك',
  enabledCurrencies: ['SYP'],
} as unknown as SettingsRow;

const gift: ReceiptData = {
  giftReceipt: true,
  doc: {
    number: 'INV-9',
    deviceTime: '2026-10-30T09:00:00.000Z',
    payload: {
      currency: 'SYP',
      exchangeRates: [],
      lines: [
        {
          lineNo: 1,
          variantId: 'v1',
          name: 'قميص 3-6m',
          qty: 1000,
          baseQty: 2000,
          unitPriceMinor: 90_000,
          packQty: 1000,
          unitName: null,
          priced: { grossMinor: 180_000, totalMinor: 180_000, lineDiscountMinor: 0 },
        },
      ],
      totals: { totalMinor: 180_000, grossMinor: 180_000, discountMinor: 0 },
      payments: [{ paymentNo: 1, method: 'cash', currency: 'SYP', amountMinor: 180_000 }],
    },
  } as unknown as ReceiptData['doc'],
  settings,
  branch: null,
  storeName: 'بوتيك',
  branchName: 'الرئيسي',
  deviceName: 'كاشير',
  cashierName: 'ليلى',
};

describe('round 25 till', () => {
  it('wraps sizes like 3-6m and 32×34 as left-to-right islands, leaving other text alone', () => {
    expect(isolateSizes('قميص 3-6m أحمر')).toBe('قميص \u20663-6m\u2069 أحمر');
    expect(isolateSizes('بنطال 32×34')).toBe('بنطال \u206632×34\u2069');
    expect(isolateSizes('فستان سهرة')).toBe('فستان سهرة');
  });

  it('prints a gift receipt with the pieces and the return days but no price or payment', () => {
    render(<Receipt data={gift} />);
    const slip = screen.getByLabelText('إيصال هدية 80 مم');
    const text = slip.textContent ?? '';
    expect(text).toContain('إيصال هدية');
    expect(text).toContain('3-6m');
    expect(text).toContain('خلال 30 يوماً');
    expect(text).not.toMatch(/180|90,000|نقداً|الإجمالي/);
    const lines = receiptLines(gift).map((l) => ('text' in l ? l.text : 'start' in l ? l.start + l.end : ''));
    expect(lines.join('|')).toContain('إيصال هدية');
    expect(lines.join('|')).not.toMatch(/180|نقداً|الإجمالي/);
  });

  it('names a rental deposit on its own line and keeps it out of the gift vouchers', () => {
    const entry = (reference: string | null) =>
      ({
        seq: 1,
        type: 'gift_voucher',
        doc: {
          type: 'gift_voucher',
          payload: { shiftId: 's1', currency: 'SYP', amountMinor: 500_000, method: 'cash', reference },
        },
      }) as never;
    const rental = shiftActivity('s1', [entry(RENTAL_DEPOSIT_REF)]);
    expect(rental.vouchers.count).toBe(0);
    expect(rental.rentalDeposits?.count).toBe(1);
    expect(rental.cashIn?.rentals).toEqual([{ currency: 'SYP', amountMinor: 500_000 }]);
    expect(rental.terms.get('SYP')?.receiptsMinor).toBe(500_000);
    const plain = shiftActivity('s1', [entry(null)]);
    expect(plain.vouchers.count).toBe(1);
    expect(plain.rentalDeposits).toBeUndefined();
  });

  it('shows 60 items of the «الكل» view and offers «عرض المزيد» for the rest', async () => {
    const extra = Array.from({ length: 70 }, (_, i) =>
      product(`صنف ${String(i).padStart(3, '0')}`, 1_000 + i, null),
    );
    const base = posSets();
    const sets = {
      ...base,
      products: [...base.products, ...extra.map((p) => p.product)],
      variants: [...base.variants, ...extra.map((p) => p.variant)],
      prices: [...base.prices, ...extra.map((p) => p.price)],
    } as typeof base;
    const { user } = await saleScreen({ sets });
    const tiles = () => screen.getByRole('list', { name: 'الأصناف' }).querySelectorAll('li').length;
    expect(tiles()).toBe(60);
    await user.click(screen.getByRole('button', { name: 'عرض المزيد' }));
    expect(tiles()).toBe(77);
    expect(screen.queryByRole('button', { name: 'عرض المزيد' })).not.toBeInTheDocument();
  });
});
