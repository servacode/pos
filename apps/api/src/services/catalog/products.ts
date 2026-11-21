import { permissionScope } from '../../auth/permissions';
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
  type ArchiveImpactResponse,
  type ProductDetail,
  type ProductListItem,
  type OptionValuesResponse,
  type ProductListResponse,
  type ProductListTotals,
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
import { createUuidV7 } from '@serva/sync';
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
import { imageUrl } from './images';
import { reservedByBranch } from '../reservations';
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
    .where(and(eq(branches.isActive, true), eq(branches.kind, 'store')))
    .orderBy(asc(branches.code));
  const stockRows =
    ids.length > 0 ? await tx.select().from(stockLevels).where(inArray(stockLevels.variantId, ids)) : [];

  // Decision 14: what holds and accepted orders reserve per branch (derived, nothing is written to stock)
  const reserved = await reservedByBranch(tx, ids, branchRows[0]?.id ?? null);
  const variantViews: VariantDetail[] = variantRows.map(({ variant, price }) => ({
    id: variant.id,
    sku: variant.sku,
    label: variant.label,
    attributes: variant.attributes,
    price: { currency: price.currency as CurrencyCode, priceMinor: price.priceMinor },
    minPriceMinor: price.minPriceMinor,
    wholesalePriceMinor: price.wholesalePriceMinor,
    wasPriceMinor:
      price.wasPriceMinor !== null && price.wasPriceMinor > price.priceMinor ? price.wasPriceMinor : null,
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
        reservedQty: (level?.reservedQty ?? 0) + (reserved.get(`${branch.id}|${variant.id}`) ?? 0),
      };
    }),
  }));
  return {
    id: product.id,
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    categoryId: product.categoryId,
    brand: product.brand,
    season: product.season,
    genericName: product.genericName,
    strength: product.strength,
    dosageForm: product.dosageForm,
    requiresPrescription: product.requiresPrescription,
    requiresExpiry: product.requiresExpiry,
    controlled: product.controlled,
    tracksSerial: product.tracksSerial,
    rentable: product.rentable,
    warrantyMonths: product.warrantyMonths,
    type: product.type as ProductType,
    status: product.status as ProductStatus,
    unitId: product.unitId,
    taxRateId: product.taxRateId,
    sellOnPos: product.sellOnPos,
    modifiers: product.modifiers,
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
  packWholesaleMinor: b.packWholesaleMinor,
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
  /** A code nobody has is an answer, not an error (the product form asks for every new code) */
  soft = false,
): Promise<BarcodeLookupResponse | { exists: false }> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const [row] = await tx
      .select({ barcode: barcodes, productId: variants.productId })
      .from(barcodes)
      .innerJoin(variants, and(eq(variants.tenantId, barcodes.tenantId), eq(variants.id, barcodes.variantId)))
      .where(eq(barcodes.code, code));
    if (!row && soft) return { exists: false as const };
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
  season: string | null;
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
  sellable_qty: string;
  has_image: boolean;
  image_upload: string | null;
  nearest_expiry: string | null;
  unit_name?: string | null;
  wh_min?: string | null;
  wh_max?: string | null;
  cost_qty?: string | null;
  cost_value?: string | null;
}

const encodeCursor = (name: string, id: string, stock?: string) =>
  Buffer.from(JSON.stringify(stock === undefined ? [name, id] : [name, id, stock]), 'utf8').toString(
    'base64url',
  );

function decodeCursor(cursor: string): [string, string, string?] {
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
    if (
      Array.isArray(value) &&
      value.length === 3 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string' &&
      /^[0-9a-f-]{36}$/.test(value[1]) &&
      /^-?\d{1,18}$/.test(value[2])
    ) {
      return [value[0], value[1], value[2]];
    }
  } catch {
    // Falls through to the error below.
  }
  throw fieldError('cursor', 'رابط الصفحة التالية غير صالح. ابدأ من الصفحة الأولى.');
}

