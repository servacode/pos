import type { CurrencyCode } from '@serva/core';
import type {
  BarcodeRow,
  CategoryRow,
  ExchangeRateRow,
  PriceRow,
  ProductRow,
  PullSetRows,
  SettingsRow,
  TaxRateRow,
  UnitRow,
  VariantRow,
} from '@serva/core/contracts/catalog';
import type { TradeRate } from '@serva/core/contracts/common';
import { normalizeArabic, toLatinDigits } from '@serva/core/text';
import type { SyncStore } from '@serva/sync/client';
import type { StaffSets } from './staff/staff';

/**
 * The sale screen's catalog, built once from the pulled sets in the device database and kept in
 * memory (15 › البحث في الأصناف): every sellable variant with its price, unit and tax rate, a map of
 * barcodes for the exact match (15: الباركود مسار منفصل وأول), and each item's search key
 * normalizeArabic(name, English name, brand, SKU) computed once — the search index. Typing then
 * scans those keys only, which stays under a few milliseconds for 10,000 products.
 */

export interface CatalogItem {
  variantId: string;
  productId: string;
  /** The product name with the variant's label, as shown and printed */
  name: string;
  searchKey: string;
  categoryId: string | null;
  unit: UnitRow | null;
  taxRate: TaxRateRow | null;
  price: { currency: CurrencyCode; priceMinor: number; minPriceMinor: number | null };
}

export interface BarcodeHit {
  item: CatalogItem;
  barcode: BarcodeRow;
}

export interface Catalog {
  items: CatalogItem[];
  byVariant: Map<string, CatalogItem>;
  byBarcode: Map<string, BarcodeHit>;
  /** Top-level categories for the chips, in sortOrder */
  categories: CategoryRow[];
  /** Each category's top-level ancestor, so a chip shows its sub-categories' products too */
  rootOf: Map<string, string>;
  settings: SettingsRow | null;
  /** The current rate of each foreign currency against the base one (newest effectiveAt) */
  rates: TradeRate[];
  /** The rate dollars are taken at in payment, when the store sets one (10 › سعر قبض الدولار) */
  collectRates: Partial<Record<CurrencyCode, TradeRate>>;
  staff: StaffSets;
}

export type CatalogSets = { [K in keyof PullSetRows]: PullSetRows[K][] };

export const CATALOG_SETS = [
  'products',
  'variants',
  'prices',
  'barcodes',
  'categories',
  'units',
  'tax_rates',
  'stock_levels',
  'exchange_rates',
  'settings',
  'users',
  'roles',
  'user_roles',
  'branches',
] as const satisfies readonly (keyof PullSetRows)[];

export async function readCatalogSets(store: SyncStore): Promise<CatalogSets> {
  const entries = await Promise.all(
    CATALOG_SETS.map(async (set) => [set, await store.readSet(set)] as const),
  );
  return Object.fromEntries(entries) as unknown as CatalogSets;
}

function currentRates(
  rows: ExchangeRateRow[],
  base: CurrencyCode,
  now: number,
): { rates: TradeRate[]; collectRates: Partial<Record<CurrencyCode, TradeRate>> } {
  const newest = new Map<CurrencyCode, ExchangeRateRow>();
  for (const row of rows) {
    if (row.unit !== base && row.quote !== base) continue;
    if (Date.parse(row.effectiveAt) > now) continue;
    const foreign = row.unit === base ? row.quote : row.unit;
    const held = newest.get(foreign);
    if (!held || held.effectiveAt < row.effectiveAt) newest.set(foreign, row);
  }
  const rates: TradeRate[] = [];
  const collectRates: Partial<Record<CurrencyCode, TradeRate>> = {};
  for (const [foreign, row] of newest) {
    rates.push({ unit: row.unit, quote: row.quote, rate: row.rate });
    if (row.collectRate) collectRates[foreign] = { unit: row.unit, quote: row.quote, rate: row.collectRate };
  }
  return { rates, collectRates };
}

