/**
 * The public catalogue of a shop is one query per link per half minute, shared by the visits in
 * between. When the owner saves anything the shop shows (settings, an offer, a product, a price),
 * the kept answers are dropped so the next visit reads the new state at once.
 */

export interface KeptCatalogue<T> {
  at: number;
  home: Promise<T>;
}

const MAX_KEPT = 200;
const kept = new Map<string, KeptCatalogue<never>>();

/** Milliseconds a catalogue is kept; the tests read what they just changed, so they skip the keep unless asked. */
export function catalogueKeepMs(): number {
  if (process.env['SHOP_CATALOGUE_KEEP_MS']) return Number(process.env['SHOP_CATALOGUE_KEEP_MS']);
  return process.env['VITEST'] ? 0 : 30_000;
}

export function keptCatalogue<T>(slug: string, now: number): Promise<T> | undefined {
  const hit = kept.get(slug);
  return hit && now - hit.at < catalogueKeepMs() ? (hit.home as unknown as Promise<T>) : undefined;
}

export function keepCatalogue<T>(slug: string, now: number, home: Promise<T>): void {
  if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value as string);
  const entry = { at: now, home } as unknown as KeptCatalogue<never>;
  kept.set(slug, entry);
  // Only an answer that came out is kept; a missing or switched-off shop asks again. Only this entry is dropped, never a newer one.
  home.catch(() => {
    if (kept.get(slug) === entry) kept.delete(slug);
  });
}

/** Every kept catalogue is dropped: the owner changed something the shop shows */
export function forgetShopCatalogues(): void {
  kept.clear();
}

/** Writes that change what the public shop shows (an owner's edit, not a till sale) */
const SHOP_VISIBLE_PREFIXES = [
  '/v1/promotions',
  '/v1/online-store',
  '/v1/products',
  '/v1/categories',
  '/v1/price',
  '/v1/prices',
  '/v1/import',
];

export function changesShopCatalogue(method: string, url: string, status: number): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || status >= 400) return false;
  const path = url.split('?')[0] ?? url;
  return SHOP_VISIBLE_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}-`),
  );
}