/** LIKE wildcards in what was typed are matched literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The one stock count of the store (the products tiles, the inventory page and the dashboard say the same):
 * pieces = what sits on the shelf, a piece below zero counted as 0; a combination (variant) is «نفد» at 0 or
 * less and «ناقص» below 0. Over live variants of live stocked products, all branches.
 */
async function storeTotals(tx: Transaction, tenantId: string): Promise<ProductListTotals> {
  const [row] = await tx.execute<{
    products: number;
    variants: number;
    pieces: string;
    negative: number;
    run_out: number;
    run_out_products: number;
  }>(sql`
    with per_variant as (
      select v.id, p.id as pid, p.type, coalesce((select sum(s.qty) from stock_levels s
        where s.tenant_id = v.tenant_id and s.variant_id = v.id), 0) as q
      from products p join variants v on v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
      where p.tenant_id = ${tenantId} and p.archived_at is null and p.status = 'active')
    select (select count(*)::int from products p
             where p.tenant_id = ${tenantId} and p.archived_at is null and p.status = 'active') as products,
           (count(*) filter (where type = 'stock'))::int as variants,
           coalesce(sum(greatest(q, 0)) filter (where type = 'stock'), 0)::text as pieces,
           (count(*) filter (where type = 'stock' and q < 0))::int as negative,
           (count(*) filter (where type = 'stock' and q <= 0))::int as run_out,
           (count(distinct pid) filter (where type = 'stock' and q <= 0))::int as run_out_products
    from per_variant`);
  const [lowest] = await tx.execute<{ name_ar: string; q: string }>(sql`
    select p.name_ar, t.q::text as q from (
      select v.product_id, coalesce(sum(s.qty), 0) as q
      from variants v left join stock_levels s on s.tenant_id = v.tenant_id and s.variant_id = v.id
      where v.tenant_id = ${tenantId} and v.archived_at is null
      group by v.product_id) t
    join products p on p.tenant_id = ${tenantId} and p.id = t.product_id
    where p.type = 'stock' and p.archived_at is null and p.status = 'active'
    order by t.q, p.name_ar limit 1`);
  return {
    products: row?.products ?? 0,
    variants: row?.variants ?? 0,
    pieces: Number(row?.pieces ?? 0),
    negative: row?.negative ?? 0,
    runOut: row?.run_out ?? 0,
    runOutProducts: row?.run_out_products ?? 0,
    lowest: lowest ? { nameAr: lowest.name_ar, qty: Number(lowest.q) } : null,
  };
}

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
    // The store's own day, not the database server's (a Damascus night is still «yesterday» in UTC)
    const [dayRow] = await tx.execute<{ today: string }>(
      sql`select (now() at time zone coalesce((select timezone from tenants limit 1), 'UTC'))::date::text as today`,
    );
    const today = dayRow?.today ?? new Date().toISOString().slice(0, 10);
    const filters: SQL[] = [sql`p.tenant_id = ${ctx.auth.tenantId}`];
    if (query.status === 'archived') filters.push(sql`p.archived_at is not null`);
    else filters.push(sql`p.archived_at is null and p.status = ${query.status}`);
    if (query.categoryId) filters.push(sql`p.category_id = ${query.categoryId}`);
    if (query.season) filters.push(sql`p.season = ${query.season}`);
    if (query.q) {
      const name = normalizeArabic(query.q);
      const code = query.q.replace(/\s+/g, '');
      const byBarcode = sql`exists (
        select 1 from barcodes b join variants bv on bv.tenant_id = b.tenant_id and bv.id = b.variant_id
        where b.tenant_id = p.tenant_id and lower(b.code) = ${code.toLowerCase()} and bv.product_id = p.id)`;
      const raw = `%${escapeLike(query.q.trim().toLowerCase())}%`;
      filters.push(
        name
          ? sql`(p.search_name like ${`%${escapeLike(name)}%`} escape '\\' or ${byBarcode}
              or lower(coalesce(p.brand, '')) like ${raw} escape '\\'
              or lower(coalesce(p.generic_name, '')) like ${raw} escape '\\'
              or exists (select 1 from variants sv where sv.tenant_id = p.tenant_id and sv.product_id = p.id
                         and lower(coalesce(sv.sku, '')) = ${code.toLowerCase()}))`
          : byBarcode,
      );
    }
    if (query.expiry) {
      // A piece's nearest expiry is the earliest date among the batches still holding stock
      const window =
        query.expiry === 'expired'
          ? sql`v.nearest_expiry < ${today}::date`
          : sql`v.nearest_expiry >= ${today}::date and v.nearest_expiry <= ${today}::date + 30`;
      filters.push(sql`exists (
        select 1 from variants v
        where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null and ${window})`);
    }
    const branchFilter = query.branchId ? sql`and s.branch_id = ${query.branchId}` : sql``;
    // The net quantity of a product over its live variants, all branches (a minus counts as a minus)
    const netStock = sql`(select coalesce(sum(s.qty), 0) from variants nv
      join stock_levels s on s.tenant_id = nv.tenant_id and s.variant_id = nv.id ${branchFilter}
      where nv.tenant_id = p.tenant_id and nv.product_id = p.id and nv.archived_at is null)`;
    if (query.stock === 'out') filters.push(sql`p.type <> 'service' and ${netStock} <= 0`);
    const byStock = query.sort === 'stock';
    if (query.cursor) {
      const [name, id, stock] = decodeCursor(query.cursor);
      if (byStock && stock !== undefined) {
        filters.push(sql`(${netStock}, p.name_ar, p.id) > (${stock}::numeric, ${name}, ${id}::uuid)`);
      } else {
        filters.push(sql`(p.name_ar, p.id) > (${name}, ${id}::uuid)`);
      }
    }
    // The export's extra columns; the cost only for who may see costs
    const detail = query.detail === '1';
    const seesCost =
      (detail || query.cost === '1') &&
      (await permissionScope(tx, ctx.auth.userId, 'cost.view').then((x) => x.all || x.branchIds.size > 0));
    const detailCols = sql`${
      detail
        ? sql`,
             (select u.name from units u where u.id = p.unit_id) as unit_name,
             (select min(x.wholesale_price_minor)::text from variants v join prices x on x.tenant_id = v.tenant_id and x.id = v.id
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null) as wh_min,
             (select max(x.wholesale_price_minor)::text from variants v join prices x on x.tenant_id = v.tenant_id and x.id = v.id
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null) as wh_max`
        : sql``
    }${
      seesCost
        ? sql`,
             (select coalesce(sum(sv.qty), 0)::text from variants v join stock_values sv on sv.tenant_id = v.tenant_id and sv.variant_id = v.id
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null and sv.qty > 0) as cost_qty,
             (select coalesce(sum(sv.value_minor), 0)::text from variants v join stock_values sv on sv.tenant_id = v.tenant_id and sv.variant_id = v.id
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null and sv.qty > 0) as cost_value`
        : sql``
    }`;
    const movementBranch = query.branchId ? sql`and m.branch_id = ${query.branchId}` : sql``;
    const rows = await tx.execute<ListRow>(sql`
      select p.id, p.name_ar, p.name_en, p.category_id, c.name as category_name, p.season, p.type, p.status,
             p.archived_at, p.version,
             lv.variant_count, lv.single_variant_id,
             pr.currencies, pr.currency, pr.min_price::text, pr.max_price::text,
             (select b.code from variants v join barcodes b on b.tenant_id = v.tenant_id and b.variant_id = v.id
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
              order by v.sort_order, v.id, b.created_at, b.id limit 1) as barcode,
             (select coalesce(sum(s.qty), 0)::text from variants v
              join stock_levels s on s.tenant_id = v.tenant_id and s.variant_id = v.id ${branchFilter}
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null) as stock_qty,
             (select coalesce(sum(greatest(t.q - t.dead, 0)), 0)::text from (
                select sum(s.qty) as q,
                       (select coalesce(sum(bm.q), 0) from (
                          select m.batch_no, m.expiry_date, sum(m.qty) as q from batch_movements m
                          where m.tenant_id = v.tenant_id and m.variant_id = v.id ${movementBranch}
                          group by m.branch_id, m.batch_no, m.expiry_date having sum(m.qty) > 0) bm
                        where bm.expiry_date < ${today}::date
                           or exists (select 1 from batch_blocks bl
                                      where bl.tenant_id = v.tenant_id and bl.variant_id = v.id
                                        and bl.batch_no = bm.batch_no and bl.released_at is null)) as dead
                from variants v
                join stock_levels s on s.tenant_id = v.tenant_id and s.variant_id = v.id ${branchFilter}
                where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
                group by v.tenant_id, v.id) t) as sellable_qty,
             exists (select 1 from product_images pi
                     where pi.tenant_id = p.tenant_id and pi.product_id = p.id) as has_image,
             (select pi.upload_id::text from product_images pi
              where pi.tenant_id = p.tenant_id and pi.product_id = p.id
              order by pi.sort_order, pi.created_at, pi.id limit 1) as image_upload,
             (select min(v.nearest_expiry)::text from variants v
              where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null) as nearest_expiry
             ${detailCols}
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
      order by ${byStock ? sql`${netStock}, ` : sql``}p.name_ar, p.id
      limit ${limit + 1}`);
    const page = rows.slice(0, limit);
    const items: ProductListItem[] = page.map((r) => ({
      id: r.id,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      categoryId: r.category_id,
      categoryName: r.category_name,
      season: r.season,
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
      sellableQty: Number(r.sellable_qty),
      hasImage: r.has_image,
      thumbUrl: r.image_upload ? imageUrl(ctx.auth.tenantId, r.image_upload, true) : null,
      nearestExpiry: r.nearest_expiry,
      ...(detail
        ? {
            unitName: r.unit_name ?? null,
            wholesale:
              r.wh_min !== undefined && r.wh_min !== null && r.wh_max !== undefined && r.wh_max !== null
                ? { minMinor: Number(r.wh_min), maxMinor: Number(r.wh_max) }
                : null,
          }
        : {}),
      ...(seesCost
        ? {
            costMinor:
              r.cost_qty !== undefined && r.cost_qty !== null && Number(r.cost_qty) > 0
                ? Math.round((Number(r.cost_value) * 1000) / Number(r.cost_qty))
                : null,
          }
        : {}),
      version: r.version,
    }));
    const last = page.at(-1);
    // How many products each status filter holds, asked with the first page
    let statusCounts: { active: number; temporary: number; archived: number } | undefined;
    if (!query.cursor) {
      const [c] = await tx.execute<{ active: number; temporary: number; archived: number }>(sql`
        select count(*) filter (where archived_at is null and status = 'active')::int as active,
               count(*) filter (where archived_at is null and status = 'temporary')::int as temporary,
               count(*) filter (where archived_at is not null)::int as archived
        from products where tenant_id = ${ctx.auth.tenantId}`);
      if (c) statusCounts = c;
    }
    // What needs doing across the whole store (asked once, with the first page)
    let attention:
      { zeroPrice: number; noPhoto: number; expiringSoon: number; uncategorised: number } | undefined;
    // The whole-store figures do not depend on the search: asked only for the unfiltered first page
    const unfiltered = !query.q && !query.categoryId && !query.season && !query.expiry && !query.stock;
    if (!query.cursor && query.status === 'active' && unfiltered) {
      const [counts] = await tx.execute<{
        zero_price: number;
        no_photo: number;
        expiring_soon: number;
        uncategorised: number;
      }>(sql`
        select count(*) filter (where p.type <> 'service' and exists (
                 select 1 from variants v join prices x on x.tenant_id = v.tenant_id and x.id = v.id
                 where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
                   and x.price_minor = 0))::int as zero_price,
               count(*) filter (where p.type <> 'service' and not exists (
                 select 1 from product_images pi
                 where pi.tenant_id = p.tenant_id and pi.product_id = p.id))::int as no_photo,
               count(*) filter (where exists (
                 select 1 from variants v
                 where v.tenant_id = p.tenant_id and v.product_id = p.id and v.archived_at is null
                   and v.nearest_expiry >= ${today}::date and v.nearest_expiry <= ${today}::date + 30))::int as expiring_soon,
               count(*) filter (where p.category_id is null and p.type <> 'service')::int as uncategorised
        from products p
        where p.tenant_id = ${ctx.auth.tenantId} and p.archived_at is null and p.status = 'active'`);
      attention = {
        zeroPrice: counts?.zero_price ?? 0,
        noPhoto: counts?.no_photo ?? 0,
        expiringSoon: counts?.expiring_soon ?? 0,
        uncategorised: counts?.uncategorised ?? 0,
      };
    }
    // The tiles over the list count the whole store, whatever the search or the page shows (first page only)
    let totals: ProductListTotals | undefined;
    if (!query.cursor && query.status === 'active' && unfiltered)
      totals = await storeTotals(tx, ctx.auth.tenantId);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(
              last.name_ar,
              last.id,
              byStock ? String(Math.trunc(Number(last.stock_qty))) : undefined,
            )
          : null,
      ...(attention ? { attention } : {}),
      ...(totals ? { totals } : {}),
      ...(statusCounts ? { statusCounts } : {}),
    };
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

