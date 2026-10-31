import {
  createProductInput,
  parseDecimal,
  updateProductInput,
  type BarcodeInput,
  type BarcodeKind,
  type CreateProductInput,
  type CurrencyCode,
  type ProductDetail,
  type ProductType,
  type UpdateProductInput,
  type VariantDetail,
} from '@serva/core';

/**
 * The product card's form (12 › بطاقة المنتج; packages/core › contracts/catalog.ts) as plain data and
 * pure functions: the draft the screen edits, the create and PATCH bodies built from it, the size ×
 * colour matrix built on the client (contract Q8), and server errors mapped back to the fields.
 *
 * Field error keys: top-level fields by name (`nameAr`, `categoryId`…), a variant's field as
 * `v.<variantKey>.<field>`, a barcode's as `b.<barcodeKey>.<field>`. Keys are the draft's own, so an
 * error stays on its row whatever the order of the request.
 */

export interface BarcodeDraft {
  key: string;
  id?: string;
  kind: BarcodeKind;
  /** Empty for a new internal barcode: the server makes it on save (prefix 29). */
  code: string;
  /** Pieces in the pack, as typed ("1", "12"); stored as thousandths. */
  packCount: string;
  packName: string;
  /** The pack's own price; null = pieces × the unit price. */
  packPriceMinor: number | null;
}

export interface VariantDraft {
  key: string;
  id?: string;
  sku: string;
  attributes: { name: string; value: string }[];
  currency: CurrencyCode;
  priceMinor: number | null;
  minPriceMinor: number | null;
  /** «الحد الأدنى في الفرع» as typed, in the product's unit ("5", "2.5"); "" = none. */
  minStock: string;
  barcodes: BarcodeDraft[];
  archived: boolean;
}

/** One option axis of the matrix: «المقاس» with S, M, L. */
export interface Axis {
  key: string;
  name: string;
  values: string[];
}

export interface ProductDraft {
  nameAr: string;
  nameEn: string;
  brand: string;
  /** "" = بلا تصنيف */
  categoryId: string;
  type: ProductType;
  unitId: string;
  /** "" = بلا ضريبة */
  taxRateId: string;
  sellOnPos: boolean;
  /** Empty for a simple product: one hidden variant without options. */
  axes: Axis[];
  variants: VariantDraft[];
}

export type FieldErrors = Partial<Record<string, string>>;

let keySeed = 0;
export function newKey(prefix = 'k'): string {
  keySeed += 1;
  return `${prefix}${keySeed}`;
}

export const DEFAULT_AXIS_NAMES = ['المقاس', 'اللون'] as const;
export const MAX_AXES = 3;

// ─── From and to the server ───────────────────────────────────────────────────

/** Thousandths → what the field shows: 12000 → "12", 2500 → "2.5". */
export function qtyText(thousandths: number | null): string {
  if (thousandths === null) return '';
  const whole = Math.trunc(thousandths / 1000);
  const fraction = Math.abs(thousandths % 1000);
  return fraction ? `${whole}.${String(fraction).padStart(3, '0').replace(/0+$/, '')}` : String(whole);
}

/** What the field holds → thousandths; null when empty. */
export function qtyFromText(text: string): number | null {
  if (!/\d/.test(text)) return null;
  return Number(parseDecimal(text.replace(/\.$/, ''), 3));
}

export function newBarcode(kind: BarcodeKind, code = ''): BarcodeDraft {
  return { key: newKey('b'), kind, code, packCount: '1', packName: '', packPriceMinor: null };
}

export function emptyDraft(options: {
  currency: CurrencyCode;
  unitId: string;
  categoryId?: string;
  barcode?: string;
}): ProductDraft {
  return {
    nameAr: '',
    nameEn: '',
    brand: '',
    categoryId: options.categoryId ?? '',
    type: 'stock',
    unitId: options.unitId,
    taxRateId: '',
    sellOnPos: true,
    axes: [],
    variants: [
      {
        key: newKey('v'),
        sku: '',
        attributes: [],
        currency: options.currency,
        priceMinor: null,
        minPriceMinor: null,
        minStock: '',
        barcodes: options.barcode ? [newBarcode('standard', options.barcode)] : [],
        archived: false,
      },
    ],
  };
}

