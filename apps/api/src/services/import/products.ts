import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  BRANCH_QTY_PREFIX,
  barcodeCodeSchema,
  createProductInput,
  currencyCodeSchema,
  normalizeArabic,
  serialSchema,
  updateProductInput,
  type BarcodeView,
  type CurrencyCode,
  type ImportRow,
  type ProductDetail,
} from '@serva/core';
import {
  barcodes,
  branches,
  categories,
  taxRates,
  units,
  variants,
  products,
  serials,
  type Transaction,
} from '@serva/db';
import { ZodError } from 'zod';
import { inScope, permissionScope } from '../../auth/permissions';
import { AppError, isUniqueViolation } from '../../errors';
import { fieldError } from '../catalog/common';
import {
  barcodeConflict,
  createProductTx,
  productDetail,
  searchNameOf,
  updateProductTx,
} from '../catalog/products';
import { createCategoryTx } from '../catalog/reference';
import { baseCurrency } from '../purchases';
import { amountOf, dateOf, Issues, listOf, quantityOf, shortText, textOf, truthy } from './cells';
import { fieldOfPath, issuesOf, variantIndexOf, type ImportContext, type Results } from './context';
import { postOpeningStock, variantsWithMovements, type OpeningLine, type OpeningLot } from './opening';

/** Everything about the store a product row refers to, read once per chunk. */
interface Lookups {
  base: CurrencyCode;
  branchIds: Set<string>;
  defaultBranchId: string | null;
  units: Map<string, { id: string; allowsFraction: boolean }>;
  taxByName: Map<string, string>;
  taxByRate: Map<number, string>;
  categories: Map<string, string>;
}

async function loadLookups(ctx: ImportContext): Promise<Lookups> {
  const { tx } = ctx;
  const base = await baseCurrency(tx);
  const branchRows = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(branches.code);
  const unitRows = await tx.select().from(units).where(isNull(units.archivedAt));
  const taxRows = await tx.select().from(taxRates).where(isNull(taxRates.archivedAt));
  const categoryRows = await tx.select().from(categories).where(isNull(categories.archivedAt));
  const unitMap = new Map<string, { id: string; allowsFraction: boolean }>();
  for (const u of unitRows) {
    const entry = { id: u.id, allowsFraction: u.allowsFraction };
    unitMap.set(normalizeArabic(u.name), entry);
    unitMap.set(normalizeArabic(u.symbol), entry);
  }
  const taxByRate = new Map<number, string>();
  for (const t of taxRows) if (!taxByRate.has(t.rateBp)) taxByRate.set(t.rateBp, t.id);
  const wanted = ctx.input.branchId;
  if (wanted && !branchRows.some((b) => b.id === wanted)) {
    throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
      branchId: 'الفرع غير موجود',
    });
  }
  return {
    base,
    branchIds: new Set(branchRows.map((b) => b.id)),
    defaultBranchId: wanted ?? branchRows[0]?.id ?? null,
    units: unitMap,
    taxByName: new Map(taxRows.map((t) => [normalizeArabic(t.name), t.id])),
    taxByRate,
    categories: new Map(categoryRows.map((c) => [normalizeArabic(c.name), c.id])),
  };
}

interface Parsed {
  line: number;
  name: string;
  nameEn: string | null;
  barcode: string | null;
  sku: string | null;
  category: string | null;
  brand: string | null;
  /** «رمز الموديل»: rows that share it are the variants of one product */
  model: string | null;
  season: string | null;
  unitId: string | null;
  taxRateId: string | null;
  /** The file said something about the tax (even «0»), so an update touches it */
  hasTax: boolean;
  price: { currency: CurrencyCode; priceMinor: number } | null;
  wholesaleMinor: number | null;
  /** One unit's cost in the base currency, for the opening stock's value */
  costMinor: number | null;
  minStock: number | null;
  attributes: { name: string; value: string }[];
  /** Opening quantities by branch, thousandths */
  stock: Map<string, number>;
  /** «العبوة»: a pack barcode of the variant (علبة 12) */
  pack: ParsedPack | null;
  /** «الكفالة بالأشهر»; null: the file said nothing */
  warrantyMonths: number | null;
  /** «له رقم تسلسلي»; null: the file said nothing */
  tracksSerial: boolean | null;
  /** What of the default branch's opening quantity came in which batch (the row's own, then merged rows) */
  lots: OpeningLot[];
}

interface ParsedPack {
  name: string | null;
  /** Base units in the pack, thousandths */
  qty: number;
  /** null: the system makes an internal barcode */
  code: string | null;
  priceMinor: number | null;
}

