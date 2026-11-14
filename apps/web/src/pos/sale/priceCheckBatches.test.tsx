import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog';
import { PriceCheckCard } from './ItemsArea';

/** The price checker marks expired batches and counts only what can be sold (display only). */

const piece = {
  variantId: 'v1',
  name: 'قفازات قديمة',
  price: { priceMinor: 1_000, currency: 'SYP' },
  // The pulled total counts the expired batch too: the card must not
  stockQty: 1_980_000,
  stockBatches: [
    { batchNo: 'OLD', expiry: '2026-01-01', qty: 500_000 },
    { batchNo: 'NEW', expiry: '2027-06-30', qty: 1_480_000 },
  ],
} as unknown as CatalogItem;

describe('the price checker with batches', () => {
  it('counts only the sellable pieces, says what is expired, and lists each batch with its quantity', () => {
    render(<PriceCheckCard today="2026-11-14" check={{ name: 'قفازات', pieces: [piece], focus: 'v1' }} />);
    expect(screen.getByText(/المتوفر 1[,٬]?480/)).toBeInTheDocument();
    expect(screen.getByText(/غير صالح للبيع/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'الدفعات وتواريخ الصلاحية' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('OLD');
    expect(rows[0]).toHaveTextContent('منتهية');
    expect(rows[0]).toHaveTextContent('الكمية');
    expect(rows[1]).not.toHaveTextContent('منتهية');
  });
});
