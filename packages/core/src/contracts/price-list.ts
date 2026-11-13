import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { parseDecimal } from '../money';
import { normalizeArabic, stripBidiControls, toLatinDigits } from '../text';
import { uuidSchema } from './common';

/**
 * «تحديث الأسعار من ملف» (03 › الصيدلية: نشرة أسعار الوزارة): the store uploads the price list of its
 * warehouse or of the ministry, the browser reads the sheet, the owner maps three or four columns,
 * and the server matches each row to a piece, by barcode first and then by name.
 *
 *   POST /v1/prices/list/preview   catalog.manage   priceListPreviewInput → PriceListPreview
 *   POST /v1/prices/list/apply     catalog.manage   priceListApplyInput   → PriceListApplied
 *
 * A preview changes nothing. An apply sets the chosen prices the way a manual price edit does (the
 * tills pull them), and writes one audit row per piece (`price.changed`, the old and new price) and
 * one for the file (`prices.list_applied`).
 */

/** Rows in one request; a bigger file travels in several. */
export const PRICE_LIST_CHUNK_MAX = 5000;

/** One row of the file as the browser read it: the price already in the store currency's minor units. */
export const priceListRow = z.object({
  /** The row's line in the file, for «الصف ٤٢» */
  row: z.int().min(1).max(1_000_000),
  barcode: z.string().trim().max(64).nullable().default(null),
  name: z.string().trim().max(300).nullable().default(null),
  /** A second name column: the scientific name */
  generic: z.string().trim().max(300).nullable().default(null),
  priceMinor: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
});

export const priceListPreviewInput = z.object({
  rows: z.array(priceListRow).min(1).max(PRICE_LIST_CHUNK_MAX),
});
export type PriceListPreviewInput = z.input<typeof priceListPreviewInput>;

export const PRICE_LIST_STATUSES = [
  'change',
  'same',
  'unmatched',
  'ambiguous',
  'other_currency',
  'duplicate',
] as const;
export type PriceListStatus = (typeof PRICE_LIST_STATUSES)[number];

export interface PriceListItem {
  row: number;
  status: PriceListStatus;
  /** What the file said, to recognise an unmatched row */
  source: string;
  matchedBy: 'barcode' | 'name' | null;
  productId: string | null;
  variantId: string | null;
  /** The matched piece */
  name: string | null;
  currency: CurrencyCode | null;
  oldMinor: number | null;
  newMinor: number;
  /** Live sizes and colours of the matched model (1 = a model with one variant); null when unmatched */
  modelSize?: number | null;
}

export interface PriceListPreview {
  items: PriceListItem[];
}

