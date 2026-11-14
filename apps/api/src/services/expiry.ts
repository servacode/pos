import { sql } from 'drizzle-orm';
import type { Transaction } from '@serva/db';
import { uuidArray } from './costing';

/**
 * Expiry (03 › الصيدليات: الصلاحية). What is left of each batch is the batch ledger's balance
 * (services/batches.ts), not an estimate. The earliest expiry of the batches that still hold
 * something is written on the item for the till's warning, with the batches themselves (dates, no
 * quantities, so a sale that leaves the set as it was changes nothing the tills pull).
 */
export async function refreshExpiry(tx: Transaction, variantIds: readonly string[]): Promise<void> {
  if (variantIds.length === 0) return;
  await tx.execute(
    sql`select refresh_variant_expiry(app_current_tenant(), ${uuidArray([...new Set(variantIds)])})`,
  );
}

export { expiryReport } from './batches';