function variantDraft(variant: VariantDetail): VariantDraft {
  return {
    key: variant.id,
    id: variant.id,
    sku: variant.sku ?? '',
    attributes: variant.attributes.map((a) => ({ ...a })),
    currency: variant.price.currency,
    priceMinor: variant.price.priceMinor,
    minPriceMinor: variant.minPriceMinor,
    minStock: qtyText(variant.minStockQty),
    barcodes: variant.barcodes.map((b) => ({
      key: b.id,
      id: b.id,
      kind: b.kind,
      code: b.code,
      packCount: qtyText(b.packQty),
      packName: b.packName ?? '',
      packPriceMinor: b.packPriceMinor,
    })),
    archived: variant.archivedAt !== null,
  };
}

/** The axes the live variants use, in their order: names from the first variant, values as met. */
export function axesOf(variants: readonly VariantDraft[]): Axis[] {
  const live = variants.filter((v) => !v.archived && v.attributes.length > 0);
  const first = live[0];
  if (!first) return [];
  return first.attributes.map((attribute, index) => ({
    key: newKey('a'),
    name: attribute.name,
    values: [...new Set(live.map((v) => v.attributes[index]?.value).filter((v): v is string => Boolean(v)))],
  }));
}

export function draftFromDetail(detail: ProductDetail): ProductDraft {
  const variants = detail.variants.map(variantDraft);
  return {
    nameAr: detail.nameAr,
    nameEn: detail.nameEn ?? '',
    brand: detail.brand ?? '',
    categoryId: detail.categoryId ?? '',
    type: detail.type,
    unitId: detail.unitId,
    taxRateId: detail.taxRateId ?? '',
    sellOnPos: detail.sellOnPos,
    axes: axesOf(variants),
    variants,
  };
}

/** «أبيض · 1.7 لتر»: the label the server also makes from the values. */
export function variantLabel(attributes: readonly { value: string }[]): string {
  return attributes.map((a) => a.value).join(' · ');
}

// ─── The matrix (contract Q8: built on the client, sent as `variants`) ─────────

function combinations(axes: readonly Axis[]): { name: string; value: string }[][] {
  const used = axes.filter((axis) => axis.name.trim() && axis.values.length > 0);
  if (used.length === 0) return [];
  return used.reduce<{ name: string; value: string }[][]>(
    (rows, axis) =>
      rows.flatMap((row) => axis.values.map((value) => [...row, { name: axis.name.trim(), value }])),
    [[]],
  );
}

const valuesKey = (attributes: readonly { value: string }[]) =>
  JSON.stringify(attributes.map((a) => a.value));

/**
 * Rebuilds the variants from the axes. A variant whose values are still in the matrix keeps its id,
 * price and barcodes (a renamed axis only renames its attributes); a new combination gets the first
 * variant's price; a saved variant that left the matrix is archived, never deleted (its sales
 * still name it), and a new one is dropped. No axes = a simple product with its one variant.
 */
export function applyAxes(variants: readonly VariantDraft[], axes: readonly Axis[]): VariantDraft[] {
  const combos = combinations(axes);
  const live = variants.filter((v) => !v.archived);
  const template = live[0] ?? variants[0];
  if (!template) return [];

  if (combos.length === 0) {
    // Back to a simple product: the first live variant stays, without options.
    const keep = live.find((v) => v.attributes.length === 0) ?? template;
    return variants.flatMap<VariantDraft>((v) => {
      if (v.key === keep.key) return [{ ...v, attributes: [], archived: false }];
      return v.id ? [{ ...v, archived: true }] : [];
    });
  }

  const byValues = new Map(
    variants.filter((v) => v.attributes.length > 0).map((v) => [valuesKey(v.attributes), v]),
  );
  // The simple product's one variant becomes the first combination, so its barcodes and sales stay.
  let plain = variants.find((v) => v.attributes.length === 0 && !v.archived);
  const used = new Set<string>();
  const out: VariantDraft[] = combos.map((attributes) => {
    const existing = byValues.get(valuesKey(attributes)) ?? plain;
    if (existing && !used.has(existing.key)) {
      used.add(existing.key);
      if (existing === plain) plain = undefined;
      return { ...existing, attributes, archived: false };
    }
    return {
      key: newKey('v'),
      sku: '',
      attributes,
      currency: template.currency,
      priceMinor: template.priceMinor,
      minPriceMinor: template.minPriceMinor,
      minStock: template.minStock,
      barcodes: [],
      archived: false,
    };
  });
  for (const variant of variants) {
    if (!used.has(variant.key) && variant.id) out.push({ ...variant, archived: true });
  }
  return out;
}

// ─── Bodies ───────────────────────────────────────────────────────────────────

/** Which draft rows the request's arrays stand for, to put the server's errors back on them. */
export interface SentKeys {
  variants: { key: string; barcodes: string[] }[];
}

