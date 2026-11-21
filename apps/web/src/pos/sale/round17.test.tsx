import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../catalog';
import { PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';
import { changeLabel, variantSplit } from './models';
import { VariantPicker } from './VariantPicker';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function piece(variantId: string, size: string, colour: string): CatalogItem {
  return {
    variantId,
    productId: 'p-shirt',
    name: `قميص ${size} · ${colour}`,
    productName: 'قميص',
    attributes: [
      { name: 'المقاس', value: size },
      { name: 'اللون', value: colour },
    ],
    searchKey: '',
    categoryId: null,
    stockQty: 5000,
    unit: null,
    taxRate: null,
    price: { currency: 'SYP', priceMinor: 45_000, minPriceMinor: null },
  };
}
const pieces = [piece('v1', 'M', 'أبيض'), piece('v2', 'L', 'أبيض'), piece('v3', 'L', 'أزرق')];

describe('round 17: the till', () => {
  it('pays cash with the exact due already typed: one tap completes, typing replaces it', async () => {
    const { user } = await saleScreen();
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    expect(within(pay).getByRole('button', { name: /أتمّ الدفع/ })).toBeEnabled();
    expect(within(pay).getByText('المبلغ المستلم · نقد بالليرة').nextElementSibling?.textContent).toContain(
      '250',
    );
    await user.keyboard('1000');
    expect(within(pay).getByText('المبلغ المستلم · نقد بالليرة').nextElementSibling?.textContent).toContain(
      '1,000',
    );
  });

  it('opens the picker with the tapped size already chosen, and changes a line in place with its own words', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(
      <VariantPicker
        name="قميص"
        pieces={pieces}
        initial={{ المقاس: 'L' }}
        actionLabel="بدّل في السلة"
        onAdd={onAdd}
        onCancel={() => undefined}
      />,
    );
    const picker = screen.getByRole('region', { name: 'اختر من قميص' });
    expect(within(picker).getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(picker).getByRole('button', { name: 'أزرق' }));
    await user.click(within(picker).getByRole('button', { name: /^بدّل في السلة/ }));
    expect(onAdd).toHaveBeenCalledWith(pieces[2], 1);
  });

  it('keeps a variant whole after the product name, and names what a line can change', () => {
    expect(variantSplit('قميص L · أزرق', pieces[2])).toEqual({ name: 'قميص', variant: 'L · أزرق' });
    expect(variantSplit('خدمة · X', { ...pieces[2]!, attributes: [] })).toEqual({
      name: 'خدمة · X',
      variant: null,
    });
    expect(changeLabel(pieces)).toBe('غيّر المقاس واللون');
  });
});
