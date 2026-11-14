import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, uuidSchema } from './common';

/**
 * Recipes and food cost (03 › المطاعم): an optional recipe per menu item, the ingredients that go
 * into one portion, used only to SHOW what a dish costs and its margin in «كلفة الوجبات». Nothing
 * is deducted from stock and nothing is posted. An ingredient costs what its own stock is worth on
 * average (the stock value across the branches, falling back to the last average known).
 *
 *   GET /v1/recipes/{productId}                 → Recipe          (catalog.manage)
 *   PUT /v1/recipes/{productId}   recipeInput   → Recipe          replaces the whole recipe
 *   GET /v1/reports/food-cost?from&to[&branchId] → FoodCostReport (report.view)
 */

export const RECIPE_MAX_INGREDIENTS = 40;

export const recipeInput = z
  .object({
    items: z
      .array(
        z.object({
          variantId: uuidSchema,
          /** Thousandths of the ingredient's base unit in one portion */
          qty: z.int('الكمية رقم صحيح').min(1, 'اكتب الكمية').max(1_000_000_000),
        }),
      )
      .max(RECIPE_MAX_INGREDIENTS, 'مكوّنات كثيرة'),
  })
  .refine((r) => new Set(r.items.map((i) => i.variantId)).size === r.items.length, {
    path: ['items'],
    message: 'مكوّن مكرّر',
  });
export type RecipeInput = z.input<typeof recipeInput>;

export const foodCostQuery = z
  .object({ from: isoDateSchema, to: isoDateSchema, branchId: uuidSchema.optional() })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'نهاية المدة قبل بدايتها' });

export interface RecipeItem {
  variantId: string;
  name: string;
  /** «كغ» for a unit sold in fractions; null for pieces */
  unitSymbol: string | null;
  qty: number;
  /** What this quantity costs now; null when the ingredient has no known cost */
  costMinor: number | null;
}

export interface Recipe {
  productId: string;
  items: RecipeItem[];
  /** The sum of the known costs, base currency */
  costMinor: number;
  /** An ingredient has no known cost, so `costMinor` is short */
  incomplete: boolean;
}

export interface FoodCostRow {
  productId: string;
  name: string;
  priceMinor: number | null;
  costMinor: number;
  incomplete: boolean;
  marginMinor: number | null;
  /** Margin over the price, basis points */
  marginBp: number | null;
  /** Portions sold in the period (thousandths) and what they cost at today's recipe cost */
  soldQty: number;
  soldCostMinor: number;
  soldTotalMinor: number;
}

export interface FoodCostReport {
  from: string;
  to: string;
  baseCurrency: CurrencyCode;
  rows: FoodCostRow[];
  /** Menu items sold in the period that have no recipe yet */
  withoutRecipe: { productId: string; name: string }[];
  totalSoldMinor: number;
  totalCostMinor: number;
}
