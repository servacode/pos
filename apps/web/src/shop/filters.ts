import type { ShopProductCard } from '@serva/core';
import { sizeRank } from '../pos/sale/models';

/**
 * The shop's filters and sort (26 › المتجر الإلكتروني): done on the page from what the shop sent
 * for each card, so a store that hides its prices sends nothing to filter or sort by price with, and
 * these functions simply find no price to use.
 */

export interface ShopFilters {
  /** option name → the values picked ( any of them matches ); a name without values filters nothing */
  options: Record<string, string[]>;
  /** Minor units; null: no bound. Used only when the cards carry prices */
  minPrice: number | null;
  maxPrice: number | null;
  inStockOnly: boolean;
}

export const NO_FILTERS: ShopFilters = { options: {}, minPrice: null, maxPrice: null, inStockOnly: false };

export type ShopSort = 'newest' | 'price-asc' | 'price-desc' | 'name';

/** How many filters are on, for the button's count */
export function filterCount(f: ShopFilters): number {
  return (
    Object.values(f.options).filter((v) => v.length > 0).length +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    (f.inStockOnly ? 1 : 0)
  );
}

export function applyFilters(products: readonly ShopProductCard[], f: ShopFilters): ShopProductCard[] {
  return products.filter((p) => {
    if (f.inStockOnly && !p.available) return false;
    for (const [name, picked] of Object.entries(f.options)) {
      if (picked.length === 0) continue;
      const option = p.options.find((o) => o.name === name);
      if (!option || !option.values.some((v) => picked.includes(v))) return false;
    }
    // A card with no price (the store keeps them to itself) is never cut by a price range
    if (p.priceMinor !== null) {
      if (f.minPrice !== null && (p.maxPriceMinor ?? p.priceMinor) < f.minPrice) return false;
      if (f.maxPrice !== null && p.priceMinor > f.maxPrice) return false;
    }
    return true;
  });
}

export function sortProducts(products: readonly ShopProductCard[], sort: ShopSort): ShopProductCard[] {
  const list = [...products];
  switch (sort) {
    case 'newest':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'price-asc':
      return list.sort((a, b) => (a.priceMinor ?? 0) - (b.priceMinor ?? 0));
    case 'price-desc':
      return list.sort((a, b) => (b.priceMinor ?? 0) - (a.priceMinor ?? 0));
    case 'name':
      return list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }
}

export type ValueGroup = 'letters' | 'numbers' | 'ages' | null;

const AGE = /(أشهر|شهر|سنوات|سنة|سنتان|حديث الولادة)/;

/** Which kind of size a value is: «M», «42», «6 سنوات»; null for anything else (a colour) */
export function valueGroup(value: string): ValueGroup {
  if (sizeRank(value) === null) return null;
  if (AGE.test(value)) return 'ages';
  // Numbers rank from 100 up; the letters («3XL» too) and «فري سايز» sit outside that
  const rank = sizeRank(value)!;
  return rank >= 100 && rank < 10_000 ? 'numbers' : 'letters';
}

export interface OptionChoice {
  name: string;
  /** In order: sizes by their natural order, groups letters, numbers, ages; others by how many pieces have them */
  values: { value: string; group: ValueGroup }[];
  /** True when the option is a size (every value is one) */
  isSize: boolean;
}

/**
 * The option names and their values across the cards (the filter's choices). Sizes come in their
 * natural order and groups (حروف، أرقام، أعمار); colours and the like by how many pieces have them.
 */
export function optionChoices(products: readonly ShopProductCard[]): OptionChoice[] {
  const counts = new Map<string, Map<string, number>>();
  for (const p of products) {
    for (const o of p.options) {
      let into = counts.get(o.name);
      if (!into) counts.set(o.name, (into = new Map()));
      for (const v of o.values) into.set(v, (into.get(v) ?? 0) + 1);
    }
  }
  const order: ValueGroup[] = ['letters', 'numbers', 'ages'];
  return [...counts].map(([name, map]) => {
    const values = [...map.keys()];
    const isSize = values.every((v) => sizeRank(v) !== null);
    if (!isSize) {
      const sorted = values.sort((a, b) => (map.get(b) ?? 0) - (map.get(a) ?? 0));
      return { name, isSize, values: sorted.map((value) => ({ value, group: null })) };
    }
    const sorted = values
      .map((value, index) => ({ value, group: valueGroup(value), rank: sizeRank(value)!, index }))
      .sort(
        (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.rank - b.rank || a.index - b.index,
      );
    return { name, isSize, values: sorted.map(({ value, group }) => ({ value, group })) };
  });
}

/** «1,500» (Arabic digits too) in the major unit to minor units; null when it is not a number */
export function priceToMinor(text: string, decimals: number): number | null {
  const clean = [...text.trim()]
    .map((ch) => {
      const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
      return arabic >= 0 ? String(arabic) : ch === '٫' ? '.' : ch;
    })
    .filter((ch) => ch !== ',' && ch !== ' ')
    .join('');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10 ** decimals) : null;
}
