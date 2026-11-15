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

const tile = () =>
  within(screen.getByRole('list', { name: 'الأصناف' })).getByRole('button', {
    name: new RegExp(PRODUCTS.oil.product.nameAr),
  });

describe('the unit sheet opened from the cart (round 16)', () => {
  it('sits in the page body, not inside the items tab that a phone hides while the cart shows', async () => {
    const { user } = await saleScreen({ sets: packSets() });
    await scan(user, PRODUCTS.oil.barcode!.code);
    const tabs = screen.getByRole('group', { name: 'عرض الشاشة' });
    await user.click(within(tabs).getByRole('button', { name: /عرض السلة/ }));
    await user.click(within(cartLines()).getByRole('button', { name: 'غيّر الوحدة' }));
    const sheet = await screen.findByRole('region', { name: 'اختر الوحدة' });
    expect(sheet.closest('main')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'السلة' })).toHaveClass('flex');
  });
});

describe('the unit of an item in a new sale (round 16)', () => {
  it('asks again after the cart is emptied, and says the unit on the «أُضيف» note', async () => {
    const { user } = await saleScreen({ sets: packSets() });
    await user.click(tile());
    const sheet = await screen.findByRole('region', { name: 'اختر الوحدة' });
    await user.click(within(sheet).getByRole('button', { name: /علبة/ }));
    // This sale: the box was chosen, one tap adds it again and the note names the unit
    await new Promise((resolve) => setTimeout(resolve, 400));
    await user.click(tile());
    expect(screen.queryByRole('region', { name: 'اختر الوحدة' })).not.toBeInTheDocument();
    const note = await screen.findByText(/أُضيف/);
    expect(plain(note.closest('p')!)).toContain('علبة');
    // A new sale starts from the question again, whatever was used before
    for (const remove of within(cartLines()).getAllByRole('button', { name: 'احذف السطر' }))
      await user.click(remove);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await user.click(tile());
    expect(await screen.findByRole('region', { name: 'اختر الوحدة' })).toBeInTheDocument();
  });
});

describe('why «ادفع» is greyed (round 16)', () => {
  it('says which number is missing, and a tap on it opens the number prompt', async () => {
    const sets = posSets();
    sets.products = sets.products.map((p) =>
      p.id === PRODUCTS.oil.product.id ? { ...p, nameAr: 'هاتف A15', tracksSerial: true } : p,
    );
    const { user } = await saleScreen({ sets });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await screen.findByRole('region', { name: 'الرقم التسلسلي' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /ادفع/ })).toBeDisabled();
    const reason = screen.getByRole('button', { name: /أدخل الرقم التسلسلي لـ/ });
    expect(plain(reason)).toContain('هاتف A15');
    await user.click(reason);
    expect(await screen.findByRole('region', { name: 'الرقم التسلسلي' })).toBeInTheDocument();
  });
});
