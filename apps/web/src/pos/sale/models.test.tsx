import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import type { CatalogItem } from '../catalog';
import { posSets, product } from '../../test/pos';
import { saleScreen } from '../../test/renderPos';
import { canChoose, gridEntries, modelPieces, optionsOf, pieceFor, piecesText } from './models';

function piece(variantId: string, size: string, colour: string, priceMinor = 45_000): CatalogItem {
  return {
    variantId,
    productId: 'p-shirt',
    name: `قميص كتان ${size} ${colour}`,
    productName: 'قميص كتان',
    attributes: [
      { name: 'المقاس', value: size },
      { name: 'اللون', value: colour },
    ],
    searchKey: '',
    categoryId: null,
    unit: null,
    taxRate: null,
    price: { currency: 'SYP', priceMinor, minPriceMinor: null },
  };
}

const shirt = [piece('v-mw', 'M', 'أبيض'), piece('v-lw', 'L', 'أبيض'), piece('v-lb', 'L', 'أزرق')];

describe('a model and its pieces', () => {
  it('shows a model once, where its first piece stood, and a single piece as itself', () => {
    const tea: CatalogItem = { ...piece('v-tea', '', ''), productId: 'p-tea', attributes: [], name: 'شاي' };
    const pieces = modelPieces([...shirt, tea]);
    expect([...pieces.keys()]).toEqual(['p-shirt']);
    const entries = gridEntries([shirt[1]!, tea, shirt[0]!], pieces);
    expect(entries.map((e) => (e.kind === 'model' ? e.name : e.item.name))).toEqual(['قميص كتان', 'شاي']);
  });

  it('lists the options in order, and finds the piece once each has a value', () => {
    expect(optionsOf(shirt)).toEqual([
      { name: 'المقاس', values: ['M', 'L'] },
      { name: 'اللون', values: ['أبيض', 'أزرق'] },
    ]);
    expect(pieceFor(shirt, { المقاس: 'L' }, 2)).toBeNull();
    expect(pieceFor(shirt, { المقاس: 'L', اللون: 'أزرق' }, 2)?.variantId).toBe('v-lb');
  });

  it('strikes out a value no piece has with the other choice', () => {
    expect(canChoose(shirt, { المقاس: 'M' }, 'اللون', 'أزرق')).toBe(false);
    expect(canChoose(shirt, { المقاس: 'L' }, 'اللون', 'أزرق')).toBe(true);
  });

  it('counts the pieces in Arabic', () => {
    expect(piecesText(2)).toBe('خياران');
    expect(piecesText(6)).toBe('6 خيارات');
    expect(piecesText(12)).toBe('12 خياراً');
  });
});

describe('the till grid for a clothing model', () => {
  it('shows one tile for the shirt, and adds the size and colour picked beside the cart', async () => {
    const base = product('قميص كتان', 45_000, null);
    const sizes = [
      ['M', 'أبيض'],
      ['L', 'أبيض'],
      ['L', 'أزرق'],
    ] as const;
    const variants = sizes.map(([size, colour], index) => ({
      ...base.variant,
      id: `00000000-0000-4000-8000-00000000a0${index}`,
      label: `${size} ${colour}`,
      attributes: [
        { name: 'المقاس', value: size },
        { name: 'اللون', value: colour },
      ],
      sortOrder: index,
    }));
    const sets = posSets();
    const { user } = await saleScreen({
      sets: {
        ...sets,
        products: [...sets.products, base.product],
        variants: [...sets.variants, ...variants],
        prices: [...sets.prices, ...variants.map((v) => ({ ...base.price, id: v.id, variantId: v.id }))],
      },
    });

    const grid = screen.getByRole('list', { name: 'الأصناف' });
    const tiles = within(grid).getAllByRole('button', { name: /قميص كتان/ });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toHaveTextContent('3 خيارات');

    await user.click(tiles[0]!);
    const picker = await screen.findByRole('region', { name: 'اختر من قميص كتان' });
    await user.click(within(picker).getByRole('button', { name: 'L' }));
    expect(within(picker).getByRole('button', { name: 'أزرق' })).toBeEnabled();
    await user.click(within(picker).getByRole('button', { name: 'M' }));
    expect(within(picker).getByRole('button', { name: 'أزرق' })).toBeDisabled();
    await user.click(within(picker).getByRole('button', { name: 'L' }));
    await user.click(within(picker).getByRole('button', { name: 'أزرق' }));
    await user.click(
      within(picker).getByRole('button', { name: (n) => stripBidiControls(n).startsWith('أضف L أزرق') }),
    );

    expect(screen.queryByRole('region', { name: 'اختر من قميص كتان' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'أسطر الفاتورة' })).toHaveTextContent('قميص كتان L أزرق');
  });
});
