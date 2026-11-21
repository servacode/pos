import { describe, expect, it } from 'vitest';
import type { StockBatch } from '@serva/core/contracts/pharmacy';
import { alternativesFor, availableOf } from './alternatives';
import type { CatalogItem } from '../catalog';

const TODAY = '2026-10-30';

function item(over: Partial<CatalogItem> & { variantId: string; productId: string }): CatalogItem {
  return {
    name: over.variantId,
    searchKey: over.variantId,
    categoryId: null,
    unit: null,
    taxRate: null,
    stockQty: 5000,
    price: { currency: 'SYP', priceMinor: 10_000, minPriceMinor: null },
    ...over,
  } as CatalogItem;
}

const PARA = { genericName: 'باراسيتامول', strength: '500 ملغ', dosageForm: 'أقراص' };

describe('alternativesFor', () => {
  const asked = item({ variantId: 'panadol', productId: 'p1', name: 'بانادول', ...PARA, stockQty: 0 });
  const catalog = {
    items: [
      asked,
      item({
        variantId: 'abimol',
        productId: 'p2',
        name: 'أبيمول',
        ...PARA,
        price: { currency: 'SYP', priceMinor: 8000, minPriceMinor: null },
      }),
      item({
        variantId: 'cetamol',
        productId: 'p3',
        name: 'سيتامول',
        ...PARA,
        price: { currency: 'SYP', priceMinor: 12_000, minPriceMinor: null },
      }),
      item({ variantId: 'syrup', productId: 'p4', name: 'بانادول شراب', ...PARA, dosageForm: 'شراب' }),
      item({ variantId: 'strong', productId: 'p5', name: 'بانادول 1غ', ...PARA, strength: '1 غ' }),
      item({
        variantId: 'ibu',
        productId: 'p6',
        name: 'بروفين',
        genericName: 'إيبوبروفين',
        strength: '500 ملغ',
        dosageForm: 'أقراص',
      }),
      item({ variantId: 'gone', productId: 'p7', name: 'نفد', ...PARA, stockQty: 0 }),
      item({ variantId: 'plain', productId: 'p8', name: 'بلا اسم علمي' }),
    ],
  };

  it('lists the same ingredient, strength and form that are in stock, cheapest first', () => {
    expect(alternativesFor(asked, catalog, TODAY).map((a) => a.item.variantId)).toEqual([
      'abimol',
      'cetamol',
    ]);
  });

  it('is empty for an item with no generic name', () => {
    expect(alternativesFor(catalog.items.at(-1)!, catalog, TODAY)).toEqual([]);
  });

  it('never offers the item itself or another size of the same product', () => {
    const sibling = item({ variantId: 'panadol-b', productId: 'p1', name: 'بانادول ب', ...PARA });
    expect(
      alternativesFor(asked, { items: [...catalog.items, sibling] }, TODAY).map((a) => a.item.variantId),
    ).not.toContain('panadol-b');
  });

  it('counts only what can be sold: an expired batch is not an alternative', () => {
    const expired: StockBatch = { batchNo: 'E', expiry: '2026-01-01', qty: 5000 };
    const good: StockBatch = { batchNo: 'G', expiry: '2027-01-01', qty: 3000 };
    const onlyExpired = item({
      variantId: 'x',
      productId: 'px',
      ...PARA,
      stockQty: 5000,
      stockBatches: [expired],
    });
    const mixed = item({
      variantId: 'y',
      productId: 'py',
      ...PARA,
      stockQty: 8000,
      stockBatches: [expired, good],
    });
    expect(availableOf(onlyExpired, TODAY)).toBe(0);
    expect(availableOf(mixed, TODAY)).toBe(3000);
    expect(
      alternativesFor(asked, { items: [onlyExpired, mixed] }, TODAY).map((a) => [
        a.item.variantId,
        a.available,
      ]),
    ).toEqual([['y', 3000]]);
  });
});