export interface Built<T> {
  body: T;
  sent: SentKeys;
  /** Errors found before sending (a price left empty) */
  errors: FieldErrors;
}

const textOrNull = (value: string) => value.trim() || null;

function barcodeInput(barcode: BarcodeDraft): BarcodeInput {
  const pack = {
    packQty: qtyFromText(barcode.packCount) ?? 1000,
    packName: textOrNull(barcode.packName),
    packPriceMinor: barcode.packPriceMinor,
  };
  const id = barcode.id ? { id: barcode.id } : {};
  if (barcode.kind === 'internal') {
    return { ...id, kind: 'internal', ...(barcode.code ? { code: barcode.code } : {}), ...pack };
  }
  return { ...id, kind: 'standard', code: barcode.code, ...pack };
}

function checkPrices(variants: readonly VariantDraft[], errors: FieldErrors) {
  for (const variant of variants) {
    if (!variant.archived && variant.priceMinor === null) errors[`v.${variant.key}.price`] = 'اكتب سعر البيع';
  }
}

function fullVariant(variant: VariantDraft) {
  return {
    sku: textOrNull(variant.sku),
    attributes: variant.attributes,
    price: { currency: variant.currency, priceMinor: variant.priceMinor ?? 0 },
    minPriceMinor: variant.minPriceMinor,
    minStockQty: qtyFromText(variant.minStock),
    barcodes: variant.barcodes.map(barcodeInput),
  };
}

