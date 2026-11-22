import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../catalog';
import { buildCatalog } from '../catalog';
import { posSets } from '../../test/pos';
import { receiptText } from '../receipt/whatsapp';
import type { ReceiptData } from '../receipt/Receipt';
import { shiftActivity } from '../shift/shift';
import { addItem, applyContractPrices, contractSavingMinor, contractSavingsOf, EMPTY_CART } from './cart';
import { VariantPicker } from './VariantPicker';

function piece(size: string, colour: string, stockQty: number): CatalogItem {
  return {
    variantId: `v-${size}-${colour}`,
    productId: 'p-jeans',
    name: `بنطال ${size} ${colour}`,
    productName: 'بنطال',
    attributes: [
      { name: 'المقاس', value: size },
      { name: 'اللون', value: colour },
    ],
    searchKey: '',
    categoryId: null,
    unit: null,
    taxRate: null,
    price: { currency: 'SYP', priceMinor: 120_000, minPriceMinor: null },
    stockQty,
  };
}

const jeans = [
  piece('36', 'أزرق', 0),
  piece('36', 'أسود', 7000),
  piece('38', 'أسود', 3000),
  piece('38', 'أزرق', 2000),
];

describe('the picker never leaves a dead end (round 19)', () => {
  it('chooses the only colour that still has stock, so the add button shows at once', () => {
    render(
      <VariantPicker
        name="بنطال"
        pieces={jeans}
        initial={{ المقاس: '36' }}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /أضف إلى السلة/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'أسود' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says what is left to choose on a disabled button when two colours have stock', () => {
    render(
      <VariantPicker
        name="بنطال"
        pieces={jeans}
        initial={{ المقاس: '38' }}
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'اختر اللون' })).toBeDisabled();
  });

  it('shows the quantity and the line total of a swap, with no stepper', () => {
    render(
      <VariantPicker
        name="بنطال"
        pieces={jeans}
        initial={{ المقاس: '36' }}
        swap
        fixedQty={2000}
        actionLabel="بدّل في السلة"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'زد الكمية' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بدّل في السلة/ }).textContent).toContain('2,400');
  });
});

describe('contract prices keep the shelf price to show the saving (round 19)', () => {
  const item = buildCatalog(posSets()).items[0]!;
  it('remembers the price it replaced, and works out what was saved', () => {
    const cart = addItem(EMPTY_CART, item, undefined, 2000);
    const shelf = cart.lines[0]!.priceMinor;
    const priced = applyContractPrices(cart, [
      { variantId: item.variantId, currency: item.price.currency, priceMinor: shelf - 100 },
    ]);
    const line = priced.lines[0]!;
    expect(line.shelfPriceMinor).toBe(shelf);
    const ctx = { currency: item.price.currency, taxInclusive: true, rates: [] } as never;
    expect(contractSavingMinor(line, ctx)).toBe(200);
    // Applied twice it still remembers the first price
    const again = applyContractPrices(priced, [
      { variantId: item.variantId, currency: item.price.currency, priceMinor: shelf - 100 },
    ]);
    expect(again.lines[0]!.shelfPriceMinor).toBe(shelf);
    const sale = { lines: [{ lineNo: line.lineNo, priced: { grossMinor: (shelf - 100) * 2 } }] };
    expect(contractSavingsOf(priced, sale)).toEqual({ [line.lineNo]: 200 });
  });

  it('is said on the WhatsApp text, per line and in total', () => {
    const data = {
      doc: {
        number: 'INV-1',
        deviceTime: '2026-10-30T09:00:00.000Z',
        payload: {
          currency: 'SYP',
          lines: [
            {
              lineNo: 1,
              variantId: 'v1',
              name: 'جهاز',
              qty: 1000,
              priced: { totalMinor: 90_000, grossMinor: 90_000 },
            },
          ],
          totals: { totalMinor: 90_000 },
          payments: [{ method: 'cash', currency: 'SYP', amountMinor: 90_000 }],
        },
      },
      settings: { storeName: 'مركز' },
      storeName: 'مركز',
      contractVariantIds: ['v1'],
      contractSavings: { 1: 10_000 },
    } as unknown as ReceiptData;
    const text = receiptText(data);
    expect(text).toContain('سعر العقد (بدل');
    expect(text).toContain('وفّرت');
  });
});

describe('cash rounding in the shift (round 19)', () => {
  it('adds up what cash rounding took off the shift’s invoices', () => {
    const entry = (n: number, roundingMinor: number) =>
      ({
        doc: {
          type: 'sale',
          payload: {
            shiftId: 's1',
            currency: 'SYP',
            payments: [],
            totals: { totalMinor: 0, discountMinor: 0 },
            cashierId: 'u1',
            cashRounding: { currency: 'SYP', roundingMinor },
          },
          id: String(n),
        },
      }) as never;
    const activity = shiftActivity('s1', [entry(1, -350), entry(2, -150)]);
    expect(activity.cashRounding).toEqual([{ currency: 'SYP', amountMinor: -500 }]);
    expect(shiftActivity('s1', []).cashRounding).toBeUndefined();
  });
});
