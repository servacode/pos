import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import type { Permission } from '../permissions';
import type { ShiftMode } from './documents';
import {
  bpSchema,
  currencyCodeSchema,
  latinDigits,
  listPageQuery,
  nonNegativeMinorSchema,
  qtySchema,
  uuidSchema,
  versionSchema,
  type ListResponse,
} from './common';

/**
 * The catalog (09 › الأصناف; 17 › المنتجات; 12 › المنتجات وبطاقة المنتج; 15 › البحث في الأصناف).
 * Master data is edited only here, online, by the owner and managers; cashier devices receive it
 * through the pull sets at the bottom of this file and never write it (15 › قواعد التعارض).
 *
 * Model: a product has one or more variants (09: «كل منتج له متغير واحد على الأقل، والمنتج البسيط
 * له متغير واحد مخفي. البيع والمخزون يتعاملان دائماً مع المتغير»). A variant has one shelf price in
 * one currency (pounds, or dollars converted at the day's rate on the device), and barcodes; a
 * barcode can stand for a pack (a box of 12) with its own price. Stock is per branch and variant.
 *
 * Admin routes (17 › المنتجات, phase 1). Store token (`Authorization: Bearer`), tenant from the
 * token; errors in the one envelope (`validation_failed` with `fields`, `stale_version`,
 * `not_found`, `forbidden`):
 *
 *   GET    /v1/products                  owner, manager      productListQuery → ListResponse<ProductListItem>
 *   POST   /v1/products                  catalog.manage      createProductInput → ProductDetail (201)
 *   GET    /v1/products/{id}             owner, manager      → ProductDetail
 *   PATCH  /v1/products/{id}             catalog.manage      updateProductInput → ProductDetail
 *   POST   /v1/products/{id}/archive     catalog.manage      no body → ProductDetail (archivedAt set)
 *   POST   /v1/products/{id}/restore     catalog.manage      no body → ProductDetail (archivedAt null)
 *   GET    /v1/barcodes/{code}           owner, manager      → BarcodeLookupResponse (404 not_found)
 *   GET    /v1/categories                owner, manager      → { items: Category[] }
 *   POST   /v1/categories                catalog.manage      createCategoryInput → Category (201)
 *   PATCH  /v1/categories/{id}           catalog.manage      updateCategoryInput → Category
 *   GET    /v1/units                     owner, manager      → { items: Unit[] }
 *   POST   /v1/units                     catalog.manage      createUnitInput → Unit (201)
 *   PATCH  /v1/units/{id}                catalog.manage      updateUnitInput → Unit
 *   GET    /v1/tax-rates                 owner, manager      → { items: TaxRate[] }
 *   POST   /v1/tax-rates                 owner               createTaxRateInput → TaxRate (201)
 *   PATCH  /v1/tax-rates/{id}            owner               updateTaxRateInput → TaxRate
 *
 * Concurrent edits (17 › التعديل المتزامن): every update sends the `version` it was read at, in
 * the body as PATCH /v1/devices/{id} does; a different current version answers 409 `stale_version`,
 * and the screen reloads the record and shows what changed before saving again. The product's
 * version also moves when one of its variants, prices or barcodes changes.
 *
 * Every store gets two units («قطعة» without fractions, «كيلو» with them) and no tax rate on its
 * creation, so a product can be saved before the owner visits units or taxes.
 */

// ─── Shared fields ────────────────────────────────────────────────────────────

const nameSchema = (label: string, max = 120) =>
  z.string(`${label} مطلوب`).trim().min(1, `${label} مطلوب`).max(max, `${label} طويل جداً`);

/** An optional text of a create: empty or missing is null. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullable()
    .optional()
    .transform((v) => v || null);

/** The same in an update: missing stays missing (unchanged), empty or null clears it. */
const patchText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

/**
 * A barcode as scanned or typed: Arabic digits become Latin, spaces go. Printable ASCII only,
 * because scanners send nothing else; unique in the store (17: «الرمز فريد في المتجر»).
 */
export const barcodeCodeSchema = z
  .string('الباركود مطلوب')
  .transform((v) => latinDigits(v).replace(/\s+/g, ''))
  .pipe(
    z
      .string()
      .min(3, 'الباركود 3 خانات على الأقل')
      .max(48, 'الباركود طويل جداً')
      .regex(/^[\x21-\x7E]+$/, 'الباركود أرقام وحروف لاتينية فقط'),
  );