export const priceListApplyInput = z.object({
  fileName: z.string().trim().max(200).nullable().default(null),
  changes: z
    .array(
      z.object({
        variantId: uuidSchema,
        newMinor: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
        /** «طبّق على كل قياسات وألوان هذا الموديل»: every live variant of the product gets the price */
        wholeModel: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(PRICE_LIST_CHUNK_MAX),
});
export type PriceListApplyInput = z.input<typeof priceListApplyInput>;

export interface PriceListApplied {
  /** Pieces whose price really changed */
  changed: number;
  /** Pieces left as they were: the price was already that, or the piece is gone or in another currency */
  skipped: number;
  items: {
    productId: string;
    variantId: string;
    name: string;
    currency: CurrencyCode;
    oldMinor: number;
    newMinor: number;
  }[];
}

// ─── Columns ─────────────────────────────────────────────────────────────────

export const PRICE_LIST_FIELDS = [
  {
    key: 'barcode',
    label: 'الباركود',
    required: false,
    aliases: [
      'باركود',
      'بار كود',
      'رمز',
      'كود',
      'رقم الصنف',
      'barcode',
      'bar code',
      'ean',
      'gtin',
      'upc',
      'code',
    ],
  },
  {
    key: 'name',
    label: 'اسم الصنف',
    required: false,
    aliases: [
      'الاسم',
      'اسم',
      'اسم المادة',
      'اسم الدواء',
      'الدواء',
      'المادة',
      'الصنف',
      'البيان',
      'الاسم التجاري',
      'اسم تجاري',
      'trade name',
      'name',
      'item',
      'product',
      'description',
      'drug',
    ],
  },
  {
    key: 'generic',
    label: 'الاسم العلمي',
    required: false,
    aliases: ['الاسم العلمي', 'اسم علمي', 'المادة الفعالة', 'scientific name', 'generic', 'generic name'],
  },
  {
    key: 'price',
    label: 'السعر الجديد',
    required: true,
    aliases: [
      'السعر',
      'سعر',
      'سعر الجمهور',
      'سعر المستهلك',
      'سعر البيع',
      'سعر المفرق',
      'سعر المبيع',
      'السعر الجديد',
      'price',
      'public price',
      'retail',
      'retail price',
      'sell price',
      'new price',
    ],
  },
] as const;
export type PriceListField = (typeof PRICE_LIST_FIELDS)[number]['key'];

function headerKey(header: string): string {
  return normalizeArabic(header)
    .replace(/[_\-./\\:()[\]{}*#%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «سعر الشراء» and «سعر الجملة» are not the price on the shelf */
const NOT_A_SALE_PRICE = /شراء|تكلف|كلف|جمله|جملة|cost|purchase|wholesale/;

/**
 * The field each column header most probably means (null: none): exact names first, so «الاسم العلمي»
 * is not taken for the name, then headers that contain an alias, longest alias first. A field is
 * guessed once; the first column wins.
 */
export function guessPriceListFields(headers: readonly string[]): (PriceListField | null)[] {
  const keyed = headers.map(headerKey);
  const guess: (PriceListField | null)[] = headers.map(() => null);
  const taken = new Set<PriceListField>();
  for (const [index, header] of keyed.entries()) {
    const field = PRICE_LIST_FIELDS.find(
      (f) =>
        !taken.has(f.key) &&
        header !== '' &&
        (headerKey(f.label) === header || f.aliases.some((a) => headerKey(a) === header)),
    );
    if (field) {
      guess[index] = field.key;
      taken.add(field.key);
    }
  }
  const aliases = PRICE_LIST_FIELDS.flatMap((f) =>
    f.aliases.map((a) => ({ key: f.key, alias: headerKey(a) })),
  )
    .filter((a) => a.alias.length >= 3)
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const [index, header] of keyed.entries()) {
    if (guess[index] !== null || header === '') continue;
    const hit = aliases.find(
      (a) =>
        !taken.has(a.key) &&
        header.includes(a.alias) &&
        !(a.key === 'price' && NOT_A_SALE_PRICE.test(header)),
    );
    if (hit) {
      guess[index] = hit.key;
      taken.add(hit.key);
    }
  }
  return guess;
}

/**
 * A price cell to minor units of a currency with `decimals` places: a number, or text such as
 * «١٢٬٥٠٠», «12,500 ل.س», «1.250,50». Null when it is not a positive amount.
 */
export function parsePriceCell(value: string | number | null, decimals: number): number | null {
  if (value === null || (typeof value === 'number' && value <= 0)) return null;
  const sign = stripBidiControls(String(value)).trim().charAt(0);
  if (sign === '-' || sign === '−') return null;
  const text = stripBidiControls(toLatinDigits(String(value)))
    .replace(/٫/g, '.')
    .replace(/[٬،]/g, ',')
    .replace(/[^0-9.,]/g, '');
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let plain: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // The separator that comes last is the decimal point
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    plain = text.split(group).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    plain = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replaceAll(',', '') : text.replace(',', '.');
  } else {
    plain = /^\d{1,3}(\.\d{3}){2,}$/.test(text) ? text.replaceAll('.', '') : text;
  }
  try {
    const minor = Number(parseDecimal(plain, decimals));
    return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

/** A barcode cell as text: a number from Excel («6.291003012345e12» never happens for integers), spaces dropped. */
export function barcodeCell(value: string | number | null): string | null {
  if (value === null) return null;
  const text = toLatinDigits(String(value)).replace(/\s+/g, '');
  return text === '' ? null : text;
}