const SIZE = 'المقاس';
const COLOUR = 'اللون';

/** A row of the file as the typed values a product is made of; problems go to `issues`. */
function parseRow(row: ImportRow, lookups: Lookups, issues: Issues): Parsed {
  const name = shortText(row, 'name', 120, 'اسم المنتج', issues);
  if (name === null && !issues.any) issues.add('name', 'اسم المنتج مطلوب');
  const nameEn = shortText(row, 'nameEn', 120, 'الاسم الإنجليزي', issues);
  const brand = shortText(row, 'brand', 60, 'الماركة', issues);
  const sku = shortText(row, 'sku', 40, 'رمز الصنف', issues);
  const model = shortText(row, 'model', 40, 'رمز الموديل', issues);
  const season = shortText(row, 'season', 40, 'الموسم', issues);
  const category = shortText(row, 'category', 60, 'التصنيف', issues);

  let barcode: string | null = null;
  const barcodeText = textOf(row.values.barcode);
  if (barcodeText !== null) {
    const parsed = barcodeCodeSchema.safeParse(barcodeText);
    if (parsed.success) barcode = parsed.data;
    else issues.add('barcode', parsed.error.issues[0]?.message ?? 'الباركود غير صالح');
  }

  let unitId: string | null = null;
  let allowsFraction = false;
  const unitText = textOf(row.values.unit);
  if (unitText !== null) {
    const unit = lookups.units.get(normalizeArabic(unitText));
    if (unit) {
      unitId = unit.id;
      allowsFraction = unit.allowsFraction;
    } else issues.add('unit', `الوحدة «${unitText}» غير موجودة في المتجر. أضفها من الوحدات أولاً`);
  }

  let taxRateId: string | null = null;
  const taxText = textOf(row.values.tax);
  if (taxText !== null) {
    const key = normalizeArabic(taxText);
    const percent = Number(key.replace('%', '').replace(',', '.'));
    const found =
      lookups.taxByName.get(key) ??
      (Number.isFinite(percent) ? lookups.taxByRate.get(Math.round(percent * 100)) : undefined);
    if (found) taxRateId = found;
    else if (percent === 0) taxRateId = null;
    else issues.add('tax', `الضريبة «${taxText}» غير موجودة في المتجر. أضفها من الضرائب أولاً`);
  }

  let currency = lookups.base;
  const currencyText = textOf(row.values.currency);
  if (currencyText !== null) {
    const parsed = currencyCodeSchema.safeParse(currencyText.toUpperCase());
    if (parsed.success) currency = parsed.data;
    else issues.add('currency', `العملة «${currencyText}» غير مدعومة. اكتب SYP أو USD`);
  }
  const priceMinor = amountOf(row, 'price', currency, 'سعر البيع', issues);
  const wholesaleMinor = amountOf(row, 'wholesalePrice', currency, 'سعر الجملة', issues);
  const costMinor = amountOf(row, 'cost', lookups.base, 'التكلفة', issues);
  const minStock = quantityOf(row, 'minStock', 'الحد الأدنى', issues, { allowsFraction: true });

  const attributes: { name: string; value: string }[] = [];
  const size = shortText(row, 'size', 40, 'المقاس', issues);
  if (size) attributes.push({ name: SIZE, value: size });
  const colour = shortText(row, 'colour', 40, 'اللون', issues);
  if (colour) attributes.push({ name: COLOUR, value: colour });

  const stock = new Map<string, number>();
  const quantity = quantityOf(row, 'quantity', 'الكمية', issues, { allowsFraction });
  if (quantity !== null && quantity > 0) {
    if (lookups.defaultBranchId) stock.set(lookups.defaultBranchId, quantity);
    else issues.add('quantity', 'لا فرع في المتجر لتدخل إليه الكمية');
  }
  for (const key of Object.keys(row.values)) {
    if (!key.startsWith(BRANCH_QTY_PREFIX)) continue;
    const branchId = key.slice(BRANCH_QTY_PREFIX.length);
    if (!lookups.branchIds.has(branchId)) {
      if (textOf(row.values[key]) !== null) issues.add(key, 'فرع غير موجود');
      continue;
    }
    const qty = quantityOf(row, key, 'الكمية', issues, { allowsFraction });
    if (qty !== null && qty > 0) stock.set(branchId, (stock.get(branchId) ?? 0) + qty);
  }

  // The pack: 12 pieces in a «علبة», with its own barcode and price when the file has them
  const packName = shortText(row, 'packName', 30, 'اسم العبوة', issues);
  const packQty = quantityOf(row, 'packQty', 'كمية العبوة', issues, { allowsFraction: true });
  const packPrice = amountOf(row, 'packPrice', currency, 'سعر العبوة', issues);
  let packBarcode: string | null = null;
  const packBarcodeText = textOf(row.values.packBarcode);
  if (packBarcodeText !== null) {
    const checked = barcodeCodeSchema.safeParse(packBarcodeText);
    if (checked.success) packBarcode = checked.data;
    else issues.add('packBarcode', checked.error.issues[0]?.message ?? 'باركود العبوة غير صالح');
  }
  let pack: ParsedPack | null = null;
  if (packName !== null || packQty !== null || packBarcode !== null || packPrice !== null) {
    if (packQty === null) issues.add('packQty', 'اكتب كمية العبوة: كم قطعة فيها');
    else if (packQty <= 1000) issues.add('packQty', 'كمية العبوة أكبر من واحد');
    else pack = { name: packName, qty: packQty, code: packBarcode, priceMinor: packPrice };
  }
  if (packBarcode !== null && packBarcode === barcode) {
    issues.add('packBarcode', 'باركود العبوة هو باركود القطعة نفسه');
  }

  const warranty = quantityOf(row, 'warrantyMonths', 'الكفالة', issues, { allowsFraction: true });
  let warrantyMonths: number | null = null;
  if (warranty !== null) {
    if (warranty % 1000 !== 0 || warranty < 1000 || warranty > 120_000) {
      issues.add('warrantyMonths', 'الكفالة عدد أشهر صحيح من 1 إلى 120');
    } else warrantyMonths = warranty / 1000;
  }
  const trackText = textOf(row.values.tracksSerial);
  const tracksSerial = trackText === null ? null : truthy(trackText);

  // The batch, its expiry and the pieces' numbers belong to the opening quantity of the default branch
  const batchNo = shortText(row, 'batch', 40, 'رقم الدفعة', issues);
  const expiry = dateOf(row, 'expiry', 'تاريخ الانتهاء', issues);
  const numbers: string[] = [];
  for (const raw of listOf(row.values.serials)) {
    const checked = serialSchema.safeParse(raw);
    if (!checked.success) {
      issues.add('serials', `الرقم «${raw}» غير صالح: من 3 إلى 40 خانة`);
    } else if (numbers.includes(checked.data)) {
      issues.add('serials', `الرقم ${checked.data} مكرر في الصف`);
    } else numbers.push(checked.data);
  }
  const lots: OpeningLot[] = [];
  const ownQty = quantity !== null && quantity > 0 && lookups.defaultBranchId ? quantity : 0;
  if ((batchNo !== null || expiry !== null || numbers.length > 0) && ownQty === 0) {
    issues.add('quantity', 'اكتب الكمية الافتتاحية مع الدفعة أو الأرقام التسلسلية');
  } else if (ownQty > 0) lots.push({ qty: ownQty, batchNo, expiryDate: expiry, serials: numbers });

  return {
    line: row.line,
    name: name ?? '',
    nameEn,
    barcode,
    sku,
    category,
    brand,
    model,
    season,
    unitId,
    taxRateId,
    hasTax: taxText !== null,
    price: priceMinor === null ? null : { currency, priceMinor },
    wholesaleMinor,
    costMinor,
    minStock,
    attributes,
    stock,
    pack,
    warrantyMonths,
    tracksSerial,
    lots,
  };
}

