import { z } from 'zod';

/**
 * Scale barcodes (03 › المولات والسوبرماركت: باركود الميزان): the label a shop scale prints is an
 * EAN-13 that carries the item and its weight or its price:
 *
 *   PP IIIII VVVVV C      PP prefix (20–28; 29 is the store's own internal codes)
 *                         IIIII the item's number on the scale («رقم الصنف على الميزان»), 4–6 digits
 *                         VVVVV the weight or the price, the rest of the 10 digits
 *                         C the EAN-13 check digit
 *
 * The item number is matched against the store's barcodes exactly, so the owner gives the product
 * a barcode equal to its scale number (e.g. «00123»). Exact barcodes are always tried first: a
 * code that is a product's own barcode is never read as a scale label.
 */

export const SCALE_VALUE_KINDS = ['weight', 'price'] as const;
export type ScaleValueKind = (typeof SCALE_VALUE_KINDS)[number];

export const scaleBarcodeSchema = z
  .object({
    /** Two-digit prefixes the scale prints, 20–28 */
    prefixes: z
      .array(z.string().regex(/^2[0-8]$/, 'البادئة من 20 إلى 28'))
      .min(1, 'اختر بادئة واحدة على الأقل')
      .max(9),
    /** Digits of the item number after the prefix */
    itemDigits: z.int().min(4, 'رقم الصنف 4 خانات على الأقل').max(6, 'رقم الصنف 6 خانات على الأكثر'),
    valueKind: z.enum(SCALE_VALUE_KINDS),
    /**
     * Decimals of the value as printed: a weight of 3 decimals is in grams (01250 = 1.250 kg); a
     * price of 0 decimals is in whole pounds (12500 = 12,500 SYP).
     */
    valueDecimals: z.int().min(0).max(3),
  })
  .refine((v) => v.valueKind === 'weight' || v.valueDecimals <= 2, {
    path: ['valueDecimals'],
    message: 'السعر خانتان عشريتان على الأكثر',
  });
export type ScaleBarcodeConfig = z.output<typeof scaleBarcodeSchema>;

/** The common setting of shop scales in Syria: prefix 20–28, five-digit item, weight in grams. */
export const DEFAULT_SCALE_BARCODE: ScaleBarcodeConfig = {
  prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28'],
  itemDigits: 5,
  valueKind: 'weight',
  valueDecimals: 3,
};

/** The EAN-13 check digit of the first twelve digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('twelve digits expected');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export type ScaleReading =
  /** qty in thousandths of the unit (1.250 kg = 1250) */
  | { itemCode: string; kind: 'weight'; qty: number }
  /** the label's price in minor units of the store's base currency */
  | { itemCode: string; kind: 'price'; priceMinor: number };

/**
 * Reads a scale label, or answers null when the code is not one: not 13 digits, a prefix the
 * store does not use, a wrong check digit, or a value of zero.
 */
export function parseScaleBarcode(code: string, config: ScaleBarcodeConfig): ScaleReading | null {
  if (!/^\d{13}$/.test(code)) return null;
  if (!config.prefixes.includes(code.slice(0, 2))) return null;
  if (ean13CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null;
  const itemCode = code.slice(2, 2 + config.itemDigits);
  const value = Number(code.slice(2 + config.itemDigits, 12));
  if (value <= 0) return null;
  if (config.valueKind === 'weight') {
    return { itemCode, kind: 'weight', qty: value * 10 ** (3 - config.valueDecimals) };
  }
  return { itemCode, kind: 'price', priceMinor: value * 10 ** (2 - config.valueDecimals) };
}

/**
 * The quantity a price label stands for: price ÷ the unit price, in thousandths, half up. The line
 * then costs lineGross(unitPrice, qty), which may differ from the label by less than one
 * thousandth of the unit price.
 */
export function qtyForPrice(priceMinor: number, unitPriceMinor: number): number {
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) throw new RangeError('priceMinor > 0 expected');
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor <= 0) {
    throw new RangeError('the item needs a price to read a price label');
  }
  return Math.max(1, Math.round((priceMinor * 1000) / unitPriceMinor));
}
