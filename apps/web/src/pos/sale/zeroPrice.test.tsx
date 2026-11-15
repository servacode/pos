import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { posSets, product } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/** An item priced at zero is confirmed before it goes into the cart (round 8: G4/S5). */
describe('an item priced at zero', () => {
  const free = product('تقصير', 0, '6291009999991');
  const sets = () => {
    const s = posSets();
    return {
      ...s,
      products: [...s.products, free.product],
      variants: [...s.variants, free.variant],
      prices: [...s.prices, free.price],
      barcodes: [...s.barcodes, free.barcode!],
    };
  };

  it('asks first, and adds nothing when the cashier says no', async () => {
    const { user } = await saleScreen({ sets: sets() });
    await scan(user, '6291009999991');
    const dialog = await screen.findByRole('dialog', { name: 'السعر 0 — تأكيد؟' });
    await user.click(within(dialog).getByRole('button', { name: 'لا، لا تُضفه' }));
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).not.toBeInTheDocument();
  });

  it('adds it after a yes, and asks once for the same item in the cart', async () => {
    const { user } = await saleScreen({ sets: sets() });
    await scan(user, '6291009999991');
    const dialog = await screen.findByRole('dialog', { name: 'السعر 0 — تأكيد؟' });
    await user.click(within(dialog).getByRole('button', { name: 'نعم، أضفه بسعر 0' }));
    expect(screen.getByRole('list', { name: 'أسطر الفاتورة' })).toHaveTextContent('تقصير');
    await scan(user, '6291009999991');
    expect(screen.queryByRole('dialog', { name: 'السعر 0 — تأكيد؟' })).not.toBeInTheDocument();
  });
});