const attrKey = (attributes: { name: string; value: string }[]) =>
  JSON.stringify(attributes.map((a) => [normalizeArabic(a.name), normalizeArabic(a.value)]));

interface ExistingVariant {
  variantId: string;
  productId: string;
}

/** The variant a barcode belongs to, if any. */
async function variantOfBarcode(tx: Transaction, code: string): Promise<ExistingVariant | null> {
  const [row] = await tx
    .select({ variantId: barcodes.variantId, productId: variants.productId })
    .from(barcodes)
    .innerJoin(variants, and(eq(variants.tenantId, barcodes.tenantId), eq(variants.id, barcodes.variantId)))
    .where(eq(barcodes.code, code));
  return row ?? null;
}

/** A live product of this name, the oldest first. */
async function productOfName(tx: Transaction, name: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        or(eq(products.nameAr, name), eq(products.searchName, searchNameOf(name, null))),
        isNull(products.archivedAt),
      ),
    )
    .orderBy(products.createdAt, products.id)
    .limit(1);
  return row?.id ?? null;
}

/**
 * The rows of one product travel together, so they become one product with several variants: first
 * by the model code («رمز الموديل», or an SKU that two or more rows share), then by the same name with
 * different sizes or colours. A row with no size or colour and no model code is a product on its own.
 */
