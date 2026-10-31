import { describe, expect, it } from 'vitest';
import { normalizeArabic } from '@serva/core/text';
import { ids, posSets, PRODUCTS } from '../test/pos';
import { buildCatalog, searchCatalog, type CatalogSets } from './catalog';

const WORDS = [
  'حليب',
  'سكر',
  'زيت',
  'شاي',
  'رز',
  'عدس',
  'برغل',
  'طحينة',
  'تونة',
  'معكرونة',
  'لبنة',
  'جبنة',
  'قهوة',
  'بسكويت',
  'شوكولاتة',
  'مياه',
  'عصير',
  'منظف',
  'محارم',
  'صابون',
];
const SIZES = ['1 كغ', '500 غ', '1 لتر', '2 لتر', '250 غ', '400 غ', '12 قطعة', 'كبير', 'صغير', 'عائلي'];

/** A store with `count` products, each with a variant, a price and a barcode. */
function bigStore(count: number): CatalogSets {
  const sets = posSets({ products: [], variants: [], prices: [], barcodes: [] });
  for (let i = 0; i < count; i++) {
    const productId = `p${i}`;
    const variantId = `v${i}`;
    sets.products.push({
      id: productId,
      nameAr: `${WORDS[i % WORDS.length]} ماركة${i % 97} ${SIZES[i % SIZES.length]}`,
      nameEn: null,
      categoryId: i % 2 ? ids.dairy : ids.grocery,
      brand: null,
      type: 'stock',
      status: 'active',
      unitId: ids.piece,
      taxRateId: null,
      sellOnPos: true,
      archived: false,
      version: 1,
    });
    sets.variants.push({
      id: variantId,
      productId,
      sku: `SKU${i}`,
      label: null,
      attributes: [],
      sortOrder: 0,
      archived: false,
      version: 1,
    });
    sets.prices.push({
      id: variantId,
      variantId,
      currency: 'SYP',
      priceMinor: 10_000 + i,
      minPriceMinor: null,
      priceChangedAt: '2026-10-01T00:00:00Z',
      version: 1,
    });
    sets.barcodes.push({
      id: `b${i}`,
      variantId,
      code: String(6_290_000_000_000 + i),
      kind: 'standard',
      packQty: 1000,
      packName: null,
      packPriceMinor: null,
      version: 1,
    });
  }
  return sets;
}

describe('the local catalog (15 › البحث في الأصناف)', () => {
  it('finds a name however it is written, the exact barcode first', () => {
    const catalog = buildCatalog(posSets());
    expect(searchCatalog(catalog, 'شاى احمر').map((i) => i.name)).toEqual(['شاي أحمر 400 غ']);
    expect(searchCatalog(catalog, 'حليب').map((i) => i.name)).toEqual(['حليب كامل الدسم 1 لتر']);
    expect(searchCatalog(catalog, '٦٢٩١٠٠١٠٠٠٠٢٨')[0]!.name).toBe('سكر أبيض 1 كغ');
    expect(searchCatalog(catalog, 'غير موجود')).toEqual([]);
  });

  it('filters by a top-level category, including its sub-categories', () => {
    const sets = posSets();
    sets.categories.push({
      id: 'sub',
      name: 'أجبان',
      parentId: ids.dairy,
      sortOrder: 0,
      archived: false,
      version: 1,
    });
    sets.products.find((p) => p.id === PRODUCTS.tea.product.id)!.categoryId = 'sub';
    const catalog = buildCatalog(sets);
    expect(catalog.categories.map((c) => c.name)).toEqual(['ألبان وأجبان', 'مواد غذائية']);
    expect(
      searchCatalog(catalog, '', { categoryId: ids.dairy })
        .map((i) => i.name)
        .sort(),
    ).toEqual(['حليب كامل الدسم 1 لتر', 'شاي أحمر 400 غ', 'لبنة 1 كغ'].sort());
  });

  it('hides archived products and variants, products not sold on the cashier, and variants with no price', () => {
    const sets = posSets();
    sets.products.find((p) => p.id === PRODUCTS.oil.product.id)!.archived = true;
    sets.products.find((p) => p.id === PRODUCTS.tea.product.id)!.sellOnPos = false;
    sets.variants.find((v) => v.id === PRODUCTS.labneh.variant.id)!.archived = true;
    sets.prices = sets.prices.filter((p) => p.variantId !== PRODUCTS.sugar.variant.id);
    const names = buildCatalog(sets).items.map((i) => i.name);
    expect(names).not.toContain('زيت دوار الشمس 1 لتر');
    expect(names).not.toContain('شاي أحمر 400 غ');
    expect(names).not.toContain('لبنة 1 كغ');
    expect(names).not.toContain('سكر أبيض 1 كغ');
  });

  it('uses the newest rate in force, and the collect rate for payment when set', () => {
    const sets = posSets();
    sets.exchange_rates.push(
      {
        ...sets.exchange_rates[0]!,
        id: 'r2',
        rate: '135',
        collectRate: '132',
        effectiveAt: '2026-10-20T06:00:00.000Z',
      },
      { ...sets.exchange_rates[0]!, id: 'r3', rate: '999', effectiveAt: '2099-01-01T00:00:00.000Z' },
    );
    const catalog = buildCatalog(sets, Date.parse('2026-10-30T09:00:00Z'));
    expect(catalog.rates).toEqual([{ unit: 'USD', quote: 'SYP', rate: '135' }]);
    expect(catalog.collectRates.USD).toEqual({ unit: 'USD', quote: 'SYP', rate: '132' });
  });

  it('stays fast for 10,000 products: built once, each search a few milliseconds', () => {
    const sets = bigStore(10_000);
    let started = performance.now();
    const catalog = buildCatalog(sets);
    const buildMs = performance.now() - started;
    expect(catalog.items).toHaveLength(10_000);
    // The index: every item's search key is computed once, at build.
    expect(catalog.items[0]!.searchKey).toBe(normalizeArabic(catalog.items[0]!.searchKey));

    const queries = ['شوكولاته', 'زيت ماركة1', 'حليب 1 لتر', 'برغل', 'محارم عائلي', 'sku9999', 'قهوه', 'xyz'];
    started = performance.now();
    const rounds = 25;
    for (let r = 0; r < rounds; r++) for (const q of queries) searchCatalog(catalog, q);
    const perSearch = (performance.now() - started) / (rounds * queries.length);
    expect(searchCatalog(catalog, '6290000009999')[0]!.variantId).toBe('v9999');
    expect(searchCatalog(catalog, 'شوكولاته').length).toBeGreaterThan(0);
    console.info(
      `catalog of 10,000: built in ${buildMs.toFixed(1)} ms, ${perSearch.toFixed(2)} ms per search`,
    );
    // Generous bounds for a shared CI runner; a cashier PC measures far under them.
    expect(buildMs).toBeLessThan(1_500);
    expect(perSearch).toBeLessThan(25);
  });
});
