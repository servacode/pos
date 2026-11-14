import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CurrencyCode, FoodCostReport, FoodCostRow, Recipe, RecipeInput, RecipeItem } from '@serva/core';
import {
  products,
  recipeItems,
  stockValues,
  units,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import { branchesOf } from './merchandise';
import { salesBreakdown } from './sales-breakdown';

/**
 * Recipes and food cost (packages/core › contracts/recipes.ts). A recipe is kept per menu item and
 * read only to show what a dish costs: it deducts nothing from stock and posts nothing.
 */

const notFound = () => new AppError(404, 'not_found', 'هذا الصنف غير موجود.');

/** q × value ÷ qty, rounded, without leaving the safe integers on the way */
const share = (q: number, value: number, qty: number): number =>
  Number((BigInt(q) * BigInt(value) * 2n + BigInt(qty)) / (BigInt(qty) * 2n));

/** The cost of `q` thousandths of each ingredient now, from its stock value (null: unknown) */
async function costsOf(
  tx: Transaction,
  wanted: { variantId: string; qty: number }[],
  branchIds: string[] | null,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (wanted.length === 0) return out;
  const rows = await tx
    .select({
      variantId: stockValues.variantId,
      qty: sql<string>`coalesce(sum(${stockValues.qty}), 0)`,
      value: sql<string>`coalesce(sum(${stockValues.valueMinor}), 0)`,
      refQty: sql<string>`coalesce(sum(${stockValues.refQty}), 0)`,
      refValue: sql<string>`coalesce(sum(${stockValues.refValueMinor}), 0)`,
    })
    .from(stockValues)
    .where(
      and(
        inArray(
          stockValues.variantId,
          wanted.map((w) => w.variantId),
        ),
        branchIds === null ? undefined : inArray(stockValues.branchId, branchIds),
      ),
    )
    .groupBy(stockValues.variantId);
  const byVariant = new Map(rows.map((r) => [r.variantId, r]));
  for (const { variantId, qty: q } of wanted) {
    const r = byVariant.get(variantId);
    const qty = Number(r?.qty ?? 0);
    const refQty = Number(r?.refQty ?? 0);
    out.set(
      variantId,
      r && qty > 0 && Number(r.value) > 0
        ? share(q, Number(r.value), qty)
        : r && refQty > 0
          ? share(q, Number(r.refValue), refQty)
          : null,
    );
  }
  return out;
}

async function recipeOf(tx: Transaction, productId: string): Promise<Recipe> {
  const rows = await tx
    .select({
      variantId: recipeItems.ingredientVariantId,
      qty: recipeItems.qty,
      name: products.nameAr,
      label: variants.label,
      fraction: units.allowsFraction,
      symbol: units.symbol,
    })
    .from(recipeItems)
    .innerJoin(variants, eq(variants.id, recipeItems.ingredientVariantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(units, and(eq(units.tenantId, products.tenantId), eq(units.id, products.unitId)))
    .where(eq(recipeItems.productId, productId))
    .orderBy(recipeItems.createdAt, recipeItems.id);
  const costs = await costsOf(
    tx,
    rows.map((r) => ({ variantId: r.variantId, qty: r.qty })),
    null,
  );
  const items: RecipeItem[] = rows.map((r) => ({
    variantId: r.variantId,
    name: r.label ? `${r.name} · ${r.label}` : r.name,
    unitSymbol: r.fraction ? r.symbol : null,
    qty: r.qty,
    costMinor: costs.get(r.variantId) ?? null,
  }));
  return {
    productId,
    items,
    costMinor: items.reduce((n, i) => n + (i.costMinor ?? 0), 0),
    incomplete: items.some((i) => i.costMinor === null),
  };
}

async function dishOf(tx: Transaction, productId: string): Promise<void> {
  const [dish] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!dish) throw notFound();
}

export function getRecipe(db: Database, auth: AccessClaims, productId: string): Promise<Recipe> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    await dishOf(tx, productId);
    return recipeOf(tx, productId);
  });
}

