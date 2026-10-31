import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  INTERNAL_BARCODE_PREFIX,
  LIST_MAX_LIMIT,
  normalizeArabic,
  type BarcodeKind,
  type BarcodeLookupResponse,
  type BarcodeView,
  type CreateProductData,
  type CurrencyCode,
  type ProductDetail,
  type ProductListItem,
  type ProductListResponse,
  type ProductStatus,
  type ProductType,
  type UpdateProductData,
  type VariantDetail,
  type barcodeInputSchema,
  type productListQuery,
} from '@serva/core';
import {
  barcodes,
  branches,
  categories,
  prices,
  products,
  stockLevels,
  taxRates,
  units,
  variants,
  withTenant,
  type AttributeValue,
  type Database,
  type Transaction,
} from '@serva/db';
import type { z } from 'zod';
import { AppError, isUniqueViolation } from '../../errors';
import { audit } from '../audit';
import {
  diff,
  fieldError,
  iso,
  notFound,
  requireCatalogManager,
  requireCatalogReader,
  staleVersion,
  type CatalogContext,
} from './common';
import { liveReference } from './reference';

type BarcodeData = z.output<typeof barcodeInputSchema>;
type ListQuery = z.output<typeof productListQuery>;

const productNotFound = () => notFound('هذا المنتج غير موجود.');

/** What the server searches: the names in the one normalized form (15 › البحث في الأصناف). */
export const searchNameOf = (nameAr: string, nameEn: string | null) =>
  normalizeArabic([nameAr, nameEn ?? ''].join(' '));

/** «أبيض · 1.7 لتر» from the attribute values; null for the hidden variant of a simple product. */
export const labelOf = (attributes: AttributeValue[]) =>
  attributes.length > 0 ? attributes.map((a) => a.value).join(' · ') : null;

// ─── Reading ─────────────────────────────────────────────────────────────────

/** GET /v1/products/{id}, and the answer of every write. No cost (phase 2, behind cost.view). */
export async function productDetail(tx: Transaction, id: string): Promise<ProductDetail> {
  const [product] = await tx.select().from(products).where(eq(products.id, id));
  if (!product) throw productNotFound();
  const variantRows = await tx
    .select({ variant: variants, price: prices })
    .from(variants)
    .innerJoin(prices, and(eq(prices.tenantId, variants.tenantId), eq(prices.id, variants.id)))
    .where(eq(variants.productId, id))
    .orderBy(asc(variants.sortOrder), asc(variants.id));
  const ids = variantRows.map((r) => r.variant.id);
  const barcodeRows =
    ids.length > 0
      ? await tx
          .select()
          .from(barcodes)
          .where(inArray(barcodes.variantId, ids))
          .orderBy(asc(barcodes.createdAt), asc(barcodes.id))
      : [];
  const branchRows = await tx
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(asc(branches.code));
  const stockRows =
    ids.length > 0 ? await tx.select().from(stockLevels).where(inArray(stockLevels.variantId, ids)) : [];

  const variantViews: VariantDetail[] = variantRows.map(({ variant, price }) => ({
    id: variant.id,
    sku: variant.sku,
    label: variant.label,
    attributes: variant.attributes,
    price: { currency: price.currency as CurrencyCode, priceMinor: price.priceMinor },
    minPriceMinor: price.minPriceMinor,
    minStockQty: variant.minStockQty,
    priceChangedAt: price.priceChangedAt.toISOString(),
    archivedAt: iso(variant.archivedAt),
    barcodes: barcodeRows.filter((b) => b.variantId === variant.id).map(barcodeView),
    stock: branchRows.map((branch) => {
      const level = stockRows.find((s) => s.variantId === variant.id && s.branchId === branch.id);
      return {
        branchId: branch.id,
        branchName: branch.name,
        qty: level?.qty ?? 0,
        reservedQty: level?.reservedQty ?? 0,
      };
    }),
  }));
  return {
    id: product.id,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    categoryId: product.categoryId,
    brand: product.brand,
    type: product.type as ProductType,
    status: product.status as ProductStatus,
    unitId: product.unitId,
    taxRateId: product.taxRateId,
    sellOnPos: product.sellOnPos,
    archivedAt: iso(product.archivedAt),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    version: product.version,
    variants: variantViews,
  };
}

