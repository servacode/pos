import type { CurrencyCode } from '@serva/core';
import type { ProductRow, UnitRow } from '@serva/core/contracts/catalog';
import type { SyncStore } from '@serva/sync/client';
import type { LocalStore } from '../../offline/local';
import type { CatalogSets } from '../catalog';

/**
 * A product made at the till without a connection (round 38): «أضف صنف جديد» queues a `temp_item` document and keeps
 * the product here, on the device, under the same ids the server will write it under. The catalog shows it at once
 * (so the cashier sells it, and the sale line already points at the real product); when the server's own rows arrive
 * with the next pull, or the server holds the document back, the local copy goes. Never sent anywhere: the document is what is sent.
 */
export const LOCAL_PRODUCTS_KEY = 'till:new-products';

export interface LocalProduct {
  productId: string;
  variantId: string;
  nameAr: string;
  priceMinor: number;
  currency: CurrencyCode;
  categoryId: string | null;
  barcode: string;
  /** The queued document: if the server refuses it the local copy is dropped */
  docId: string;
}

export async function readLocalProducts(local: LocalStore): Promise<LocalProduct[]> {
  return (await local.get<LocalProduct[]>(LOCAL_PRODUCTS_KEY)) ?? [];
}

export async function rememberLocalProduct(local: LocalStore, item: LocalProduct): Promise<void> {
  const held = await readLocalProducts(local);
  await local.set(LOCAL_PRODUCTS_KEY, [...held.filter((p) => p.productId !== item.productId), item]);
}

export async function forgetLocalProduct(local: LocalStore, productId: string): Promise<void> {
  const held = await readLocalProducts(local);
  const rest = held.filter((p) => p.productId !== productId);
  if (rest.length === 0) await local.remove(LOCAL_PRODUCTS_KEY);
  else await local.set(LOCAL_PRODUCTS_KEY, rest);
}

/** The «قطعة» unit of the store (the server gives a new product that one), else the first whole-number unit */
function pieceUnit(units: readonly UnitRow[]): string {
  const piece =
    units.find((u) => u.name === 'قطعة' || u.symbol === 'قطعة') ??
    units.find((u) => !u.allowsFraction) ??
    units[0];
  return piece?.id ?? '';
}

/**
 * The pulled sets with the products this device made and the server has not sent back yet. A product the pull already
 * holds under its id is the server's: it wins, and the local copy is forgotten. So is one whose document was refused.
 */
export async function withPendingProducts(
  local: LocalStore,
  store: SyncStore,
  sets: CatalogSets,
): Promise<CatalogSets> {
  const held = await readLocalProducts(local);
  if (held.length === 0) return sets;
  const known = new Set(sets.products.map((p) => p.id));
  // A document the server held back (refused) will make no product: its local copy goes
  const refused = await store.heldIds();
  const pending: LocalProduct[] = [];
  for (const item of held) {
    if (known.has(item.productId) || refused.has(item.docId)) await forgetLocalProduct(local, item.productId);
    else pending.push(item);
  }
  if (pending.length === 0) return sets;
  const unitId = pieceUnit(sets.units);
  const products: ProductRow[] = pending.map((p) => ({
    id: p.productId,
    nameAr: p.nameAr,
    nameEn: null,
    categoryId: p.categoryId,
    brand: null,
    genericName: null,
    tracksSerial: false,
    warrantyMonths: null,
    type: 'stock',
    // «بانتظار المراجعة»: as the server makes it
    status: 'temporary',
    unitId,
    taxRateId: null,
    sellOnPos: true,
    modifiers: [],
    archived: false,
    version: 0,
  }));
  return {
    ...sets,
    products: [...sets.products, ...products],
    variants: [
      ...sets.variants,
      ...pending.map((p) => ({
        id: p.variantId,
        productId: p.productId,
        sku: null,
        label: null,
        attributes: [],
        sortOrder: 0,
        nearestExpiry: null,
        imageUrl: null,
        archived: false,
        version: 0,
      })),
    ],
    prices: [
      ...sets.prices,
      ...pending.map((p) => ({
        id: p.variantId,
        variantId: p.variantId,
        currency: p.currency,
        priceMinor: p.priceMinor,
        minPriceMinor: null,
        wholesalePriceMinor: null,
        priceChangedAt: new Date(0).toISOString(),
        version: 0,
      })),
    ],
    barcodes: [
      ...sets.barcodes,
      ...pending.map((p) => ({
        id: p.variantId,
        variantId: p.variantId,
        code: p.barcode,
        kind: 'standard' as const,
        packQty: 1,
        packName: null,
        packPriceMinor: null,
        version: 0,
      })),
    ],
  };
}
