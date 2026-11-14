import { lineGross, QTY_SCALE } from './money';

/**
 * Packs («علبة 100», «كرتونة 10 علب = 1000»): a pack barcode of a variant stands for `qty` base
 * units. Receiving, returning and transferring can be typed in packs; everything stored stays in
 * base units (thousandths) and in a total cost, so no pack ever reaches the ledger.
 */
export interface PackOption {
  /** «علبة»; «كرتونة» */
  name: string;
  /** Base units in one pack, thousandths (100000 for a box of 100) */
  qty: number;
}

/** The named packs among a variant's barcodes: more than one base unit, one entry per quantity. */
export function packOptionsOf(
  barcodes: readonly { packQty: number; packName: string | null }[],
): PackOption[] {
  const byQty = new Map<number, PackOption>();
  for (const b of barcodes) {
    if (b.packQty > QTY_SCALE && !byQty.has(b.packQty)) {
      byQty.set(b.packQty, { name: b.packName?.trim() || 'عبوة', qty: b.packQty });
    }
  }
  return [...byQty.values()].sort((a, b) => a.qty - b.qty);
}

/**
 * `packs` (thousandths of a pack) times the pack's base quantity, in base thousandths. Null when
 * the result would need a fraction of a thousandth: 0.0005 of a box cannot be stored.
 */
export function packsToBase(packs: number, packQty: number): number | null {
  if (!Number.isSafeInteger(packs) || !Number.isSafeInteger(packQty) || packs < 0 || packQty <= 0) {
    return null;
  }
  const product = packs * packQty;
  if (!Number.isSafeInteger(product) || product % QTY_SCALE !== 0) return null;
  return product / QTY_SCALE;
}

export interface PackLine {
  /** Base units, thousandths */
  qty: number;
  /** The whole line's cost: unit cost of one pack times the packs, rounded once; null with no unit cost */
  costMinor: number | null;
}

/** A line typed as `packs` of `packQty` at `unitCostMinor` per pack: the base quantity and the total. */
export function packLine(packs: number, packQty: number, unitCostMinor: number | null): PackLine | null {
  const qty = packsToBase(packs, packQty);
  if (qty === null) return null;
  return { qty, costMinor: unitCostMinor === null ? null : lineGross(unitCostMinor, packs) };
}

/** How many packs a base quantity is, thousandths of a pack; null when it is not a whole number of thousandths. */
export function baseToPacks(qty: number, packQty: number): number | null {
  if (!Number.isSafeInteger(qty) || packQty <= 0) return null;
  const scaled = qty * QTY_SCALE;
  return Number.isSafeInteger(scaled) && scaled % packQty === 0 ? scaled / packQty : null;
}
