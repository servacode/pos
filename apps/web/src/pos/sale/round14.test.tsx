import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';
import { StatusBar } from '../StatusBar';
import { render } from '@testing-library/react';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });

/** The sugar has a stock level of its own (nothing left); the oil has none yet, like a new product */
function outSets(sugarQty = 0) {
  const sets = posSets();
  sets.stock_levels = [
    {
      id: PRODUCTS.sugar.variant.id,
      branchId: ids.branch,
      variantId: PRODUCTS.sugar.variant.id,
      qty: sugarQty,
      reservedQty: 0,
      version: 1,
    },
  ] as typeof sets.stock_levels;
  return sets;
}

describe('an item with nothing left (round 14)', () => {
  it('asks «بيع على كل حال؟» before a simple item goes into the cart, like a size does', async () => {
    const { user } = await saleScreen({ sets: outSets() });
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    await user.click(within(grid).getByRole('button', { name: new RegExp(PRODUCTS.sugar.product.nameAr) }));
    const ask = await screen.findByRole('dialog');
    expect(ask).toHaveTextContent('بيع على كل حال');
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).not.toBeInTheDocument();
    await user.click(within(ask).getByRole('button', { name: 'نعم، بِع على كل حال' }));
    expect(cartLines()).toHaveTextContent(PRODUCTS.sugar.product.nameAr);
  });

  it('adds nothing when the cashier says no', async () => {
    const { user } = await saleScreen({ sets: outSets() });
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    await user.click(within(grid).getByRole('button', { name: new RegExp(PRODUCTS.sugar.product.nameAr) }));
    await user.click(await screen.findByRole('button', { name: 'لا، لا تُضفه' }));
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).not.toBeInTheDocument();
  });

  it('does not ask for an item that has stock, and a new product with no level says «نفد» on its tile', async () => {
    const { user } = await saleScreen({ sets: outSets(5000) });
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    expect(
      plain(within(grid).getByRole('button', { name: new RegExp(PRODUCTS.oil.product.nameAr) })),
    ).toContain('نفد');
    await user.click(within(grid).getByRole('button', { name: new RegExp(PRODUCTS.sugar.product.nameAr) }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cartLines()).toHaveTextContent(PRODUCTS.sugar.product.nameAr);
  });
});

describe('the cart warnings (round 14)', () => {
  it('are one collapsed «N تنبيهات» row, with a ⚠ on the line, that opens to the sentences', async () => {
    const { user } = await saleScreen({ sets: outSets(1000) });
    await scan(user, PRODUCTS.sugar.barcode!.code);
    await scan(user, PRODUCTS.sugar.barcode!.code);
    const row = await screen.findByRole('button', { name: 'تنبيه واحد' });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/الموجود.*فقط/)).not.toBeInTheDocument();
    expect(within(cartLines()).getByText('عليه تنبيه')).toBeInTheDocument();
    await user.click(row);
    expect(await screen.findByText(/الموجود.*فقط/)).toBeInTheDocument();
  });

  it('keeps the rarer tools in one «أدوات الفاتورة» menu', async () => {
    const { user } = await saleScreen({ sets: outSets(9000) });
    await scan(user, PRODUCTS.sugar.barcode!.code);
    expect(screen.queryByRole('button', { name: 'احجز' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أدوات الفاتورة' }));
    expect(await screen.findByRole('menuitem', { name: 'احجز' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'عرض سعر' })).toBeInTheDocument();
  });
});

describe('the status bar at a phone (round 14)', () => {
  it('keeps the install hint out of the header row, in a strip under it', () => {
    render(<StatusBar device={null} persisted={false} online />);
    const hint = screen.getByRole('alert');
    expect(hint.closest('header')).toBeNull();
  });
});

describe('the unit of an item sold by the piece and by the box (round 14)', () => {
  function packSets() {
    const sets = outSets(50_000);
    sets.barcodes = [
      ...sets.barcodes,
      {
        id: '00000000-0000-4000-8000-0000000000f1',
        variantId: PRODUCTS.oil.variant.id,
        code: 'BOX12',
        kind: 'standard',
        packQty: 12_000,
        packName: 'علبة',
        packPriceMinor: null,
        version: 1,
      },
    ] as typeof sets.barcodes;
    return sets;
  }

  it('a remembered unit goes in with one tap, and the line’s chip changes it at the same quantity', async () => {
    const { user } = await saleScreen({ sets: packSets() });
    const tile = () =>
      within(screen.getByRole('list', { name: 'الأصناف' })).getByRole('button', {
        name: new RegExp(PRODUCTS.oil.product.nameAr),
      });
    // First time: the sheet asks, the cashier picks the piece
    await user.click(tile());
    const sheet = await screen.findByRole('region', { name: 'اختر الوحدة' });
    await user.click(within(sheet).getByRole('button', { name: /قطعة واحدة/ }));
    expect(cartLines()).toHaveTextContent(PRODUCTS.oil.product.nameAr);
    // Second time: no sheet, the piece is added at once
    await new Promise((resolve) => setTimeout(resolve, 400));
    await user.click(tile());
    expect(screen.queryByRole('region', { name: 'اختر الوحدة' })).not.toBeInTheDocument();
    // The line says its quantity once, in «2 × price»
    expect(plain(cartLines())).toMatch(/2\s*×/);
    // The chip on the line opens the sheet; the box replaces the line at the same quantity
    await user.click(within(cartLines()).getByRole('button', { name: 'غيّر الوحدة' }));
    const again = await screen.findByRole('region', { name: 'اختر الوحدة' });
    await user.click(within(again).getByRole('button', { name: /علبة/ }));
    expect(within(cartLines()).getAllByRole('listitem')).toHaveLength(1);
    expect(plain(cartLines())).toContain('علبة');
    expect(within(cartLines()).getByRole('button', { name: 'غيّر الوحدة' })).toHaveTextContent('علبة');
  });
});
