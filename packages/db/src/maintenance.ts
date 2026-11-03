import { sql } from 'drizzle-orm';
import type { Transaction } from './client';

/**
 * Owner-only steps of the verification tools (apps/api/src/services/rebuild.ts), kept here with
 * withTenant() because they bend the database's own guards. Each holds for the transaction it is
 * called in and ends with it; the rebuild always rolls that transaction back.
 */

/** The financial tables whose rows are never changed nor deleted (refuse_change triggers) */
export const APPEND_ONLY_TABLES = [
  'journal_lines',
  'journal_entries',
  'invoice_lines',
  'invoice_payments',
  'stock_movements',
  'sale_return_lines',
] as const;

/** Lifts the append-only guard of these tables for this transaction (table owner only). */
export async function liftAppendOnly(tx: Transaction): Promise<void> {
  for (const table of APPEND_ONLY_TABLES) {
    await tx.execute(sql.raw(`alter table "${table}" disable trigger append_only`));
  }
}

/**
 * Makes this transaction see one store only, even as the table owner: sets the store, as
 * withTenant() does, and forces row-level security on every store table, which the owner would
 * otherwise bypass. Code run afterwards behaves exactly as it does under the API's own role.
 */
export async function actAsStore(tx: Transaction, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
  const tables = await tx.execute<{ name: string }>(sql`
    select distinct tablename as name from pg_policies
    where schemaname = 'public' and policyname = 'tenant_isolation'`);
  for (const { name } of tables) {
    await tx.execute(sql.raw(`alter table "${name.replace(/"/g, `""`)}" force row level security`));
  }
}