/** Prefix of the store's own barcodes (09 › tenant_settings: بادئة الباركود الداخلي 29). */
export const INTERNAL_BARCODE_PREFIX = '29';

/**
 * Barcode kinds: `standard` (printed by the maker), `internal` (made by the server: EAN-13 with
 * prefix 29, «ولّد باركوداً داخلياً»). Scale barcodes (prefix rules, weight or price) are phase 2.
 */
export const BARCODE_KINDS = ['standard', 'internal'] as const;
export type BarcodeKind = (typeof BARCODE_KINDS)[number];

/** A price as the owner enters it: an amount in pounds or in dollars (10 › التسعير بعملة والبيع بأخرى). */
export const priceInputSchema = z.object({
  currency: currencyCodeSchema,
  priceMinor: nonNegativeMinorSchema,
});
export type PriceInput = z.input<typeof priceInputSchema>;

const packFields = {
  /** Base units in the pack, thousandths: 1000 for one piece, 12000 for a box of 12 */
  packQty: qtySchema.default(1000),
  /** «كرتونة», «علبة»; null for the single unit */
  packName: optionalText(30, 'اسم العبوة طويل جداً'),
  /** The pack's own price in the variant's price currency; null = packQty × the unit price */
  packPriceMinor: nonNegativeMinorSchema.nullable().default(null),
};

/**
 * A barcode in a create or update. `id` keeps an existing one; a standard barcode brings its code;
 * an internal one without a code asks the server to make the next one.
 */
export const barcodeInputSchema = z.discriminatedUnion('kind', [
  z.object({
    id: uuidSchema.optional(),
    kind: z.literal('standard'),
    code: barcodeCodeSchema,
    ...packFields,
  }),
  z.object({
    id: uuidSchema.optional(),
    kind: z.literal('internal'),
    code: barcodeCodeSchema.optional(),
    ...packFields,
  }),
]);
export type BarcodeInput = z.input<typeof barcodeInputSchema>;

/** A variant's options (المقاس: M، اللون: أحمر), in display order; empty for a simple product. */
export const attributeValueSchema = z.object({
  name: nameSchema('اسم الخاصية', 30),
  value: nameSchema('قيمة الخاصية', 40),
});
export const attributesSchema = z.array(attributeValueSchema).max(3, 'ثلاث خصائص على الأكثر');

const variantFields = {
  /** Optional stock-keeping code */
  sku: optionalText(40, 'رمز الصنف طويل جداً'),
  attributes: attributesSchema.default([]),
  price: priceInputSchema,
  /** «السعر الأدنى للمفاصلة» in the price currency: the cashier goes down to it without a manager code */
  minPriceMinor: nonNegativeMinorSchema.nullable().default(null),
  /** «الحد الأدنى في الفرع», thousandths: below it the owner is alerted */
  minStockQty: z.int().nonnegative().nullable().default(null),
  barcodes: z.array(barcodeInputSchema).max(20, '20 باركوداً على الأكثر').default([]),
};

export const createVariantInput = z.object(variantFields);

/** Codes repeated inside one request; the server also refuses a code used by another product. */
function checkBarcodes(
  variants: { barcodes?: { code?: string | undefined }[] | undefined }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  variants.forEach((variant, v) =>
    variant.barcodes?.forEach((barcode, b) => {
      if (barcode.code === undefined) return;
      if (seen.has(barcode.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', v, 'barcodes', b, 'code'],
          message: 'الباركود مكرر في هذا المنتج',
        });
      }
      seen.add(barcode.code);
    }),
  );
}

/** Two variants of one product cannot have the same options, and more than one needs options. */
function checkVariantOptions(
  variants: { attributes?: { name: string; value: string }[] | undefined; archived?: boolean | undefined }[],
  ctx: z.RefinementCtx,
): void {
  const live = variants.filter((v) => !v.archived);
  if (live.length < 2) return;
  const seen = new Set<string>();
  variants.forEach((variant, v) => {
    if (variant.archived || variant.attributes === undefined) return;
    if (variant.attributes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['variants', v, 'attributes'], message: 'اختر المقاس أو اللون' });
      return;
    }
    const key = JSON.stringify(variant.attributes.map((a) => [a.name, a.value]));
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', path: ['variants', v, 'attributes'], message: 'هذا المتغير مكرر' });
    }
    seen.add(key);
  });
}

// ─── Products ─────────────────────────────────────────────────────────────────

