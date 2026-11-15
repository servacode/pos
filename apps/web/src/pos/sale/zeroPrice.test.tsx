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

describe('a service priced at zero', () => {
  const service = product('تقصير', 0, '6291009999992');
  it('asks no zero-price question and opens the fee at once', async () => {
    const s = posSets();
    const { user } = await saleScreen({
      sets: {
        ...s,
        products: [...s.products, { ...service.product, type: 'service' }],
        variants: [...s.variants, service.variant],
        prices: [...s.prices, service.price],
        barcodes: [...s.barcodes, service.barcode!],
      },
    });
    await scan(user, '6291009999992');
    expect(screen.queryByRole('dialog', { name: 'السعر 0 — تأكيد؟' })).not.toBeInTheDocument();
    expect(await screen.findByText('حدّد الأجرة')).toBeInTheDocument();
  });

  const serviceSets = () => {
    const s = posSets();
    return {
      ...s,
      products: [...s.products, { ...service.product, type: 'service' as const }],
      variants: [...s.variants, service.variant],
      prices: [...s.prices, service.price],
      barcodes: [...s.barcodes, service.barcode!],
    };
  };

  it('takes a fee above the shelf price, and the line is worth that fee', async () => {
    const { user } = await saleScreen({ sets: serviceSets() });
    await scan(user, '6291009999992');
    const panel = await screen.findByRole('region', { name: 'حدّد الأجرة' });
    expect(within(panel).getByText('خدمة: الأجرة تُحدَّد عند البيع')).toBeInTheDocument();
    expect(within(panel).queryByText(/سعر الرف للواحدة/)).not.toBeInTheDocument();
    await user.keyboard('1500');
    await user.click(within(panel).getByRole('button', { name: 'طبّق' }));
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(screen.getByRole('list', { name: 'أسطر الفاتورة' })).toHaveTextContent('1,500');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves no line behind when the fee is cancelled', async () => {
    const { user } = await saleScreen({ sets: serviceSets() });
    await scan(user, '6291009999992');
    const panel = await screen.findByRole('region', { name: 'حدّد الأجرة' });
    await user.click(within(panel).getByRole('button', { name: /ارجع للأصناف/ }));
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).not.toBeInTheDocument();
  });
});
