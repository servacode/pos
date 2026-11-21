import { and, eq, isNull } from 'drizzle-orm';
import { normalizeArabic } from '@serva/core';
import { prices, products, tenantSettings, units, variants, type Transaction } from '@serva/db';

/**
 * The units every store gets when it is created (docs/contracts/step4.md decision 5): «قطعة»
 * without fractions and «كيلو» with them, so a product can be saved before the owner visits the
 * units page. No tax rate is made. Migration 0011 gave the same two to the stores that existed.
 */
export const SYSTEM_UNITS = [
  { systemKey: 'piece', name: 'قطعة', symbol: 'قطعة', allowsFraction: false },
  { systemKey: 'kg', name: 'كيلو', symbol: 'كغ', allowsFraction: true },
] as const;

export async function seedCatalogDefaults(tx: Transaction, tenantId: string): Promise<void> {
  await tx
    .insert(units)
    .values(SYSTEM_UNITS.map((u) => ({ tenantId, ...u })))
    .onConflictDoNothing();
}

/** The service an alteration ticket is billed with (03 › الملابس: التعديل والتقصير) */
export const ALTERATION_ITEM_NAME = 'تقصير';

/**
 * A clothing store gets «تقصير» as a service on the till at price 0 (the cashier types the price of
 * the job), unless a live service of that name exists: idempotent. Migration 0050 did the same for
 * the clothing stores that already existed; this runs when a store's business type changes.
 */
export async function ensureAlterationItem(tx: Transaction, tenantId: string): Promise<void> {
  const [found] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.type, 'service'),
        eq(products.nameAr, ALTERATION_ITEM_NAME),
        isNull(products.archivedAt),
      ),
    )
    .limit(1);
  if (found) return;
  const [unit] = await tx.select({ id: units.id }).from(units).where(eq(units.systemKey, 'piece')).limit(1);
  const [settings] = await tx.select({ currency: tenantSettings.baseCurrency }).from(tenantSettings).limit(1);
  if (!unit || !settings) return;
  const [product] = await tx
    .insert(products)
    .values({
      tenantId,
      nameAr: ALTERATION_ITEM_NAME,
      searchName: normalizeArabic(ALTERATION_ITEM_NAME),
      type: 'service',
      unitId: unit.id,
      sellOnPos: true,
    })
    .returning({ id: products.id });
  const [variant] = await tx
    .insert(variants)
    .values({ tenantId, productId: product!.id, sortOrder: 0 })
    .returning({ id: variants.id });
  await tx.insert(prices).values({ tenantId, id: variant!.id, currency: settings.currency, priceMinor: 0 });
}