export function buildCatalog(sets: CatalogSets, now: number = Date.now()): Catalog {
  const settings = sets.settings[0] ?? null;
  const products = new Map<string, ProductRow>(sets.products.map((p) => [p.id, p]));
  const prices = new Map<string, PriceRow>(sets.prices.map((p) => [p.variantId, p]));
  const units = new Map(sets.units.map((u) => [u.id, u]));
  const taxes = new Map(sets.tax_rates.map((t) => [t.id, t]));

  const items: CatalogItem[] = [];
  const byVariant = new Map<string, CatalogItem>();
  const variants = [...sets.variants].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const variant of variants as VariantRow[]) {
    const product = products.get(variant.productId);
    const price = prices.get(variant.id);
    if (!product || !price || variant.archived || product.archived || !product.sellOnPos) continue;
    const name = variant.label ? `${product.nameAr} ${variant.label}` : product.nameAr;
    const item: CatalogItem = {
      variantId: variant.id,
      productId: product.id,
      name,
      searchKey: normalizeArabic(
        [name, product.nameEn, product.brand, variant.sku].filter(Boolean).join(' '),
      ),
      categoryId: product.categoryId,
      unit: units.get(product.unitId) ?? null,
      taxRate: product.taxRateId ? (taxes.get(product.taxRateId) ?? null) : null,
      price: { currency: price.currency, priceMinor: price.priceMinor, minPriceMinor: price.minPriceMinor },
    };
    items.push(item);
    byVariant.set(item.variantId, item);
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const byBarcode = new Map<string, BarcodeHit>();
  for (const barcode of sets.barcodes) {
    const item = byVariant.get(barcode.variantId);
    if (item) byBarcode.set(barcode.code, { item, barcode });
  }

  const categoryById = new Map(sets.categories.map((c) => [c.id, c]));
  const rootOf = new Map<string, string>();
  for (const category of sets.categories) {
    let root = category;
    const seen = new Set<string>();
    while (root.parentId && categoryById.has(root.parentId) && !seen.has(root.id)) {
      seen.add(root.id);
      root = categoryById.get(root.parentId)!;
    }
    rootOf.set(category.id, root.id);
  }
  const categories = sets.categories
    .filter((c) => c.parentId === null && !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ar'));

  const { rates, collectRates } = settings
    ? currentRates(sets.exchange_rates, settings.baseCurrency, now)
    : { rates: [], collectRates: {} };

  return {
    items,
    byVariant,
    byBarcode,
    categories,
    rootOf,
    settings,
    rates,
    collectRates,
    staff: { users: sets.users, roles: sets.roles, user_roles: sets.user_roles, branches: sets.branches },
  };
}

export async function loadCatalog(store: SyncStore, now?: number): Promise<Catalog> {
  return buildCatalog(await readCatalogSets(store), now);
}

/** A scanned or typed code as stored: Latin digits, no spaces. */
export function barcodeKey(code: string): string {
  return toLatinDigits(code).replace(/\s+/g, '');
}

export interface SearchOptions {
  categoryId?: string | null;
  limit?: number;
}

/**
 * Items for the grid: with no query, the chosen category's (or every) item by name; with a query,
 * the exact barcode first, then names holding every typed word, those starting with it first.
 */
export function searchCatalog(catalog: Catalog, query: string, options: SearchOptions = {}): CatalogItem[] {
  const limit = options.limit ?? 60;
  const q = normalizeArabic(query);
  if (!q) {
    const { categoryId } = options;
    const list = categoryId
      ? catalog.items.filter((item) => item.categoryId && catalog.rootOf.get(item.categoryId) === categoryId)
      : catalog.items;
    return list.slice(0, limit);
  }
  const exact = catalog.byBarcode.get(barcodeKey(query))?.item;
  const tokens = q.split(' ');
  const starts: CatalogItem[] = [];
  const words: CatalogItem[] = [];
  const others: CatalogItem[] = [];
  for (const item of catalog.items) {
    if (item === exact) continue;
    const key = item.searchKey;
    if (!tokens.every((token) => key.includes(token))) continue;
    if (key.startsWith(q)) starts.push(item);
    else if (key.includes(` ${tokens[0]}`)) words.push(item);
    else others.push(item);
    if (starts.length >= limit) break;
  }
  return [...(exact ? [exact] : []), ...starts, ...words, ...others].slice(0, limit);
}