const barcodeView = (b: typeof barcodes.$inferSelect): BarcodeView => ({
  id: b.id,
  code: b.code,
  kind: b.kind as BarcodeKind,
  packQty: b.packQty,
  packName: b.packName,
  packPriceMinor: b.packPriceMinor,
});

export async function getProduct(db: Database, id: string, ctx: CatalogContext): Promise<ProductDetail> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    return productDetail(tx, id);
  });
}

/** GET /v1/barcodes/{code}: Arabic digits are read as Latin, spaces dropped (as barcodeCodeSchema). */
export async function lookupBarcode(
  db: Database,
  code: string,
  ctx: CatalogContext,
): Promise<BarcodeLookupResponse> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const [row] = await tx
      .select({ barcode: barcodes, productId: variants.productId })
      .from(barcodes)
      .innerJoin(variants, and(eq(variants.tenantId, barcodes.tenantId), eq(variants.id, barcodes.variantId)))
      .where(eq(barcodes.code, code));
    if (!row) throw notFound('لا يوجد منتج بهذا الباركود.');
    return { productId: row.productId, variantId: row.barcode.variantId, barcode: barcodeView(row.barcode) };
  });
}

interface ListRow extends Record<string, unknown> {
  id: string;
  name_ar: string;
  name_en: string | null;
  category_id: string | null;
  category_name: string | null;
  type: ProductType;
  status: ProductStatus;
  archived_at: string | null;
  version: number;
  variant_count: number;
  single_variant_id: string | null;
  currencies: number;
  currency: CurrencyCode | null;
  min_price: string | null;
  max_price: string | null;
  barcode: string | null;
  stock_qty: string;
}

const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id]), 'utf8').toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      /^[0-9a-f-]{36}$/.test(value[1])
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // Falls through to the error below.
  }
  throw fieldError('cursor', 'رابط الصفحة التالية غير صالح. ابدأ من الصفحة الأولى.');
}

/** LIKE wildcards in what was typed are matched literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * GET /v1/products: by name (A→Z, then id), `q` on the normalized name or an exact barcode, keyset
 * pages. Prices, the first barcode and stock are over live variants.
 */