export function buildCreate(draft: ProductDraft): Built<CreateProductInput> {
  const errors: FieldErrors = {};
  const variants = draft.variants.filter((v) => !v.archived);
  checkPrices(variants, errors);
  return {
    body: {
      nameAr: draft.nameAr.trim(),
      nameEn: textOrNull(draft.nameEn),
      brand: textOrNull(draft.brand),
      categoryId: draft.categoryId || null,
      type: draft.type,
      unitId: draft.unitId || undefined,
      taxRateId: draft.taxRateId || null,
      sellOnPos: draft.sellOnPos,
      variants: variants.map(fullVariant),
    },
    sent: { variants: variants.map((v) => ({ key: v.key, barcodes: v.barcodes.map((b) => b.key) })) },
    errors,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function barcodesOfDetail(variant: VariantDetail) {
  return variant.barcodes.map((b) =>
    barcodeInput({
      key: b.id,
      id: b.id,
      kind: b.kind,
      code: b.code,
      packCount: qtyText(b.packQty),
      packName: b.packName ?? '',
      packPriceMinor: b.packPriceMinor,
    }),
  );
}

type VariantPatch = NonNullable<UpdateProductInput['variants']>[number];

function variantPatch(draft: VariantDraft, original: VariantDetail | undefined): VariantPatch | null {
  if (!original) return draft.archived ? null : fullVariant(draft);
  const patch: VariantPatch = { id: original.id };
  const sku = textOrNull(draft.sku);
  if (sku !== original.sku) patch.sku = sku;
  if (!sameJson(draft.attributes, original.attributes)) patch.attributes = draft.attributes;
  if (
    draft.priceMinor !== null &&
    (draft.currency !== original.price.currency || draft.priceMinor !== original.price.priceMinor)
  ) {
    patch.price = { currency: draft.currency, priceMinor: draft.priceMinor };
  }
  if (draft.minPriceMinor !== original.minPriceMinor) patch.minPriceMinor = draft.minPriceMinor;
  const minStockQty = qtyFromText(draft.minStock);
  if (minStockQty !== original.minStockQty) patch.minStockQty = minStockQty;
  const barcodes = draft.barcodes.map(barcodeInput);
  if (!sameJson(barcodes, barcodesOfDetail(original))) patch.barcodes = barcodes;
  if (draft.archived !== (original.archivedAt !== null)) patch.archived = draft.archived;
  return Object.keys(patch).length > 1 ? patch : null;
}

/** PATCH: only what changed (17), and for a variant only its changed fields; barcodes as a whole list. */
export function buildUpdate(draft: ProductDraft, original: ProductDetail): Built<UpdateProductInput> {
  const errors: FieldErrors = {};
  checkPrices(draft.variants, errors);
  const body: UpdateProductInput = { version: original.version };
  const nameAr = draft.nameAr.trim();
  if (nameAr !== original.nameAr) body.nameAr = nameAr;
  if (textOrNull(draft.nameEn) !== original.nameEn) body.nameEn = textOrNull(draft.nameEn);
  if (textOrNull(draft.brand) !== original.brand) body.brand = textOrNull(draft.brand);
  if ((draft.categoryId || null) !== original.categoryId) body.categoryId = draft.categoryId || null;
  if (draft.type !== original.type) body.type = draft.type;
  if (draft.unitId && draft.unitId !== original.unitId) body.unitId = draft.unitId;
  if ((draft.taxRateId || null) !== original.taxRateId) body.taxRateId = draft.taxRateId || null;
  if (draft.sellOnPos !== original.sellOnPos) body.sellOnPos = draft.sellOnPos;

  const sent: SentKeys = { variants: [] };
  const variants: VariantPatch[] = [];
  for (const variant of draft.variants) {
    const patch = variantPatch(
      variant,
      original.variants.find((v) => v.id === variant.id),
    );
    if (!patch) continue;
    variants.push(patch);
    sent.variants.push({
      key: variant.key,
      barcodes: patch.barcodes ? variant.barcodes.map((b) => b.key) : [],
    });
  }
  if (variants.length > 0) body.variants = variants;
  return { body, sent, errors };
}

/** True when the PATCH would change nothing but the version. */
export function isEmptyUpdate(body: UpdateProductInput): boolean {
  return Object.keys(body).length === 1;
}

// ─── Errors back to the fields ────────────────────────────────────────────────

const ARABIC = /[؀-ۿ]/;
const FALLBACK_MESSAGE = 'تحقّق من هذه الخانة';

/**
 * A path of the request (`variants.0.barcodes.1.code`, or zod's ['variants', 0, 'price']) → the
 * draft's field key. Null when the path names no field of the card.
 */
export function fieldKeyOf(path: readonly PropertyKey[], sent: SentKeys): string | null {
  const [root, index, field, subIndex, subField] = path.map(String);
  if (root === undefined) return null;
  if (root !== 'variants') return root;
  if (index === undefined) return 'variants';
  const variant = sent.variants[Number(index)];
  if (!variant) return 'variants';
  if (field === 'barcodes' && subIndex !== undefined) {
    const barcode = variant.barcodes[Number(subIndex)];
    if (barcode) return `b.${barcode}.${subField ?? 'code'}`;
  }
  return `v.${variant.key}.${field ?? 'price'}`;
}

export function errorsFromPaths(
  entries: readonly { path: readonly PropertyKey[]; message: string }[],
  sent: SentKeys,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of entries) {
    const key = fieldKeyOf(path, sent) ?? '_form';
    errors[key] ??= ARABIC.test(message) ? message : FALLBACK_MESSAGE;
  }
  return errors;
}

/** The server's `fields` ({ "variants.0.price.priceMinor": "…" }) mapped to the draft. */
export function errorsFromServer(fields: Record<string, string>, sent: SentKeys): FieldErrors {
  return errorsFromPaths(
    Object.entries(fields).map(([path, message]) => ({ path: path.split('.'), message })),
    sent,
  );
}

/** The contract's own checks, before the request: the same messages the server would answer. */
export function validateBuilt(
  built: Built<CreateProductInput> | Built<UpdateProductInput>,
  mode: 'create' | 'update',
): FieldErrors {
  const schema = mode === 'create' ? createProductInput : updateProductInput;
  const result = schema.safeParse(built.body);
  const errors = result.success ? {} : errorsFromPaths(result.error.issues, built.sent);
  return { ...errors, ...built.errors };
}

// ─── What changed under us (17 › التعديل المتزامن) ─────────────────────────────

/** The parts of the product another person changed between two versions, as the card names them. */
export function changedParts(before: ProductDetail, after: ProductDetail): string[] {
  const parts: string[] = [];
  if (before.nameAr !== after.nameAr || before.nameEn !== after.nameEn) parts.push('الاسم');
  if (before.categoryId !== after.categoryId) parts.push('التصنيف');
  if (before.unitId !== after.unitId || before.type !== after.type) parts.push('الوحدة');
  if (before.taxRateId !== after.taxRateId) parts.push('الضريبة');
  const prices = (p: ProductDetail) => p.variants.map((v) => [v.id, v.price, v.minPriceMinor]);
  if (!sameJson(prices(before), prices(after))) parts.push('السعر');
  const codes = (p: ProductDetail) => p.variants.map((v) => v.barcodes.map((b) => b.code));
  if (!sameJson(codes(before), codes(after))) parts.push('الباركود');
  const options = (p: ProductDetail) => p.variants.map((v) => [v.id, v.attributes, v.archivedAt]);
  if (!sameJson(options(before), options(after))) parts.push('المتغيّرات');
  if (before.archivedAt !== after.archivedAt) parts.push('الأرشفة');
  return parts;
}
