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

type ScaleShape = {
  itemDigits: number;
  valueDigits?: number | undefined;
  checkDigit?: boolean | undefined;
};

/** Whether the label ends with a check digit (the default) */
export const scaleHasCheck = (c: Pick<ScaleShape, 'checkDigit'>): boolean => c.checkDigit !== false;

/** Digits of the weight or price: as set, or what is left of a 13-digit label */
export function scaleValueDigits(c: ScaleShape): number {
  return c.valueDigits ?? 13 - 2 - c.itemDigits - (scaleHasCheck(c) ? 1 : 0);
}

/** The length of a whole label: prefix (2) + item + value + the check digit if any */
export function scaleLabelLength(c: ScaleShape): number {
  return 2 + c.itemDigits + scaleValueDigits(c) + (scaleHasCheck(c) ? 1 : 0);
}

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
    /**
     * Digits of the weight or the price. Left out: whatever is left of a 13-digit label after the prefix,
     * the item and the check digit (5 for the default 5-digit item with a check digit).
     */
    valueDigits: z.int().min(2, 'قيمة الوزن أو السعر خانتان على الأقل').max(8).optional(),
    /** Whether the last digit is the EAN check digit; left out: yes */
    checkDigit: z.boolean().optional(),
  })
  .refine((v) => v.valueKind === 'weight' || v.valueDecimals <= 2, {
    path: ['valueDecimals'],
    message: 'السعر خانتان عشريتان على الأكثر',
  })
  .refine((v) => v.valueDecimals <= scaleValueDigits(v), {
    path: ['valueDecimals'],
    message: 'الكسور أكثر من خانات القيمة',
  })
  .refine((v) => scaleLabelLength(v) >= 8 && scaleLabelLength(v) <= 18, {
    path: ['valueDigits'],
    message: 'طول الملصق من 8 إلى 18 خانة',
  });
export type ScaleBarcodeConfig = z.output<typeof scaleBarcodeSchema>;

/** The common setting of shop scales in Syria: prefix 20–28, five-digit item, weight in grams. */
export const DEFAULT_SCALE_BARCODE: ScaleBarcodeConfig = {
  prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28'],
  itemDigits: 5,
  valueKind: 'weight',
  valueDecimals: 3,
};

/** Exactly `length` ASCII digits, checked character by character. */
function digitsOf(text: string, length: number): boolean {
  if (text.length !== length) return false;
  for (const ch of text) if (ch < '0' || ch > '9') return false;
  return true;
}

/**
 * The EAN check digit of the digits before it: from the right, weights 3, 1, 3, 1… (twelve digits give
 * the EAN-13 check digit; a shorter or longer label uses the same rule).
 */
export function eanCheckDigit(data: string): number {
  if (data.length < 4 || !digitsOf(data, data.length)) throw new RangeError('digits expected');
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += Number(data[i]) * ((data.length - 1 - i) % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** The EAN-13 check digit of the first twelve digits. */
export function ean13CheckDigit(first12: string): number {
  if (!digitsOf(first12, 12)) throw new RangeError('twelve digits expected');
  return eanCheckDigit(first12);
}

export type ScaleReading =
  /** qty in thousandths of the unit (1.250 kg = 1250) */
  | { itemCode: string; kind: 'weight'; qty: number }
  /** the label's price in minor units of the store's base currency */
  | { itemCode: string; kind: 'price'; priceMinor: number };

/** Why a code is not a scale label of the store's format, in words for the live test box */
export type ScaleMiss = 'length' | 'letters' | 'prefix' | 'check' | 'zero';

/** A code's parts as the format cuts them, with what it reads, or why it is not a label */
export type ScaleDiagnosis =
  | {
      ok: true;
      prefix: string;
      itemCode: string;
      valueText: string;
      check: string | null;
      reading: ScaleReading;
    }
  | { ok: false; miss: ScaleMiss; expectedLength: number };

export function diagnoseScaleBarcode(code: string, config: ScaleBarcodeConfig): ScaleDiagnosis {
  const expectedLength = scaleLabelLength(config);
  if (code.length !== expectedLength) return { ok: false, miss: 'length', expectedLength };
  if (!digitsOf(code, expectedLength)) return { ok: false, miss: 'letters', expectedLength };
  const prefix = code.slice(0, 2);
  if (!config.prefixes.includes(prefix)) return { ok: false, miss: 'prefix', expectedLength };
  const hasCheck = scaleHasCheck(config);
  const dataEnd = hasCheck ? expectedLength - 1 : expectedLength;
  if (hasCheck && eanCheckDigit(code.slice(0, dataEnd)) !== Number(code[dataEnd])) {
    return { ok: false, miss: 'check', expectedLength };
  }
  const itemEnd = 2 + config.itemDigits;
  const itemCode = code.slice(2, itemEnd);
  const valueText = code.slice(itemEnd, dataEnd);
  const value = Number(valueText);
  if (value <= 0) return { ok: false, miss: 'zero', expectedLength };
  const reading: ScaleReading =
    config.valueKind === 'weight'
      ? { itemCode, kind: 'weight', qty: value * 10 ** (3 - config.valueDecimals) }
      : { itemCode, kind: 'price', priceMinor: value * 10 ** (2 - config.valueDecimals) };
  return { ok: true, prefix, itemCode, valueText, check: hasCheck ? code[dataEnd]! : null, reading };
}

/**
 * Reads a scale label, or answers null when the code is not one: not the format's length, a prefix the
 * store does not use, a wrong check digit, or a value of zero.
 */
export function parseScaleBarcode(code: string, config: ScaleBarcodeConfig): ScaleReading | null {
  const found = diagnoseScaleBarcode(code, config);
  return found.ok ? found.reading : null;
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
