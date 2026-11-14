import { and, eq, isNull, sql } from 'drizzle-orm';
import { normalizeArabic, type CurrencyCode } from '@serva/core';
import { prices, products, tenantSettings, units, variants, type Transaction } from '@serva/db';

/** Helpers shared by rentals, maintenance contracts and contract prices (03 › الأدوات الطبية). */

/** Today in the store's own time zone, as «2026-11-13» */
export async function storeToday(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx.execute<{ day: string }>(
    sql`select (now() at time zone t.timezone)::date::text as day from tenants t where t.id = ${tenantId}`,
  );
  return row!.day;
}

export async function baseCurrencyOf(tx: Transaction, tenantId: string): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(
    sql`select base_currency as base from tenant_settings where tenant_id = ${tenantId}`,
  );
  return (row?.base ?? 'SYP') as CurrencyCode;
}

/** The next number of a per-store sequence, taken under a lock so two tills never share one */
export async function nextSeq(
  tx: Transaction,
  tenantId: string,
  table: 'rentals' | 'maintenance_contracts',
): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${table}), hashtext(${tenantId}))`);
  const [last] = await tx.execute<{ seq: number | null }>(
    sql`select max(seq) as seq from ${sql.identifier(table)} where tenant_id = ${tenantId}`,
  );
  return (last?.seq ?? 0) + 1;
}

/** The services the till sells a rental and a maintenance contract with */
export const RENTAL_ITEM_NAME = 'إيجار';
export const MAINTENANCE_ITEM_NAME = 'عقد صيانة';

/**
 * A service on the till at price 0 (the cashier sells it at the amount asked), unless a live service
 * of that name exists: idempotent. Rentals and contracts make theirs when the first one is written.
 */
export async function ensureServiceItem(tx: Transaction, tenantId: string, name: string): Promise<void> {
  const [found] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.type, 'service'), eq(products.nameAr, name), isNull(products.archivedAt)))
    .limit(1);
  if (found) return;
  const [unit] = await tx.select({ id: units.id }).from(units).where(eq(units.systemKey, 'piece')).limit(1);
  const [settings] = await tx.select({ currency: tenantSettings.baseCurrency }).from(tenantSettings).limit(1);
  if (!unit || !settings) return;
  const [product] = await tx
    .insert(products)
    .values({
      tenantId,
      nameAr: name,
      searchName: normalizeArabic(name),
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

export const normalizeSerial = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();
