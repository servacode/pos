import type { QuotationLine, QuotationLineInput } from '@serva/core';

/** One line of the editor, with its numbers as the person typed them */
export interface EditorLine {
  key: number;
  productId: string | null;
  variantId: string | null;
  name: string;
  unitName: string | null;
  packName: string | null;
  /** Base units in one pack, thousandths (1000 = a piece) */
  packQty: number;
  /** The named packs the item has, for the pick next to the quantity */
  packs?: { name: string; qty: number }[];
  /** The price of one piece, in minor units, for working out a pack's price when none is set */
  pieceMinor: number | null;
  /** The price of each named pack, when one is set */
  packPrices?: Record<number, number>;
  qty: string;
  price: string;
  /** Percent, as typed («10» or «7.5») */
  discount: string;
  /** A fixed amount the till took off this line: kept as it was while no percent is typed */
  amountDiscountMinor?: number;
  taxRateId: string | null;
  taxRateBp: number;
}

/** «12.5» to thousandths; null while unusable */
export function qtyOf(text: string): number | null {
  const clean = toLatin(text);
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(clean)) return null;
  const qty = Math.round(Number(clean) * 1000);
  return qty > 0 ? qty : null;
}

/** «1,250.50» to minor units (two decimals); null while unusable */
export function moneyOf(text: string): number | null {
  const clean = toLatin(text).replace(/[,\s]/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** «10» or «7.5» percent to basis points; null while unusable or above 100 */
export function percentOf(text: string): number | null {
  const clean = toLatin(text);
  if (clean === '') return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return bp <= 10_000 ? bp : null;
}

function toLatin(text: string): string {
  return text
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
}

/** 125000 minor units as the text a price field shows: «1250» or «1250.5» */
export const moneyText = (minor: number): string => String(minor / 100);

/** The price of one pack of the line: the pack's own price, else the piece price times the pack's size */
export function packPriceOf(
  line: Pick<EditorLine, 'pieceMinor' | 'packPrices'>,
  packQty: number,
): number | null {
  const own = line.packPrices?.[packQty];
  if (own !== undefined) return own;
  return line.pieceMinor === null ? null : Math.round((line.pieceMinor * packQty) / 1000);
}

/** What the server takes for a line, or the name of the field that is wrong */
export function lineInput(l: EditorLine): QuotationLineInput | { error: 'qty' | 'price' | 'discount' } {
  const qty = qtyOf(l.qty);
  if (qty === null) return { error: 'qty' };
  const price = moneyOf(l.price);
  if (price === null) return { error: 'price' };
  const bp = percentOf(l.discount);
  if (bp === null) return { error: 'discount' };
  return {
    productId: l.productId,
    variantId: l.variantId,
    name: l.name,
    unitName: l.unitName,
    packName: l.packName,
    packQty: l.packQty,
    qty,
    unitPriceMinor: price,
    discount:
      bp > 0
        ? { type: 'percent', bp }
        : l.amountDiscountMinor
          ? { type: 'amount', minor: l.amountDiscountMinor }
          : null,
    taxRateId: l.taxRateId,
    taxRateBp: l.taxRateBp,
  };
}

let counter = 0;
export const nextKey = (): number => ++counter;

/** A saved line back in the editor */
export function editorLineOf(l: QuotationLine): EditorLine {
  return {
    key: nextKey(),
    productId: l.productId ?? null,
    variantId: l.variantId ?? null,
    name: l.name,
    unitName: l.unitName ?? null,
    packName: l.packName ?? null,
    packQty: l.packQty,
    pieceMinor: null,
    qty: String(l.qty / 1000),
    price: moneyText(l.unitPriceMinor),
    discount: l.discount?.type === 'percent' ? String(l.discount.bp / 100) : '',
    ...(l.discount?.type === 'amount' ? { amountDiscountMinor: l.discount.minor } : {}),
    taxRateId: l.taxRateId ?? null,
    taxRateBp: l.taxRateBp,
  };
}
