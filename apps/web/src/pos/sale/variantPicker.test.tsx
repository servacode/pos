import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../catalog';
import { VariantPicker } from './VariantPicker';

function piece(variantId: string, size: string, colour: string, stockQty: number | null): CatalogItem {
  return {
    variantId,
    productId: 'p-shirt',
    name: `قميص ${size} ${colour}`,
    productName: 'قميص',
    attributes: [
      { name: 'المقاس', value: size },
      { name: 'اللون', value: colour },
    ],
    searchKey: '',
    categoryId: null,
    stockQty,
    unit: null,
    taxRate: null,
    price: { currency: 'SYP', priceMinor: 45_000, minPriceMinor: null },
  };
}

const pieces = [piece('v1', 'M', 'أبيض', 5000), piece('v2', 'L', 'أبيض', 0), piece('v3', 'L', 'أزرق', 2000)];

function open() {
  const onAdd = vi.fn();
  const user = userEvent.setup();
  render(<VariantPicker name="قميص" pieces={pieces} onAdd={onAdd} onCancel={() => undefined} />);
  return { onAdd, user, picker: screen.getByRole('region', { name: 'اختر من قميص' }) };
}

describe('the model picker', () => {
  it('adds at the last choice, with the quantity set before it', async () => {
    const { onAdd, user, picker } = open();
    await user.click(within(picker).getByRole('button', { name: 'زد الكمية' }));
    await user.click(within(picker).getByRole('button', { name: 'زد الكمية' }));
    await user.click(within(picker).getByRole('button', { name: 'L' }));
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(within(picker).getByRole('button', { name: 'أزرق' }));
    // The quantity was set by hand: the last choice shows the price and «أضف» adds
    expect(onAdd).not.toHaveBeenCalled();
    await user.click(within(picker).getByRole('button', { name: /^أضف/ }));
    expect(onAdd).toHaveBeenCalledWith(pieces[2], 3);
  });

  it('adds by itself at the last choice when the quantity was left alone', async () => {
    const { onAdd, user, picker } = open();
    await user.click(within(picker).getByRole('button', { name: 'M' }));
    await user.click(within(picker).getByRole('button', { name: 'أبيض' }));
    expect(onAdd).toHaveBeenCalledWith(pieces[0], 1);
  });

  it('does not add an out-of-stock combination by itself, only when asked', async () => {
    const { onAdd, user, picker } = open();
    await user.click(within(picker).getByRole('button', { name: 'L' }));
    await user.click(within(picker).getByRole('button', { name: 'أبيض' }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(within(picker).getByText('نفد هذا الاختيار')).toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: 'نفد — أضفه رغم ذلك' }));
    expect(onAdd).toHaveBeenCalledWith(pieces[1], 1);
  });
});
