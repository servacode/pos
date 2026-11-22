import type { Catalog } from '../pos/catalog';

/** The biggest pack a variant is sold in (a carton of 12 pieces), as the product's barcodes name it */
export interface PackInfo {
  /** Base units in one pack, thousandths */
  packQty: number;
  /** «كرتونة» unless the product named it */
  name: string;
}

/** The pack of each variant that has one (more than one piece), from the catalog's barcodes */
export function packsOf(catalog: Pick<Catalog, 'byBarcode'>): Map<string, PackInfo> {
  const out = new Map<string, PackInfo>();
  for (const { item, barcode } of catalog.byBarcode.values()) {
    if (barcode.packQty <= 1000) continue;
    const have = out.get(item.variantId);
    if (have && have.packQty >= barcode.packQty) continue;
    const named = barcode.packName?.trim();
    out.set(item.variantId, {
      packQty: barcode.packQty,
      name: !named || named === 'عبوة' ? 'كرتونة' : named,
    });
  }
  return out;
}

const whole = (thousandths: number) => String(Math.round(thousandths / 1000));

/**
 * «5 كرتونة + 3 قطعة» for a quantity (thousandths of a piece) that reaches a whole pack; null when
 * the item has no pack or the quantity is under one pack (the pieces say it all).
 */
export function cartonText(qty: number, pack: PackInfo | undefined): string | null {
  if (!pack || qty < pack.packQty || qty % 1000 !== 0) return null;
  const packs = Math.floor(qty / pack.packQty);
  const rest = qty - packs * pack.packQty;
  return rest === 0 ? `${packs} ${pack.name}` : `${packs} ${pack.name} + ${whole(rest)} قطعة`;
}
