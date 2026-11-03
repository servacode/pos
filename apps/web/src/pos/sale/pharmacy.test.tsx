import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripBidiControls } from '@serva/core/text';
import { posSets, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/** Pharmacies at the till: the scientific name finds the medicine, an expired shelf warns. */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');

function pharmacySets(nearestExpiry: string | null) {
  const sets = posSets();
  sets.products = sets.products.map((p) =>
    p.id === PRODUCTS.tea.product.id ? { ...p, nameAr: 'بانادول 500', genericName: 'باراسيتامول' } : p,
  );
  sets.variants = sets.variants.map((v) => (v.id === PRODUCTS.tea.variant.id ? { ...v, nearestExpiry } : v));
  return sets;
}

describe('a pharmacy till', () => {
  it('finds the medicine by its scientific name', async () => {
    const { user } = await saleScreen({ sets: pharmacySets(null) });
    await user.type(screen.getByRole('searchbox'), 'باراسيتامول');
    const grid = screen.getByRole('list', { name: 'الأصناف' });
    expect(plain(grid)).toContain('بانادول 500');
  });

  it('warns when the shelf has expired, and tells when it soon will', async () => {
    const { user } = await saleScreen({ sets: pharmacySets('2020-01-31') });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(/صلاحية «بانادول 500» انتهت في 2020-01-31/)).toBeInTheDocument();
    // It is still added: the cashier checks the box
    expect(plain(screen.getByRole('list', { name: 'أسطر الفاتورة' }))).toContain('بانادول 500');
  });

  it('says nothing for a far expiry', async () => {
    const { user } = await saleScreen({ sets: pharmacySets('2099-12-31') });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(screen.queryByText(/صلاحية/)).toBeNull();
  });
});