/** Replaces the dish's whole recipe; an empty list removes it */
export function putRecipe(
  db: Database,
  auth: AccessClaims,
  productId: string,
  input: RecipeInput,
): Promise<Recipe> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    await dishOf(tx, productId);
    const ids = input.items.map((i) => i.variantId);
    if (ids.length > 0) {
      const found = await tx
        .select({ id: variants.id, productId: variants.productId })
        .from(variants)
        .where(inArray(variants.id, ids));
      if (found.length !== ids.length) {
        throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
          items: 'مكوّن غير موجود.',
        });
      }
      if (found.some((f) => f.productId === productId)) {
        throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
          items: 'الوجبة لا تكون مكوّناً من نفسها.',
        });
      }
    }
    await tx.delete(recipeItems).where(eq(recipeItems.productId, productId));
    if (input.items.length > 0) {
      await tx.insert(recipeItems).values(
        input.items.map((i, n) => ({
          tenantId: auth.tenantId,
          productId,
          ingredientVariantId: i.variantId,
          qty: i.qty,
          createdAt: new Date(Date.now() + n),
        })),
      );
    }
    return recipeOf(tx, productId);
  });
}

/** «كلفة الوجبات»: each dish with a recipe, its price and margin, and what the period's sales cost */
export async function foodCostReport(
  db: Database,
  auth: AccessClaims,
  query: { from: string; to: string; branchId?: string | undefined },
): Promise<FoodCostReport> {
  const sold = await salesBreakdown(db, auth, { ...query, by: 'product' });
  const soldBy = new Map(sold.rows.map((r) => [r.key, r]));
  return withTenant(db, auth.tenantId, async (tx) => {
    const branches = await branchesOf(tx, auth, query.branchId);
    const items = await tx
      .select({
        productId: recipeItems.productId,
        variantId: recipeItems.ingredientVariantId,
        qty: recipeItems.qty,
      })
      .from(recipeItems);
    const costs = await costsOf(tx, items, branches);
    const dishes = new Map<string, { cost: number; incomplete: boolean }>();
    for (const item of items) {
      const d = dishes.get(item.productId) ?? { cost: 0, incomplete: false };
      const c = costs.get(item.variantId) ?? null;
      dishes.set(item.productId, { cost: d.cost + (c ?? 0), incomplete: d.incomplete || c === null });
    }
    const ids = [...dishes.keys()];
    const names = ids.length
      ? await tx
          .select({ id: products.id, name: products.nameAr })
          .from(products)
          .where(inArray(products.id, ids))
      : [];
    // The dish's price: its first variant's price in the store's currency
    const [settings] = await tx.execute<{ base: CurrencyCode }>(
      sql`select base_currency as base from tenant_settings`,
    );
    const base = settings!.base;
    const priced = ids.length
      ? await tx.execute<{ product_id: string; price_minor: string }>(sql`
          select distinct on (v.product_id) v.product_id, p.price_minor
          from variants v join prices p on p.tenant_id = v.tenant_id and p.id = v.id and p.currency = ${base}
          where v.product_id in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          order by v.product_id, v.sort_order, v.id`)
      : [];
    const priceOf = new Map(priced.map((r) => [r.product_id, Number(r.price_minor)]));
    const rows: FoodCostRow[] = names
      .map((n) => {
        const d = dishes.get(n.id)!;
        const price = priceOf.get(n.id) ?? null;
        const margin = price === null ? null : price - d.cost;
        const s = soldBy.get(n.id);
        return {
          productId: n.id,
          name: n.name,
          priceMinor: price,
          costMinor: d.cost,
          incomplete: d.incomplete,
          marginMinor: margin,
          marginBp: price && margin !== null ? Math.round((margin * 10_000) / price) : null,
          soldQty: s?.qty ?? 0,
          soldCostMinor: share(Math.max(s?.qty ?? 0, 0), d.cost, 1000),
          soldTotalMinor: s?.totalMinor ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const withoutRecipe = sold.rows
      .filter((r) => !dishes.has(r.key) && r.qty > 0)
      .map((r) => ({ productId: r.key, name: r.name }));
    return {
      from: query.from,
      to: query.to,
      baseCurrency: base,
      rows,
      withoutRecipe,
      totalSoldMinor: rows.reduce((n, r) => n + r.soldTotalMinor, 0),
      totalCostMinor: rows.reduce((n, r) => n + r.soldCostMinor, 0),
    };
  });
}