export async function listProducts(
  db: Database,
  query: ListQuery,
  ctx: CatalogContext,
): Promise<ProductListResponse> {
  const limit = Math.min(query.limit, LIST_MAX_LIMIT);
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const filters: SQL[] = [sql`p.tenant_id = ${ctx.auth.tenantId}`];
    if (query.status === 'archived') filters.push(sql`p.archived_at is not null`);
    else filters.push(sql`p.archived_at is null and p.status = ${query.status}`);
    if (query.categoryId) filters.push(sql`p.category_id = ${query.categoryId}`);
    if (query.q) {
      const name = normalizeArabic(query.q);
      const code = query.q.replace(/\s+/g, '');
      const byBarcode = sql`exists (
        select 1 from barcodes b join variants bv on bv.tenant_id = b.tenant_id and bv.id = b.variant_id
        where b.tenant_id = p.tenant_id and b.code = ${code} and bv.product_id = p.id)`;
      filters.push(
        name ? sql`(p.search_name like ${`%${escapeLike(name)}%`} escape '\\' or ${byBarcode})` : byBarcode,
      );
    }
    if (query.cursor) {
      const [name, id] = decodeCursor(query.cursor);
      filters.push(sql`(p.name_ar, p.id) > (${name}, ${id}::uuid)`);
    }
    const branchFilter = query.branchId ? sql`and s.branch_id = ${query.branchId}` : sql``;
    const rows = await tx.execute<ListRow>(sql`
      select p.id, p.name_ar, p.name_en, p.category_id, c.name as category_name, p.type, p.status,
             p.archived_at, p.version,
             lv.variant_count, lv.single_variant_id,
             pr.currencies, pr.currency, pr.min_price::text, pr.max_price::text,
             (select b.code from variants v join barcodes b on b.tenant_id = v.tenant_id and b.variant_id = v.id
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
              order by v.sort_order, v.id, b.created_at, b.id limit 1) as barcode,
             (select coalesce(sum(s.qty), 0)::text from variants v
              join stock_levels s on s.tenant_id = v.tenant_id and s.variant_id = v.id ${branchFilter}
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null) as stock_qty
      from products p
      left join categories c on c.tenant_id = p.tenant_id and c.id = p.category_id
      cross join lateral (
        select count(*)::int as variant_count,
               case when count(*) = 1 then min(v.id::text) end as single_variant_id
        from variants v where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
      ) lv
      cross join lateral (
        select count(distinct x.currency)::int as currencies, min(x.currency) as currency,
               min(x.price_minor) as min_price, max(x.price_minor) as max_price
        from variants v join prices x on x.tenant_id = v.tenant_id and x.id = v.id
        where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
      ) pr
      where ${sql.join(filters, sql` and `)}
      order by p.name_ar, p.id
      limit ${limit + 1}`);
    const page = rows.slice(0, limit);
    const items: ProductListItem[] = page.map((r) => ({
      id: r.id,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      categoryId: r.category_id,
      categoryName: r.category_name,
      type: r.type,
      status: r.status,
      archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
      variantCount: r.variant_count,
      singleVariantId: r.single_variant_id,
      price:
        r.currencies === 1 && r.currency
          ? { currency: r.currency, minMinor: Number(r.min_price), maxMinor: Number(r.max_price) }
          : null,
      barcode: r.barcode,
      stockQty: Number(r.stock_qty),
      version: r.version,
    }));
    const last = page.at(-1);
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.name_ar, last.id) : null };
  });
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** References a product makes must exist and be live; the unit defaults to the store's «قطعة». */
async function checkReferences(
  tx: Transaction,
  input: { categoryId?: string | null; unitId?: string; taxRateId?: string | null },
): Promise<void> {
  if (input.categoryId && !(await liveReference(tx, categories, input.categoryId))) {
    throw fieldError('categoryId', 'التصنيف غير موجود أو مؤرشف');
  }
  if (input.unitId && !(await liveReference(tx, units, input.unitId))) {
    throw fieldError('unitId', 'الوحدة غير موجودة أو مؤرشفة');
  }
  if (input.taxRateId && !(await liveReference(tx, taxRates, input.taxRateId))) {
    throw fieldError('taxRateId', 'الضريبة غير موجودة أو مؤرشفة');
  }
}

async function pieceUnit(tx: Transaction): Promise<string> {
  const [unit] = await tx.select({ id: units.id }).from(units).where(eq(units.systemKey, 'piece'));
  if (!unit) throw new AppError(500, 'internal', 'وحدة «قطعة» غير موجودة في هذا المتجر.');
  return unit.id;
}

interface BarcodeWrite {
  /** Dotted path of the code in the request, for the error */
  path: string;
  variantIndex: number;
  data: BarcodeData;
}

/**
 * Barcodes are unique in the store (17). A code already held by a barcode this request does not
 * replace answers validation_failed on that code, naming the product that holds it.
 */
async function checkBarcodesFree(tx: Transaction, writes: BarcodeWrite[], replacedVariantIds: string[]) {
  const coded = writes.filter((w) => w.data.code !== undefined);
  if (coded.length === 0) return;
  const holders = await tx
    .select({ code: barcodes.code, productName: products.nameAr })
    .from(barcodes)
    .innerJoin(variants, and(eq(variants.tenantId, barcodes.tenantId), eq(variants.id, barcodes.variantId)))
    .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
    .where(
      and(
        inArray(
          barcodes.code,
          coded.map((w) => w.data.code!),
        ),
        replacedVariantIds.length > 0 ? notInArray(barcodes.variantId, replacedVariantIds) : undefined,
      ),
    );
  const held = holders[0];
  if (held) {
    const write = coded.find((w) => w.data.code === held.code)!;
    throw fieldError(write.path, `الباركود ${held.code} مستخدم في المنتج «${held.productName}»`);
  }
}

