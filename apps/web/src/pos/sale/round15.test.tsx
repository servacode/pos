import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
const cartLines = () => screen.getByRole('list', { name: 'أسطر الفاتورة' });

function packSets() {
  const sets = posSets();
  sets.stock_levels = [
    {
      id: PRODUCTS.oil.variant.id,
      branchId: ids.branch,
      variantId: PRODUCTS.oil.variant.id,
      qty: 50_000,
      reservedQty: 0,
      version: 1,
    },
  ] as typeof sets.stock_levels;
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

describe('the phone mini bar (round 15)', () => {
  it('shows the count and the total in the grid view, and opens the cart', async () => {
    const { user } = await saleScreen();
    expect(screen.queryByRole('group', { name: 'ملخّص السلة' })).not.toBeInTheDocument();
    await scan(user, PRODUCTS.tea.barcode!.code);
    const bar = screen.getByRole('group', { name: 'ملخّص السلة' });
    expect(bar).toHaveTextContent('صنف واحد');
    expect(bar).toHaveTextContent('المجموع');
    await user.click(within(bar).getByRole('button', { name: 'افتح السلة' }));
    expect(screen.getByRole('complementary', { name: 'السلة' })).toHaveClass('flex');
    // In the cart view the bar is gone (the cart has its own pay button)
    expect(screen.queryByRole('group', { name: 'ملخّص السلة' })).not.toBeInTheDocument();
  });
});

describe('changing a line’s unit (round 15)', () => {
  it('keeps the line where it was, and the sheet opened from the cart leaves the cart tab alone', async () => {
    const { user } = await saleScreen({ sets: packSets() });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await scan(user, PRODUCTS.tea.barcode!.code);
    const lines = within(cartLines()).getAllByRole('listitem');
    expect(plain(lines[0]!)).toContain(PRODUCTS.oil.product.nameAr);
    const tabs = screen.getByRole('group', { name: 'عرض الشاشة' });
    await user.click(within(tabs).getByRole('button', { name: /عرض السلة/ }));
    await user.click(within(lines[0]!).getByRole('button', { name: 'غيّر الوحدة' }));
    const sheet = await screen.findByRole('region', { name: 'اختر الوحدة' });
    // Still on the cart tab behind the sheet
    expect(screen.getByRole('complementary', { name: 'السلة' })).toHaveClass('flex');
    await user.click(within(sheet).getByRole('button', { name: /علبة/ }));
    const after = within(cartLines()).getAllByRole('listitem');
    expect(after).toHaveLength(2);
    expect(plain(after[0]!)).toContain(PRODUCTS.oil.product.nameAr);
    expect(plain(after[0]!)).toContain('علبة');
  });
});

describe('the tile density (round 15)', () => {
  it('turns compact on one tap and remembers it on this device', async () => {
    const { user } = await saleScreen();
    await user.click(screen.getByRole('button', { name: 'عرض مضغوط' }));
    expect(window.localStorage.getItem('tillCompactTiles')).toBe('1');
    expect(screen.getByRole('list', { name: 'الأصناف' }).className).toContain('7.5rem');
    await user.click(screen.getByRole('button', { name: 'عرض عادي' }));
    expect(window.localStorage.getItem('tillCompactTiles')).toBeNull();
  });
});

describe('a serial-numbered piece tapped again (round 15)', () => {
  it('reopens the number prompt of the waiting line instead of piling up another line', async () => {
    const sets = posSets();
    sets.products = sets.products.map((p) =>
      p.id === PRODUCTS.oil.product.id ? { ...p, nameAr: 'هاتف A15', tracksSerial: true } : p,
    );
    const { user } = await saleScreen({ sets });
    await scan(user, PRODUCTS.oil.barcode!.code);
    expect(await screen.findByRole('region', { name: 'الرقم التسلسلي' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await scan(user, PRODUCTS.oil.barcode!.code);
    expect(await screen.findByRole('region', { name: 'الرقم التسلسلي' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(cartLines()).getAllByRole('listitem')).toHaveLength(1);
  });
});