function groupRows(parsed: Parsed[]): Parsed[][] {
  const groups = new Map<string, Parsed[]>();
  const skuUses = new Map<string, number>();
  for (const p of parsed) {
    if (p.attributes.length > 0 && p.sku !== null) {
      const k = normalizeArabic(p.sku);
      skuUses.set(k, (skuUses.get(k) ?? 0) + 1);
    }
  }
  for (const p of parsed) {
    const sharedSku =
      p.attributes.length > 0 && p.sku !== null && (skuUses.get(normalizeArabic(p.sku)) ?? 0) > 1;
    const model = p.model ?? (sharedSku ? p.sku : null);
    const key =
      model !== null
        ? `m|${normalizeArabic(model)}`
        : p.attributes.length > 0
          ? `v|${normalizeArabic(p.name)}|${normalizeArabic(p.brand ?? '')}`
          : `s|${String(p.line)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

interface Opening {
  line: number;
  variantId: string;
  name: string;
  stock: Map<string, number>;
  costMinor: number | null;
  lots: OpeningLot[];
}

interface RowFailure {
  field: string;
  message: string;
  /** The row the problem is about, when the server named one of the variants */
  line: number | null;
}

/** What a group was doing when it failed: the rows in the order of the variants it sent. */
interface GroupState {
  sent: Parsed[];
}

function failureOf(error: unknown, state: GroupState): RowFailure {
  const lineOf = (path: string) => {
    const index = variantIndexOf(path);
    return index === null ? null : (state.sent[index]?.line ?? null);
  };
  if (error instanceof ZodError) {
    const issue = error.issues[0]!;
    const path = issue.path.map(String).join('.');
    return { field: fieldOfPath(path), message: issue.message, line: lineOf(path) };
  }
  if (isUniqueViolation(error, 'barcodes_code_unique')) {
    return { field: 'barcode', message: barcodeConflict().message, line: null };
  }
  const [first] = issuesOf(error);
  return { field: fieldOfPath(first!.path), message: first!.message, line: lineOf(first!.path) };
}

export async function importProducts(ctx: ImportContext, rows: ImportRow[], results: Results): Promise<void> {
  const { tx, input } = ctx;
  const adjust = await permissionScope(tx, ctx.auth.userId, 'inventory.adjust');
  const lookups = await loadLookups(ctx);

  // Parse every row first; the ones with problems are answered and left out
  const parsed: Parsed[] = [];
  for (const row of rows) {
    const issues = new Issues();
    const p = parseRow(row, lookups, issues);
    for (const branchId of p.stock.keys()) {
      if (!inScope(adjust, branchId)) {
        issues.add('quantity', 'الكمية الافتتاحية تحتاج صلاحية اعتماد الجرد والتسويات في هذا الفرع');
        break;
      }
    }
    if (issues.any) results.fail(row.line, issues.list);
    else parsed.push(p);
  }
  // A barcode belongs to one variant: a later row repeating it (maybe for another size or colour)
  // is refused and named, never merged into the first row and lost
  const seenCodes = new Map<string, Parsed>();
  // A repeated barcode with a batch (or expiry, or numbers) of its own is one more batch of the same
  // item: its quantity joins the first row's, and the row answers as that row does
  const merged = new Map<number, number>();
  for (const p of [...parsed]) {
    if (p.barcode === null) continue;
    const first = seenCodes.get(p.barcode);
    if (!first) {
      seenCodes.set(p.barcode, p);
      continue;
    }
    const lot = p.lots[0];
    const branchId = lookups.defaultBranchId;
    if (
      lot &&
      branchId !== null &&
      first.lots.length > 0 &&
      (lot.batchNo !== null || lot.expiryDate !== null || lot.serials.length > 0)
    ) {
      first.lots.push(lot);
      first.stock.set(branchId, (first.stock.get(branchId) ?? 0) + lot.qty);
      merged.set(p.line, first.line);
      parsed.splice(parsed.indexOf(p), 1);
      continue;
    }
    const wanted = p.attributes.map((a) => a.value).join(' · ');
    results.fail(p.line, [
      {
        field: 'barcode',
        message:
          `الباركود ${p.barcode} مكرر: سبق في السطر ${String(first.line)}` +
          (wanted ? ` فلم يُستورد «${wanted}». أعطِ كل مقاس ولون باركوداً خاصاً به` : ''),
      },
    ]);
    parsed.splice(parsed.indexOf(p), 1);
  }

  // A number is one piece: the same number in two rows of the file is refused on the later row
  const seenSerials = new Map<string, number>();
  for (const p of [...parsed]) {
    const dup = p.lots.flatMap((l) => l.serials).find((n) => seenSerials.has(n));
    if (dup !== undefined) {
      results.fail(p.line, [
        { field: 'serials', message: `الرقم ${dup} مكرر: سبق في السطر ${String(seenSerials.get(dup))}` },
      ]);
      parsed.splice(parsed.indexOf(p), 1);
      continue;
    }
    for (const n of p.lots.flatMap((l) => l.serials)) seenSerials.set(n, p.line);
  }

  const openings: Opening[] = [];
  const createdCategories: string[] = [];
  for (const group of groupRows(parsed)) {
    const keep = createdCategories.length;
    const state: GroupState = { sent: group };
    const groupOpenings: Opening[] = [];
    try {
      await tx.transaction(async (sp) => {
        await processGroup(
          { ...ctx, tx: sp },
          lookups,
          group,
          results,
          groupOpenings,
          createdCategories,
          state,
        );
      });
      openings.push(...groupOpenings);
    } catch (error) {
      // The savepoint rolled back with the categories it made: forget them
      for (const key of createdCategories.splice(keep)) lookups.categories.delete(key);
      const failure = failureOf(error, state);
      const named = failure.line ?? group[0]!.line;
      for (const g of group) {
        if (g.line === named) results.fail(g.line, [{ field: failure.field, message: failure.message }]);
        else {
          results.fail(g.line, [
            { field: '_', message: `لم يُحفظ لأن صفاً آخر من المنتج نفسه فيه خطأ (السطر ${String(named)})` },
          ]);
        }
      }
    }
  }

  for (const [line, into] of merged) {
    if (results.statusOf(into) === 'error') {
      results.fail(line, [
        { field: '_', message: `لم يُحفظ لأن السطر ${String(into)} (الصنف نفسه) فيه خطأ` },
      ]);
    } else results.set(line, results.statusOf(into), [`دفعة إضافية أُضيفت إلى صنف السطر ${String(into)}`]);
  }

  const lines: OpeningLine[] = [];
  for (const o of openings) {
    for (const [branchId, qty] of o.stock) {
      if (lines.some((l) => l.variantId === o.variantId && l.branchId === branchId)) {
        results.note(o.line, 'الصنف مكرر في الملف: الكمية الافتتاحية من أول صف له فقط');
        continue;
      }
      lines.push({
        variantId: o.variantId,
        name: o.name,
        branchId,
        qty,
        unitCostMinor: o.costMinor ?? 0,
        ...(branchId === lookups.defaultBranchId ? { lots: o.lots } : {}),
      });
    }
  }
  await postOpeningStock(tx, ctx.auth, ctx.meta, input.date, lines);
}

/** A new pack barcode as the catalog takes it: the file's code, or an internal one the system numbers. */
function packInput(pack: ParsedPack) {
  const fields = { packQty: pack.qty, packName: pack.name, packPriceMinor: pack.priceMinor };
  return pack.code === null
    ? { kind: 'internal' as const, ...fields }
    : { kind: 'standard' as const, code: pack.code, ...fields };
}

/**
 * The variant's complete barcode list with the row's pack in it: a pack already there (the same code,
 * or the same quantity when the file gave no code) takes the name and price the file has, otherwise
 * the pack is added. `changed` is false when the variant already says what the file says.
 */
function withPack(
  existing: readonly BarcodeView[],
  pack: ParsedPack,
): { list: Record<string, unknown>[]; changed: boolean } {
  const list: Record<string, unknown>[] = existing.map((b) => ({ ...b }));
  const at = existing.findIndex((b) => (pack.code !== null ? b.code === pack.code : b.packQty === pack.qty));
  if (at < 0) {
    list.push(packInput(pack));
    return { list, changed: true };
  }
  const b = existing[at]!;
  const next = {
    ...b,
    packQty: pack.qty,
    packName: pack.name ?? b.packName,
    packPriceMinor: pack.priceMinor ?? b.packPriceMinor,
  };
  list[at] = next;
  const changed =
    next.packQty !== b.packQty || next.packName !== b.packName || next.packPriceMinor !== b.packPriceMinor;
  return { list, changed };
}

/** The variant patch an update sends for a row: only what the file said. */
function variantPatch(p: Parsed): Record<string, unknown> {
  return {
    ...(p.sku !== null ? { sku: p.sku } : {}),
    ...(p.price ? { price: p.price } : {}),
    ...(p.wholesaleMinor !== null ? { wholesalePriceMinor: p.wholesaleMinor } : {}),
    ...(p.minStock !== null ? { minStockQty: p.minStock } : {}),
  };
}

/** True when the row says something different from what the variant and its product already hold. */
function differs(detail: ProductDetail, variantId: string, p: Parsed, categoryId: string | null): boolean {
  const v = detail.variants.find((x) => x.id === variantId)!;
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  return (
    (p.price !== null &&
      (v.price.priceMinor !== p.price.priceMinor || v.price.currency !== p.price.currency)) ||
    (p.wholesaleMinor !== null && !same(v.wholesalePriceMinor, p.wholesaleMinor)) ||
    (p.minStock !== null && !same(v.minStockQty, p.minStock)) ||
    (p.sku !== null && !same(v.sku, p.sku)) ||
    (p.nameEn !== null && !same(detail.nameEn, p.nameEn)) ||
    (p.brand !== null && !same(detail.brand, p.brand)) ||
    (p.season !== null && !same(detail.season, p.season)) ||
    (categoryId !== null && !same(detail.categoryId, categoryId)) ||
    (p.unitId !== null && !same(detail.unitId, p.unitId)) ||
    (p.hasTax && !same(detail.taxRateId, p.taxRateId)) ||
    (p.warrantyMonths !== null && !same(detail.warrantyMonths, p.warrantyMonths)) ||
    (p.tracksSerial !== null && detail.tracksSerial !== p.tracksSerial) ||
    (p.pack !== null && withPack(v.barcodes, p.pack).changed)
  );
}

async function categoryIdOf(
  ctx: ImportContext,
  lookups: Lookups,
  name: string | null,
  results: Results,
  line: number,
  created: string[],
): Promise<string | null> {
  if (name === null) return null;
  const key = normalizeArabic(name);
  const known = lookups.categories.get(key);
  if (known) return known;
  const made = await createCategoryTx(ctx.tx, { name, parentId: null, sortOrder: 0 }, ctx.catalog);
  lookups.categories.set(key, made.id);
  created.push(key);
  results.note(line, `سيُنشأ تصنيف جديد «${name}»`);
  return made.id;
}

/**
 * The numbers of the opening quantity before anything is written: an item that tracks them takes
 * one per piece, each new to the store; an item that does not takes none. A row whose opening will not
 * happen (the file asks to skip what exists, or the branch already moved the item) is not checked.
 */
async function checkLots(
  ctx: ImportContext,
  branchId: string | null,
  group: Parsed[],
  current: ProductDetail | null,
  matched: Map<Parsed, ExistingVariant>,
  fresh: Parsed[],
  state: GroupState,
): Promise<void> {
  const tracks = group.map((p) => p.tracksSerial).find((t) => t !== null) ?? current?.tracksSerial ?? false;
  const oldIds = [...matched.values()].map((m) => m.variantId);
  const moved =
    branchId !== null && oldIds.length > 0
      ? await variantsWithMovements(ctx.tx, branchId, oldIds)
      : new Set<string>();
  const opening = (p: Parsed) => {
    if (p.lots.length === 0) return false;
    if (fresh.includes(p)) return true;
    const found = matched.get(p);
    return ctx.input.existing !== 'skip' && found !== undefined && !moved.has(found.variantId);
  };
  state.sent = group;
  const wanted: { path: string; serial: string }[] = [];
  for (const [index, p] of group.entries()) {
    if (!opening(p)) continue;
    const path = `variants.${String(index)}.serials`;
    for (const lot of p.lots) {
      if (tracks && lot.serials.length * 1000 !== lot.qty) {
        throw fieldError(
          path,
          `اكتب ${String(lot.qty / 1000)} رقماً تسلسلياً، واحداً لكل قطعة (كُتب ${String(lot.serials.length)})`,
        );
      }
      if (!tracks && lot.serials.length > 0) {
        throw fieldError(path, 'هذا الصنف لا يتتبع الأرقام التسلسلية: اكتب «نعم» في «له رقم تسلسلي»');
      }
      for (const serial of lot.serials) wanted.push({ path, serial });
    }
  }
  if (wanted.length === 0) return;
  const known = await ctx.tx
    .select({ serial: serials.serial })
    .from(serials)
    .where(
      inArray(
        serials.serial,
        wanted.map((w) => w.serial),
      ),
    );
  const hit = wanted.find((w) => known.some((k) => k.serial === w.serial));
  if (hit) throw fieldError(hit.path, `الرقم ${hit.serial} موجود في المحل من قبل`);
}

async function processGroup(
  ctx: ImportContext,
  lookups: Lookups,
  group: Parsed[],
  results: Results,
  openings: Opening[],
  createdCategories: string[],
  state: GroupState,
): Promise<void> {
  const { tx, input } = ctx;
  const first = group[0]!;

  // Which rows are variants the store already has: a barcode is the identity; with no barcode the
  // same name and the same size and colour are
  const matched = new Map<Parsed, ExistingVariant>();
  let productId: string | null = null;
  for (const p of group) {
    if (p.barcode === null) continue;
    const found = await variantOfBarcode(tx, p.barcode);
    if (!found) continue;
    if (productId !== null && found.productId !== productId) {
      throw fieldError('variants.0.barcodes.0.code', 'باركودات هذا المنتج موزعة على منتجات مختلفة في المتجر');
    }
    matched.set(p, found);
    productId = found.productId;
  }
  // The code of a size belongs to that model: another product's barcode is not a size of this one
  if (productId !== null && first.attributes.length > 0) {
    const owner = await productDetail(tx, productId);
    if (normalizeArabic(owner.nameAr) !== normalizeArabic(first.name)) {
      const bad = group.find((p) => matched.has(p))!;
      state.sent = group;
      throw fieldError(
        `variants.${String(group.indexOf(bad))}.barcodes.0.code`,
        `الباركود ${bad.barcode ?? ''} مستخدم في المنتج «${owner.nameAr}»`,
      );
    }
  }
  const byNameAllowed = first.attributes.length > 0 || first.barcode === null;
  if (productId === null && byNameAllowed) productId = await productOfName(tx, first.name);

  let current = productId ? await productDetail(tx, productId) : null;
  if (current) {
    for (const p of group) {
      if (matched.has(p) || p.barcode !== null) continue;
      const key = attrKey(p.attributes);
      const same = current.variants.find((v) => v.archivedAt === null && attrKey(v.attributes) === key);
      if (same) matched.set(p, { variantId: same.id, productId: current.id });
    }
    // A plain product whose name is already taken by a product with sizes is a new product
    if (first.attributes.length === 0 && !matched.has(first)) current = null;
  }

  const categoryId = await categoryIdOf(ctx, lookups, first.category, results, first.line, createdCategories);

  const fresh = group.filter((p) => !matched.has(p));
  const old = group.filter((p) => matched.has(p));
  const pendingOpenings: { parsed: Parsed; variantId: string; name: string }[] = [];

  await checkLots(ctx, lookups.defaultBranchId, group, current, matched, fresh, state);

  // Rows for variants that exist: left alone, or patched
  const patches: Record<string, unknown>[] = [];
  const touched: Parsed[] = [];
  for (const p of old) {
    const { variantId } = matched.get(p)!;
    const variant = current!.variants.find((v) => v.id === variantId)!;
    const label = `${current!.nameAr} ${variant.label ?? ''}`.trim();
    if (p.attributes.length > 0 && attrKey(p.attributes) !== attrKey(variant.attributes)) {
      results.note(
        p.line,
        `الباركود لـ«${variant.label ?? 'بلا مقاس'}» في المتجر، والملف يقول «${p.attributes.map((a) => a.value).join(' · ')}»: تحقق من الصف`,
      );
    }
    if (input.existing === 'skip') {
      results.set(p.line, 'skip', ['موجود في المتجر، تُرك كما هو']);
      continue;
    }
    if (p.stock.size > 0) pendingOpenings.push({ parsed: p, variantId, name: label });
    if (differs(current!, variantId, p, categoryId)) {
      patches.push({
        id: variantId,
        ...variantPatch(p),
        ...(p.pack ? { barcodes: withPack(variant.barcodes, p.pack).list } : {}),
      });
      touched.push(p);
    } else {
      results.set(p.line, 'skip', ['لا تغيير']);
    }
  }

  const productPatch =
    touched.length > 0
      ? {
          ...(first.nameEn !== null ? { nameEn: first.nameEn } : {}),
          ...(first.brand !== null ? { brand: first.brand } : {}),
          ...(first.season !== null ? { season: first.season } : {}),
          ...(categoryId !== null ? { categoryId } : {}),
          ...(first.unitId !== null ? { unitId: first.unitId } : {}),
          ...(first.hasTax ? { taxRateId: first.taxRateId } : {}),
          ...(first.warrantyMonths !== null ? { warrantyMonths: first.warrantyMonths } : {}),
          ...(first.tracksSerial !== null ? { tracksSerial: first.tracksSerial } : {}),
        }
      : {};

  // Rows for variants the store does not have yet
  state.sent = current === null ? fresh : [...touched, ...fresh];
  for (const [index, p] of state.sent.entries()) {
    if (fresh.includes(p) && p.price === null) {
      throw fieldError(`variants.${String(index)}.price`, 'سعر البيع مطلوب للمنتج الجديد');
    }
  }
  const newVariants = fresh.map((p) => ({
    sku: p.sku,
    attributes: p.attributes,
    price: p.price,
    wholesalePriceMinor: p.wholesaleMinor,
    minStockQty: p.minStock,
    barcodes: [
      ...(p.barcode ? [{ kind: 'standard' as const, code: p.barcode }] : []),
      ...(p.pack ? [packInput(p.pack)] : []),
    ],
  }));

  if (current === null) {
    const data = createProductInput.parse({
      nameAr: first.name,
      nameEn: first.nameEn,
      categoryId,
      brand: first.brand,
      season: first.season,
      unitId: first.unitId ?? undefined,
      taxRateId: first.taxRateId,
      tracksSerial: first.tracksSerial ?? false,
      warrantyMonths: first.warrantyMonths,
      variants: newVariants,
    });
    const created = await createProductTx(tx, data, ctx.catalog);
    fresh.forEach((p, i) => {
      results.set(p.line, 'create');
      const variant = created.variants[i]!;
      if (p.stock.size > 0) {
        pendingOpenings.push({
          parsed: p,
          variantId: variant.id,
          name: `${created.nameAr} ${variant.label ?? ''}`.trim(),
        });
      }
    });
  } else if (fresh.length > 0 || patches.length > 0) {
    // The product exists: new sizes join it, and the rows asked to update are patched, in one write
    const data = updateProductInput.parse({
      version: current.version,
      ...productPatch,
      variants: [...patches, ...newVariants],
    });
    const updated = await updateProductTx(tx, current.id, data, ctx.catalog);
    for (const p of touched) results.set(p.line, 'update');
    // The variants this write added are the last ones, in the order they were sent
    const added = updated.variants.slice(updated.variants.length - fresh.length);
    fresh.forEach((p, i) => {
      results.set(p.line, 'create', [`أُضيف كمتغيّر إلى المنتج الموجود «${current!.nameAr}»`]);
      const variant = added[i]!;
      if (p.stock.size > 0) {
        pendingOpenings.push({
          parsed: p,
          variantId: variant.id,
          name: `${updated.nameAr} ${variant.label ?? ''}`.trim(),
        });
      }
    });
  }

  // Opening stock goes only where the branch has never moved that variant, so a second run of the
  // same file adds nothing twice
  const wanted = new Map<string, Set<string>>();
  for (const o of pendingOpenings) {
    for (const branchId of o.parsed.stock.keys()) {
      wanted.set(branchId, (wanted.get(branchId) ?? new Set()).add(o.variantId));
    }
  }
  const moved = new Map<string, Set<string>>();
  for (const [branchId, ids] of wanted)
    moved.set(branchId, await variantsWithMovements(tx, branchId, [...ids]));
  for (const o of pendingOpenings) {
    const stock = new Map<string, number>();
    for (const [branchId, qty] of o.parsed.stock) {
      if (moved.get(branchId)?.has(o.variantId)) {
        results.note(o.parsed.line, 'لم تُضف الكمية الافتتاحية: للصنف حركة مخزون سابقة في هذا الفرع');
      } else stock.set(branchId, qty);
    }
    if (stock.size === 0) continue;
    if (o.parsed.costMinor === null) results.note(o.parsed.line, 'لا تكلفة في الصف: يدخل المخزون بقيمة صفر');
    if (results.statusOf(o.parsed.line) === 'skip')
      results.set(o.parsed.line, 'update', ['تُضاف الكمية الافتتاحية فقط']);
    openings.push({
      line: o.parsed.line,
      variantId: o.variantId,
      name: o.name,
      stock,
      costMinor: o.parsed.costMinor,
      lots: o.parsed.lots,
    });
  }
}