/** EAN-13 check digit of 12 digits. */
export function ean13CheckDigit(digits12: string): number {
  const sum = [...digits12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * The next internal barcodes of the store (contract: EAN-13 with prefix 29, «ولّد باركوداً داخلياً»):
 * 29 + a 10-digit counter + the check digit, above every 29… code already in the store.
 */
async function internalBarcodes(tx: Transaction, tenantId: string, count: number): Promise<string[]> {
  if (count === 0) return [];
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`barcode:internal:${tenantId}`}, 0))`);
  const [row] = await tx.execute<{ last: string | null }>(sql`
    select max(substr(code, 3, 10)::bigint)::text as last from barcodes
    where tenant_id = ${tenantId} and code ~ ${`^${INTERNAL_BARCODE_PREFIX}[0-9]{11}$`}`);
  let next = BigInt(row?.last ?? '0') + 1n;
  const codes: string[] = [];
  for (let i = 0; i < count; i++, next++) {
    const body = `${INTERNAL_BARCODE_PREFIX}${next.toString().padStart(10, '0')}`;
    if (body.length !== 12) throw new AppError(409, 'conflict', 'نفدت الباركودات الداخلية لهذا المتجر.');
    codes.push(`${body}${ean13CheckDigit(body)}`);
  }
  return codes;
}

/** Writes a variant's barcodes: kept ones are updated, new ones inserted, internal ones numbered. */
async function writeBarcodes(
  tx: Transaction,
  tenantId: string,
  variantId: string,
  list: BarcodeData[],
  generated: string[],
): Promise<void> {
  const current = await tx.select().from(barcodes).where(eq(barcodes.variantId, variantId));
  const keep = new Set(list.flatMap((b) => (b.id ? [b.id] : [])));
  const removed = current.filter((b) => !keep.has(b.id)).map((b) => b.id);
  if (removed.length > 0) await tx.delete(barcodes).where(inArray(barcodes.id, removed));
  for (const b of list) {
    const code = b.code ?? generated.shift()!;
    const values = {
      code,
      kind: b.kind,
      packQty: b.packQty,
      packName: b.packName,
      packPriceMinor: b.packPriceMinor,
    };
    const existing = b.id ? current.find((c) => c.id === b.id) : undefined;
    if (b.id && !existing) throw fieldError('variants', 'باركود غير موجود في هذا المتغير');
    if (existing) {
      const changed = diff(existing, values);
      if (Object.keys(changed).length > 0)
        await tx.update(barcodes).set(values).where(eq(barcodes.id, b.id!));
    } else {
      await tx.insert(barcodes).values({ tenantId, variantId, ...values });
    }
  }
}

/** Two live variants never share their options, and with more than one each needs options. */
async function checkLiveVariants(tx: Transaction, productId: string): Promise<void> {
  const live = await tx
    .select({ attributes: variants.attributes })
    .from(variants)
    .where(and(eq(variants.productId, productId), isNull(variants.archivedAt)));
  if (live.length === 0) throw fieldError('variants', 'يبقى للمنتج سعر واحد على الأقل');
  if (live.length === 1) return;
  const keys = live.map((v) => JSON.stringify(v.attributes.map((a) => [a.name, a.value])));
  if (live.some((v) => v.attributes.length === 0)) throw fieldError('variants', 'اختر المقاس أو اللون');
  if (new Set(keys).size !== keys.length) throw fieldError('variants', 'هذا المتغير مكرر');
}

const barcodeConflict = () =>
  fieldError('variants', 'أحد الباركودات أُضيف لمنتج آخر في اللحظة نفسها. حدّث الصفحة وأعد المحاولة.');

/** POST /v1/products: the product with its variants, prices and barcodes in one transaction. */
export async function createProduct(
  db: Database,
  input: CreateProductData,
  ctx: CatalogContext,
): Promise<ProductDetail> {
  const { tenantId } = ctx.auth;
  try {
    return await withTenant(db, tenantId, async (tx) => {
      await requireCatalogManager(tx, ctx.auth.userId);
      await checkReferences(tx, input);
      const writes: BarcodeWrite[] = input.variants.flatMap((v, i) =>
        v.barcodes.map((data, b) => ({ path: `variants.${i}.barcodes.${b}.code`, variantIndex: i, data })),
      );
      await checkBarcodesFree(tx, writes, []);
      const generated = await internalBarcodes(
        tx,
        tenantId,
        writes.filter((w) => w.data.code === undefined).length,
      );
      const [product] = await tx
        .insert(products)
        .values({
          tenantId,
          nameAr: input.nameAr,
          nameEn: input.nameEn,
          searchName: searchNameOf(input.nameAr, input.nameEn),
          categoryId: input.categoryId,
          brand: input.brand,
          type: input.type,
          unitId: input.unitId ?? (await pieceUnit(tx)),
          taxRateId: input.taxRateId,
          sellOnPos: input.sellOnPos,
        })
        .returning({ id: products.id });
      const productId = product!.id;
      for (const [i, v] of input.variants.entries()) {
        const [variant] = await tx
          .insert(variants)
          .values({
            tenantId,
            productId,
            sku: v.sku,
            label: labelOf(v.attributes),
            attributes: v.attributes,
            sortOrder: i,
            minStockQty: v.minStockQty,
          })
          .returning({ id: variants.id });
        await tx.insert(prices).values({
          tenantId,
          id: variant!.id,
          currency: v.price.currency,
          priceMinor: v.price.priceMinor,
          minPriceMinor: v.minPriceMinor,
          priceChangedAt: ctx.now,
        });
        await writeBarcodes(tx, tenantId, variant!.id, v.barcodes, generated);
      }
      const detail = await productDetail(tx, productId);
      await audit(
        tx,
        {
          tenantId,
          userId: ctx.auth.userId,
          action: 'product.created',
          entity: 'product',
          entityId: productId,
          data: { nameAr: input.nameAr, variants: detail.variants.length },
        },
        ctx.meta,
      );
      return detail;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'barcodes_code_unique')) throw barcodeConflict();
    throw error;
  }
}

/**
 * PATCH /v1/products/{id}: only the fields sent change; `variants` lists only the variants to
 * change or add. The product's version moves with any change to it or its variants.
 */
export async function updateProduct(
  db: Database,
  id: string,
  input: UpdateProductData,
  ctx: CatalogContext,
): Promise<ProductDetail> {
  const { tenantId } = ctx.auth;
  try {
    return await withTenant(db, tenantId, async (tx) => {
      await requireCatalogManager(tx, ctx.auth.userId);
      const [current] = await tx.select().from(products).where(eq(products.id, id)).for('update');
      if (!current) throw productNotFound();
      if (current.version !== input.version) throw staleVersion();
      await checkReferences(tx, input);

      const existing = await tx
        .select({ variant: variants, price: prices })
        .from(variants)
        .innerJoin(prices, and(eq(prices.tenantId, variants.tenantId), eq(prices.id, variants.id)))
        .where(eq(variants.productId, id));
      const variantInput = input.variants ?? [];
      variantInput.forEach((v, i) => {
        if (v.id && !existing.some((e) => e.variant.id === v.id)) {
          throw fieldError(`variants.${i}.id`, 'هذا المتغير ليس من هذا المنتج');
        }
      });
      const writes: BarcodeWrite[] = variantInput.flatMap((v, i) =>
        (v.barcodes ?? []).map((data, b) => ({
          path: `variants.${i}.barcodes.${b}.code`,
          variantIndex: i,
          data,
        })),
      );
      const replaced = variantInput.flatMap((v) => (v.id && v.barcodes ? [v.id] : []));
      await checkBarcodesFree(tx, writes, replaced);
      const generated = await internalBarcodes(
        tx,
        tenantId,
        writes.filter((w) => w.data.code === undefined).length,
      );

      const nameAr = input.nameAr ?? current.nameAr;
      const nameEn = input.nameEn === undefined ? current.nameEn : input.nameEn;
      const next = {
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        categoryId: input.categoryId,
        brand: input.brand,
        type: input.type,
        unitId: input.unitId,
        taxRateId: input.taxRateId,
        sellOnPos: input.sellOnPos,
      };
      await tx
        .update(products)
        .set({ ...next, searchName: searchNameOf(nameAr, nameEn), updatedAt: ctx.now })
        .where(eq(products.id, id));

      // Barcodes dropped from any variant go first, so a code can move between variants at once.
      for (const v of variantInput) {
        if (!v.id || !v.barcodes) continue;
        const keep = v.barcodes.flatMap((b) => (b.id ? [b.id] : []));
        await tx
          .delete(barcodes)
          .where(
            and(eq(barcodes.variantId, v.id), keep.length > 0 ? notInArray(barcodes.id, keep) : undefined),
          );
      }

      const variantChanges: Record<string, unknown>[] = [];
      let sortOrder = Math.max(-1, ...existing.map((e) => e.variant.sortOrder)) + 1;
      for (const v of variantInput) {
        const before = existing.find((e) => e.variant.id === v.id);
        let variantId: string;
        if (before) {
          variantId = before.variant.id;
          const variantNext = {
            sku: v.sku,
            attributes: v.attributes,
            label: v.attributes ? labelOf(v.attributes) : undefined,
            minStockQty: v.minStockQty,
            archivedAt:
              v.archived === undefined
                ? undefined
                : v.archived
                  ? (before.variant.archivedAt ?? ctx.now)
                  : null,
          };
          const variantDiff = diff(before.variant, variantNext);
          if (Object.keys(variantDiff).length > 0) {
            await tx.update(variants).set(variantNext).where(eq(variants.id, variantId));
          }
          const priceNext = {
            currency: v.price?.currency,
            priceMinor: v.price?.priceMinor,
            minPriceMinor: v.minPriceMinor,
          };
          const priceDiff = diff(before.price, priceNext);
          if (Object.keys(priceDiff).length > 0) {
            const moved = 'currency' in priceDiff || 'priceMinor' in priceDiff;
            await tx
              .update(prices)
              .set({ ...priceNext, ...(moved ? { priceChangedAt: ctx.now } : {}) })
              .where(eq(prices.id, variantId));
          }
          variantChanges.push({ id: variantId, ...variantDiff, ...priceDiff });
        } else {
          const attributes = v.attributes ?? [];
          const [created] = await tx
            .insert(variants)
            .values({
              tenantId,
              productId: id,
              sku: v.sku ?? null,
              label: labelOf(attributes),
              attributes,
              sortOrder: sortOrder++,
              minStockQty: v.minStockQty ?? null,
              archivedAt: v.archived ? ctx.now : null,
            })
            .returning({ id: variants.id });
          variantId = created!.id;
          await tx.insert(prices).values({
            tenantId,
            id: variantId,
            currency: v.price!.currency,
            priceMinor: v.price!.priceMinor,
            minPriceMinor: v.minPriceMinor ?? null,
            priceChangedAt: ctx.now,
          });
          variantChanges.push({ id: variantId, created: true });
        }
        if (v.barcodes) await writeBarcodes(tx, tenantId, variantId, v.barcodes, generated);
      }
      if (input.variants) await checkLiveVariants(tx, id);

      await audit(
        tx,
        {
          tenantId,
          userId: ctx.auth.userId,
          action: 'product.updated',
          entity: 'product',
          entityId: id,
          changes: diff(current, next),
          ...(variantChanges.length > 0 ? { data: { variants: variantChanges } } : {}),
        },
        ctx.meta,
      );
      return productDetail(tx, id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'barcodes_code_unique')) throw barcodeConflict();
    throw error;
  }
}

/** POST /v1/products/{id}/archive and /restore. Archived products stay in the pull, flagged. */
export async function setProductArchived(
  db: Database,
  id: string,
  archived: boolean,
  ctx: CatalogContext,
): Promise<ProductDetail> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogManager(tx, ctx.auth.userId);
    const [current] = await tx.select().from(products).where(eq(products.id, id)).for('update');
    if (!current) throw productNotFound();
    if (archived !== (current.archivedAt !== null)) {
      await tx
        .update(products)
        .set({ archivedAt: archived ? ctx.now : null })
        .where(eq(products.id, id));
      await audit(
        tx,
        {
          tenantId: ctx.auth.tenantId,
          userId: ctx.auth.userId,
          action: archived ? 'product.archived' : 'product.restored',
          entity: 'product',
          entityId: id,
          changes: { archivedAt: [iso(current.archivedAt), archived ? ctx.now.toISOString() : null] },
        },
        ctx.meta,
      );
    }
    return productDetail(tx, id);
  });
}