/** 09 › products: النوع. Kits, meals and modifiers come with their phases. */
export const PRODUCT_TYPES = ['stock', 'service'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * active, or temporary: made by a cashier for an unknown barcode (TRI), waiting for review
 * (17 › GET /v1/products/temporary). Archived is separate (archivedAt), for the 30-day bin.
 */
export const PRODUCT_STATUSES = ['active', 'temporary'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const productFields = {
  nameAr: nameSchema('اسم المنتج'),
  nameEn: optionalText(120, 'الاسم الإنجليزي طويل جداً'),
  categoryId: uuidSchema.nullable().default(null),
  brand: optionalText(60, 'اسم الماركة طويل جداً'),
  type: z.enum(PRODUCT_TYPES).default('stock'),
  /** Omitted: the store's «قطعة» */
  unitId: uuidSchema.optional(),
  /** null: no tax on this product */
  taxRateId: uuidSchema.nullable().default(null),
  /** «يُباع على الكاشير»: false hides it from cashier devices (it stays in the pull, flagged) */
  sellOnPos: z.boolean().default(true),
};

/** POST /v1/products: the product with its variants, barcodes and prices in one request (17). */
export const createProductInput = z
  .object({
    ...productFields,
    variants: z
      .array(createVariantInput)
      .min(1, 'أضف سعراً واحداً على الأقل')
      .max(300, '300 متغيّر على الأكثر'),
  })
  .superRefine((product, ctx) => {
    checkBarcodes(product.variants, ctx);
    checkVariantOptions(product.variants, ctx);
  });
export type CreateProductInput = z.input<typeof createProductInput>;
export type CreateProductData = z.output<typeof createProductInput>;

/**
 * A variant in an update: with `id` it changes only the fields sent (`archived: true` archives it,
 * `false` restores it); without `id` it is a new variant and needs its price. `barcodes`, when
 * sent, is the variant's complete list: barcodes left out are removed (archived once used).
 */
export const updateVariantInput = z
  .object({
    id: uuidSchema.optional(),
    sku: patchText(40, 'رمز الصنف طويل جداً'),
    attributes: attributesSchema.optional(),
    price: priceInputSchema.optional(),
    minPriceMinor: nonNegativeMinorSchema.nullable().optional(),
    minStockQty: z.int().nonnegative().nullable().optional(),
    barcodes: z.array(barcodeInputSchema).max(20, '20 باركوداً على الأكثر').optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((variant, ctx) => {
    if (variant.id === undefined && variant.price === undefined) {
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'السعر مطلوب' });
    }
  });

/**
 * PATCH /v1/products/{id}: only the fields sent change. `variants` lists only the variants to change
 * or add; the in-place price edit of the list sends one `{ id, price }`.
 */
export const updateProductInput = z
  .object({
    version: versionSchema,
    nameAr: nameSchema('اسم المنتج').optional(),
    nameEn: patchText(120, 'الاسم الإنجليزي طويل جداً'),
    categoryId: uuidSchema.nullable().optional(),
    brand: patchText(60, 'اسم الماركة طويل جداً'),
    type: z.enum(PRODUCT_TYPES).optional(),
    unitId: uuidSchema.optional(),
    taxRateId: uuidSchema.nullable().optional(),
    sellOnPos: z.boolean().optional(),
    variants: z.array(updateVariantInput).max(300, '300 متغيّر على الأكثر').optional(),
  })
  .superRefine((product, ctx) => {
    if (product.variants) {
      checkBarcodes(product.variants, ctx);
      checkVariantOptions(product.variants, ctx);
    }
  });
export type UpdateProductInput = z.input<typeof updateProductInput>;
export type UpdateProductData = z.output<typeof updateProductInput>;

/**
 * GET /v1/products. `q` matches the name (normalized Arabic, 15 › البحث في الأصناف) or a barcode
 * exactly (Arabic digits accepted). Default: active products, all branches' stock summed.
 */
export const PRODUCT_LIST_STATUSES = ['active', 'archived', 'temporary'] as const;
export const productListQuery = z.object({
  q: z
    .string()
    .max(100)
    .optional()
    .transform((v) => (v ? latinDigits(v) || undefined : undefined)),
  categoryId: uuidSchema.optional(),
  status: z.enum(PRODUCT_LIST_STATUSES).default('active'),
  /** Stock of this branch only */
  branchId: uuidSchema.optional(),
  ...listPageQuery,
});
export type ProductListQuery = z.input<typeof productListQuery>;

export interface PriceView {
  currency: CurrencyCode;
  priceMinor: number;
}

export interface BarcodeView {
  id: string;
  code: string;
  kind: BarcodeKind;
  packQty: number;
  packName: string | null;
  packPriceMinor: number | null;
}

export interface VariantStock {
  branchId: string;
  branchName: string;
  /** Thousandths; negative when sold below zero (10 › المخزون السالب) */
  qty: number;
  /** Held for customer orders (phase 2); 0 until then */
  reservedQty: number;
}

export interface VariantDetail {
  id: string;
  sku: string | null;
  /** «أبيض · 1.7 لتر», made from the attribute values; null for a product's only, hidden variant */
  label: string | null;
  attributes: { name: string; value: string }[];
  price: PriceView;
  minPriceMinor: number | null;
  minStockQty: number | null;
  /** When the price last changed (for «تغيّر سعرها») */
  priceChangedAt: string;
  archivedAt: string | null;
  barcodes: BarcodeView[];
  /** One entry per active branch, the product card's «في كل الفروع» */
  stock: VariantStock[];
}

/** GET /v1/products/{id} and the answer of every product write. No cost: phase 2 adds it for cost.view. */
export interface ProductDetail {
  id: string;
  nameAr: string;
  nameEn: string | null;
  categoryId: string | null;
  brand: string | null;
  type: ProductType;
  status: ProductStatus;
  unitId: string;
  taxRateId: string | null;
  sellOnPos: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  variants: VariantDetail[];
}

/** A row of the products list. */
export interface ProductListItem {
  id: string;
  nameAr: string;
  nameEn: string | null;
  categoryId: string | null;
  categoryName: string | null;
  type: ProductType;
  status: ProductStatus;
  archivedAt: string | null;
  /** Live variants */
  variantCount: number;
  /** The variant the in-place price edit changes when there is only one; else null */
  singleVariantId: string | null;
  /** Lowest and highest shelf price over live variants (equal for one variant), in one currency; null when they differ in currency */
  price: { currency: CurrencyCode; minMinor: number; maxMinor: number } | null;
  /** First barcode of the first variant, for the list */
  barcode: string | null;
  /** Sum over live variants (and branches, unless branchId was given), thousandths */
  stockQty: number;
  version: number;
}

export type ProductListResponse = ListResponse<ProductListItem>;

/** GET /v1/barcodes/{code}: the product behind a code (the cashier searches on its own device). */
export interface BarcodeLookupResponse {
  productId: string;
  variantId: string;
  barcode: BarcodeView;
}

// ─── Categories, units, tax rates ─────────────────────────────────────────────

/** 09 › categories: a tree (parentId), ordered by sortOrder then name. Archived ones keep their products. */
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  /** Live products directly in it */
  productCount: number;
  archivedAt: string | null;
  version: number;
}

export const createCategoryInput = z.object({
  name: nameSchema('اسم التصنيف', 60),
  parentId: uuidSchema.nullable().default(null),
  sortOrder: z.int().min(0).max(100_000).default(0),
});
export type CreateCategoryInput = z.input<typeof createCategoryInput>;

/** A parent that is the category itself or one of its children answers validation_failed on parentId. */
export const updateCategoryInput = z.object({
  version: versionSchema,
  name: nameSchema('اسم التصنيف', 60).optional(),
  parentId: uuidSchema.nullable().optional(),
  sortOrder: z.int().min(0).max(100_000).optional(),
  archived: z.boolean().optional(),
});
export type UpdateCategoryInput = z.input<typeof updateCategoryInput>;

/** 09 › units: «قطعة», «كيلو», «متر»; allowsFraction lets the cashier sell 0.250 of it (weights). */
export interface Unit {
  id: string;
  name: string;
  /** Printed after a weighed quantity: «كغ» */
  symbol: string;
  allowsFraction: boolean;
  /** Made with the store; can be renamed, not archived */
  isSystem: boolean;
  archivedAt: string | null;
  version: number;
}

export const createUnitInput = z.object({
  name: nameSchema('اسم الوحدة', 20),
  symbol: nameSchema('رمز الوحدة', 10),
  allowsFraction: z.boolean().default(false),
});
export type CreateUnitInput = z.input<typeof createUnitInput>;

export const updateUnitInput = z.object({
  version: versionSchema,
  name: nameSchema('اسم الوحدة', 20).optional(),
  symbol: nameSchema('رمز الوحدة', 10).optional(),
  allowsFraction: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type UpdateUnitInput = z.input<typeof updateUnitInput>;

/**
 * 09 › tax_rates (10 › نموذج الضرائب السوري): the kind picks the account a sale's tax is posted to
 * (consumption 2210, stamp 2220, sales 2200).
 */
export const TAX_KINDS = ['consumption', 'stamp', 'sales'] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export interface TaxRate {
  id: string;
  name: string;
  rateBp: number;
  kind: TaxKind;
  showOnReceipt: boolean;
  archivedAt: string | null;
  version: number;
}

export const createTaxRateInput = z.object({
  name: nameSchema('اسم الضريبة', 60),
  rateBp: bpSchema,
  kind: z.enum(TAX_KINDS),
  showOnReceipt: z.boolean().default(true),
});
export type CreateTaxRateInput = z.input<typeof createTaxRateInput>;

/** A rate already used by a sale is never edited in place: change the product to a new rate. */
export const updateTaxRateInput = z.object({
  version: versionSchema,
  name: nameSchema('اسم الضريبة', 60).optional(),
  showOnReceipt: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type UpdateTaxRateInput = z.input<typeof updateTaxRateInput>;

// ─── Pull sets: the rows a cashier device stores ──────────────────────────────

/**
 * What a cashier device pulls (17 › السحب; 15 › ما يُحفظ على الجهاز), one interface per set: each is
 * the `data` of a Dexie `records` row (packages/sync › dexie) and the `upserts` of a pull page.
 * Every row has `id` and `version`; a removal arrives in `deletes`. Archived rows stay in their set
 * with `archived: true` (sales of yesterday still name them); the device hides them from sale.
 * No set carries cost, purchase price or margin (17 › الكلفة لا تصل جهاز الكاشير أبداً).
 */
export const CATALOG_PULL_SETS = [
  'products',
  'variants',
  'prices',
  'barcodes',
  'categories',
  'units',
  'tax_rates',
  'stock_levels',
  'exchange_rates',
] as const;
export type CatalogPullSet = (typeof CATALOG_PULL_SETS)[number];

/** `products` */
export interface ProductRow {
  id: string;
  nameAr: string;
  nameEn: string | null;
  categoryId: string | null;
  brand: string | null;
  type: ProductType;
  status: ProductStatus;
  unitId: string;
  taxRateId: string | null;
  sellOnPos: boolean;
  archived: boolean;
  version: number;
}

/**
 * `variants`: kept apart from products, as in 09, because sales, stock and barcodes point at the
 * variant, and a clothing store has 300,000 of them under far fewer products (15 › الحجم).
 */
export interface VariantRow {
  id: string;
  productId: string;
  sku: string | null;
  label: string | null;
  attributes: { name: string; value: string }[];
  /** Display order inside the product (the matrix) */
  sortOrder: number;
  archived: boolean;
  version: number;
}

/**
 * `prices`: one row per variant, `id` = the variant's id (09 › variants: سعر البيع وعملته، أدنى
 * سعر بيع). A set of its own so a price change, the busiest edit, moves only this small row, and
 * a price checker can pull prices without the rest (17). A dollar price stays in dollars: the
 * device converts it at the current exchange rate, so a new rate is one row, not 50,000 (15).
 */
export interface PriceRow {
  id: string;
  variantId: string;
  currency: CurrencyCode;
  priceMinor: number;
  /** «السعر الأدنى للمفاصلة» in the same currency; below it a price edit needs the manager */
  minPriceMinor: number | null;
  priceChangedAt: string;
  version: number;
}

/**
 * `barcodes`: exact match first, always (15 › الباركود مسار منفصل وأول). A pack barcode sells one
 * pack (packQty base units) at packPriceMinor, or packQty × the unit price when that is null.
 */
export interface BarcodeRow {
  id: string;
  variantId: string;
  code: string;
  kind: BarcodeKind;
  packQty: number;
  packName: string | null;
  /** In the variant's price currency */
  packPriceMinor: number | null;
  version: number;
}

/** `categories`: the sale screen's chips, in sortOrder. */
export interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  archived: boolean;
  version: number;
}

/** `units`: whether a quantity may have fractions (weights) and what to print after it. */
export interface UnitRow {
  id: string;
  name: string;
  symbol: string;
  allowsFraction: boolean;
  version: number;
}

/** `tax_rates`: the rate a sale line snapshots with its id. */
export interface TaxRateRow {
  id: string;
  name: string;
  rateBp: number;
  kind: TaxKind;
  showOnReceipt: boolean;
  archived: boolean;
  version: number;
}

/**
 * `stock_levels`: the device's own branch only (17). Phase 1 has one warehouse per branch, so a
 * level is per branch and variant; phase 2 adds warehouseId. The device shows qty minus what it
 * sold itself since the row's version (its unsent sales), and never blocks a sale on it unless the
 * store forbids negative stock (15 › الفحوص دون اتصال).
 */
export interface StockLevelRow {
  id: string;
  branchId: string;
  variantId: string;
  /** Thousandths of the base unit; may be negative */
  qty: number;
  reservedQty: number;
  version: number;
}

/**
 * `exchange_rates`: every rate the store set (09 › exchange_rates), newest effectiveAt wins for the
 * «current rate» (by corrected time, 15 › قواعد التعارض). One `unit` is worth `rate` of `quote`
 * (pounds per dollar). collectRate is the optional rate dollars are taken at in payment
 * (10 › سعر قبض الدولار); minRate/maxRate guard a rate typed on the device.
 */
export interface ExchangeRateRow {
  id: string;
  unit: CurrencyCode;
  quote: CurrencyCode;
  rate: string;
  collectRate: string | null;
  minRate: string | null;
  maxRate: string | null;
  effectiveAt: string;
  version: number;
}

/**
 * The sets that already exist (apps/api › sync-pull.ts PULL_SETS), with the fields phase 1 adds.
 * `settings` has one row, id = tenant id.
 */
export interface SettingsRow {
  id: string;
  baseCurrency: CurrencyCode;
  enabledCurrencies: CurrencyCode[];
  taxInclusive: boolean;
  defaultTaxRateBp: number;
  /** Cash step per currency, minor units; 0 = no rounding (10, step 6) */
  cashRoundingSteps: Partial<Record<CurrencyCode, number>>;
  numberFormat: 'latn' | 'arab';
  receiptFooter: string | null;
  /** Added in phase 1: printed on the receipt header (21 › إيصال 80 مم) */
  storeName: string;
  /** Added in phase 1: tenants.tax_number, printed when present */
  taxNumber: string | null;
  /** Added in phase 1: tenants.timezone, for businessDateOf() */
  timezone: string;
  /** Added in phase 1: «نهاية يوم العمل», "HH:MM" ("00:00" by default) */
  businessDayCutoff: string;
  /** Added in phase 1: «وضع الوردية», per_cashier by default */
  shiftMode: ShiftMode;
  version: number;
}

/**
 * `users`: the branch's staff for the sign-in screen (17 › السحب: موظفو الفرع). No PIN hash ever
 * reaches a device (16 › تخمين رمز PIN): see docs/contracts/step4.md, question Q1. pinLength says
 * which keypad to show (4 for cashiers, 6 for anyone who approves); null = no PIN, cannot sign in
 * on a device. pinVersion moves when the PIN changes, so a device forgets what it learnt.
 */
export interface UserRow {
  id: string;
  fullName: string;
  status: 'active' | 'disabled';
  /** Added in phase 1 */
  pinLength: 4 | 6 | null;
  /** Added in phase 1 */
  pinVersion: number;
  version: number;
}

/** `roles` (existing): the discount limit the cart checks before asking for the manager. */
export interface RoleRow {
  id: string;
  /** owner, manager, cashier for the built-in roles (permissions.ts SystemRoleKey), or the owner's own */
  key: string;
  name: string;
  permissions: Permission[];
  maxDiscountBp: number;
  version: number;
}

/** `user_roles` (existing): branchId null = every branch. */
export interface UserRoleRow {
  id: string;
  userId: string;
  roleId: string;
  branchId: string | null;
  version: number;
}

/** `branches` (existing). */
export interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  version: number;
}

/** Row type of every set a cashier device pulls in phase 1. */
export interface PullSetRows {
  products: ProductRow;
  variants: VariantRow;
  prices: PriceRow;
  barcodes: BarcodeRow;
  categories: CategoryRow;
  units: UnitRow;
  tax_rates: TaxRateRow;
  stock_levels: StockLevelRow;
  exchange_rates: ExchangeRateRow;
  settings: SettingsRow;
  users: UserRow;
  roles: RoleRow;
  user_roles: UserRoleRow;
  branches: BranchRow;
}