/** «السعر الأدنى للمفاصلة» above the shelf price would ask a manager code for every sale at the shelf price */
function checkFloor(path: string, priceMinor: number, floorMinor: number | null | undefined): void {
  if (floorMinor !== null && floorMinor !== undefined && Number(floorMinor) > priceMinor) {
    throw fieldError(path, 'السعر الأدنى للمفاصلة أعلى من سعر البيع. اجعله أقل أو يساويه.');
  }
}

/** Serial tracking, the kind or the unit of a product that holds stock cannot change under that stock */
async function checkKindChange(
  tx: Transaction,
  current: { id: string; tracksSerial: boolean; type: string; unitId: string },
  input: { tracksSerial?: boolean; type?: string; unitId?: string },
): Promise<void> {
  const serial = input.tracksSerial !== undefined && input.tracksSerial !== current.tracksSerial;
  const kind = input.type !== undefined && input.type !== current.type;
  const unit = input.unitId !== undefined && input.unitId !== current.unitId;
  if (!serial && !kind && !unit) return;
  const [held] = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from stock_levels s join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
    where v.product_id = ${current.id} and s.qty <> 0`);
  if ((held?.n ?? 0) === 0) return;
  const path = serial ? 'tracksSerial' : kind ? 'type' : 'unitId';
  throw fieldError(
    path,
    'لا يمكن تغيير هذا الخيار والمنتج فيه مخزون. صفّر المخزون أولاً أو أنشئ منتجاً جديداً.',
  );
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
    throw barcodeInUse(write.path, `الباركود ${held.code} مستخدم في المنتج «${held.productName}»`);
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
      packWholesaleMinor: b.packWholesaleMinor,
    };
    const existing = b.id ? current.find((c) => c.id === b.id) : undefined;
    if (b.id && !existing) throw fieldError('variants', 'باركود غير موجود في هذا المتغير');
    if (existing) {
      const changed = diff(existing, values);
      if (Object.keys(changed).length > 0)
        await tx.update(barcodes).set(values).where(eq(barcodes.id, b.id!));
    } else {
      await tx.insert(barcodes).values({ id: nextBarcodeId(), tenantId, variantId, ...values });
    }
  }
}

/**
 * Barcode ids from a generator that only goes up, even within one millisecond: a variant's
 * barcodes are read back by (created_at, id), and the ones saved in one transaction share
 * created_at, so the id alone must keep the order they were entered in. The database's own
 * uuid_generate_v7() is random within a millisecond, which shuffled them now and then.
 */
const nextBarcodeId = createUuidV7();

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

/** 409 conflict on one barcode field: nothing of the request is saved (the form marks that field). */
export function barcodeInUse(path: string, message: string): AppError {
  const top = path.split('.')[0]!;
  return new AppError(409, 'conflict', message, {
    [top]: message,
    ...(top === path ? {} : { [path]: message }),
  });
}

export const barcodeConflict = () =>
  barcodeInUse('variants', 'أحد الباركودات أُضيف لمنتج آخر في اللحظة نفسها. حدّث الصفحة وأعد المحاولة.');

/** POST /v1/products: the product with its variants, prices and barcodes in one transaction. */
export async function createProduct(
  db: Database,
  input: CreateProductData,
  ctx: CatalogContext,
): Promise<ProductDetail> {
  try {
    return await withTenant(db, ctx.auth.tenantId, async (tx) => {
      await requireCatalogManager(tx, ctx.auth.userId);
      return createProductTx(tx, input, ctx);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'barcodes_code_unique')) throw barcodeConflict();
    throw error;
  }
}

/**
 * The write of createProduct inside the caller's transaction, for the import: the caller has checked
 * catalog.manage once and turns a barcodes_code_unique violation into its row's message itself.
 */
export async function createProductTx(
  tx: Transaction,
  input: CreateProductData,
  ctx: CatalogContext,
  /** Round 38: ids a till already sold the product under (a product made there offline); left out, the database gives them */
  ids?: { productId: string; variantIds: readonly string[] },
): Promise<ProductDetail> {
  const { tenantId } = ctx.auth;
  await checkReferences(tx, input);
  input.variants.forEach((v, i) =>
    checkFloor(`variants.${i}.minPriceMinor`, v.price.priceMinor, v.minPriceMinor),
  );
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
      ...(ids ? { id: ids.productId } : {}),
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      searchName: searchNameOf(input.nameAr, input.nameEn),
      categoryId: input.categoryId,
      brand: input.brand,
      season: input.season,
      genericName: input.genericName,
      strength: input.strength,
      dosageForm: input.dosageForm,
      requiresPrescription: input.requiresPrescription,
      requiresExpiry: input.requiresExpiry,
      controlled: input.controlled,
      tracksSerial: input.tracksSerial,
      rentable: input.rentable,
      warrantyMonths: input.warrantyMonths,
      type: input.type,
      unitId: input.unitId ?? (await pieceUnit(tx)),
      taxRateId: input.taxRateId,
      sellOnPos: input.sellOnPos,
      modifiers: input.modifiers,
    })
    .returning({ id: products.id });
  const productId = product!.id;
  for (const [i, v] of input.variants.entries()) {
    const [variant] = await tx
      .insert(variants)
      .values({
        tenantId,
        ...(ids?.variantIds[i] ? { id: ids.variantIds[i] } : {}),
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
      wholesalePriceMinor: v.wholesalePriceMinor,
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
  try {
    return await withTenant(db, ctx.auth.tenantId, async (tx) => {
      await requireCatalogManager(tx, ctx.auth.userId);
      return updateProductTx(tx, id, input, ctx);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'barcodes_code_unique')) throw barcodeConflict();
    throw error;
  }
}

/** The write of updateProduct inside the caller's transaction (the import); permission checked by the caller. */
export async function updateProductTx(
  tx: Transaction,
  id: string,
  input: UpdateProductData,
  ctx: CatalogContext,
): Promise<ProductDetail> {
  const { tenantId } = ctx.auth;
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
    // The floor is checked against the price the variant will have after this save
    const stored = existing.find((e) => e.variant.id === v.id)?.price;
    const price = v.price?.priceMinor ?? stored?.priceMinor;
    const floor = v.minPriceMinor === undefined ? (stored?.minPriceMinor ?? null) : v.minPriceMinor;
    // An old row that already has its floor above its price still saves its other changes: only a save that
    // touches the price or the floor is checked
    const touched =
      !stored ||
      Number(price) !== Number(stored.priceMinor) ||
      (floor ?? null) !== (stored.minPriceMinor ?? null);
    if (price !== undefined && touched) checkFloor(`variants.${i}.minPriceMinor`, Number(price), floor);
  });
  await checkKindChange(tx, current, input);
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
    season: input.season,
    genericName: input.genericName,
    strength: input.strength,
    dosageForm: input.dosageForm,
    requiresPrescription: input.requiresPrescription,
    requiresExpiry: input.requiresExpiry,
    controlled: input.controlled,
    tracksSerial: input.tracksSerial,
    rentable: input.rentable,
    warrantyMonths: input.warrantyMonths,
    type: input.type,
    unitId: input.unitId,
    taxRateId: input.taxRateId,
    sellOnPos: input.sellOnPos,
    modifiers: input.modifiers,
    // «اعتمد الصنف»: a product made at the till is reviewed (the contract allows only 'active')
    status: input.status,
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
      .where(and(eq(barcodes.variantId, v.id), keep.length > 0 ? notInArray(barcodes.id, keep) : undefined));
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
          v.archived === undefined ? undefined : v.archived ? (before.variant.archivedAt ?? ctx.now) : null,
      };
      const variantDiff = diff(before.variant, variantNext);
      if (Object.keys(variantDiff).length > 0) {
        await tx.update(variants).set(variantNext).where(eq(variants.id, variantId));
      }
      const priceNext = {
        currency: v.price?.currency,
        priceMinor: v.price?.priceMinor,
        minPriceMinor: v.minPriceMinor,
        wholesalePriceMinor: v.wholesalePriceMinor,
      };
      const priceDiff = diff(before.price, priceNext);
      if (Object.keys(priceDiff).length > 0) {
        const moved = 'currency' in priceDiff || 'priceMinor' in priceDiff;
        await tx
          .update(prices)
          .set({ ...priceNext, ...(moved ? { priceChangedAt: ctx.now } : {}) })
          .where(eq(prices.id, variantId));
        // A price typed back up to (or past) the struck one ends that markdown
        if (moved) {
          await tx.execute(sql`update prices set was_price_minor = null
            where id = ${variantId} and was_price_minor <= price_minor`);
        }
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
        wholesalePriceMinor: v.wholesalePriceMinor ?? null,
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
}

/** What archiving a product leaves behind: stock on the shelf, and the dishes that use it as an ingredient */
export async function archiveImpact(
  db: Database,
  id: string,
  ctx: CatalogContext,
): Promise<ArchiveImpactResponse> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const [found] = await tx.execute<{ id: string }>(sql`select id from products where id = ${id}::uuid`);
    if (!found) throw productNotFound();
    const [stock] = await tx.execute<{ qty: string }>(sql`
      select coalesce(sum(s.qty), 0)::text as qty from variants v
      join stock_levels s on s.tenant_id = v.tenant_id and s.variant_id = v.id
      where v.product_id = ${id}::uuid`);
    const dishes = await tx.execute<{ name: string }>(sql`
      select distinct d.name_ar as name from recipe_items r
      join variants v on v.id = r.ingredient_variant_id
      join products d on d.id = r.product_id and d.archived_at is null
      where v.product_id = ${id}::uuid order by 1 limit 10`);
    return { stockQty: Number(stock?.qty ?? 0), usedInRecipes: dishes.map((d) => d.name) };
  });
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

/** GET /v1/products/options: the options and values the store's pieces use, first use first. */
export async function listOptionValues(db: Database, ctx: CatalogContext): Promise<OptionValuesResponse> {
  return withTenant(db, ctx.auth.tenantId, async (tx) => {
    await requireCatalogReader(tx, ctx.auth.userId);
    const rows = await tx.execute<{ name: string; value: string }>(sql`
      select x.a->>'name' as name, x.a->>'value' as value
      from variants v
      cross join lateral jsonb_array_elements(v.attributes) with ordinality as x(a, n)
      where v.tenant_id = ${ctx.auth.tenantId}
        and coalesce(x.a->>'name', '') <> '' and coalesce(x.a->>'value', '') <> ''
      group by 1, 2
      order by min(x.n), 1, min(v.created_at), min(v.sort_order), 2
      limit 2000`);
    const byName = new Map<string, string[]>();
    for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r.value]);
    const seasonRows = await tx.execute<{ season: string }>(sql`
      select distinct season from products
      where tenant_id = ${ctx.auth.tenantId} and season is not null and archived_at is null
      order by season limit 200`);
    return {
      options: [...byName].map(([name, values]) => ({ name, values })),
      seasons: seasonRows.map((r) => r.season),
    };
  });
}
