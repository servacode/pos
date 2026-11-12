import { sql } from 'drizzle-orm';
import { emptyImportTotals, type ImportData, type ImportResponse } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import type { AccessClaims } from '../../auth/tokens';
import type { RequestMeta } from '../../types';
import { requirePermission } from '../../auth/permissions';
import { audit } from '../audit';
import { Results, type ImportContext } from './context';
import { importParties } from './parties';
import { importProducts } from './products';

const PERMISSION = {
  products: 'catalog.manage',
  customers: 'customers.manage',
  suppliers: 'purchases.manage',
} as const;

/** Thrown after a dry run's work to roll the transaction back; carries the answer out. */
class DryRun extends Error {
  constructor(readonly response: ImportResponse) {
    super('dry run');
  }
}

/**
 * One chunk of an import, in one transaction. A dry run does exactly what the real run does and
 * rolls everything back, so its answer (what is new, updated, skipped, refused and why) is what the
 * real run will do. A bad row is rolled back alone (a savepoint) and named; the rest stands.
 */
export async function runImport(
  db: Database,
  auth: AccessClaims,
  input: ImportData,
  meta: RequestMeta,
  now: Date,
): Promise<ImportResponse> {
  try {
    return await withTenant(db, auth.tenantId, async (tx) => {
      // Two imports of one store at once would meet on the same barcodes: they take turns
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`import:${auth.tenantId}`}, 0))`);
      // Refused as a whole (403), like the screens of the same data
      await requirePermission(tx, auth.userId, PERMISSION[input.type]);
      const results = new Results(input.rows.map((r) => r.line));
      const ctx: ImportContext = {
        tx,
        auth,
        meta,
        now,
        input,
        catalog: { auth, now, meta },
      };
      if (input.type === 'products') await importProducts(ctx, input.rows, results);
      else
        await importParties(input.type === 'customers' ? 'customer' : 'supplier', ctx, input.rows, results);

      const all = results.all();
      const totals = emptyImportTotals();
      for (const r of all) totals[r.status] += 1;
      const response: ImportResponse = { type: input.type, mode: input.mode, results: all, totals };
      if (input.mode === 'dry_run') throw new DryRun(response);
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'import.chunk',
          entity: input.type,
          data: { rows: input.rows.length, ...totals, existing: input.existing },
        },
        meta,
      );
      return response;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.response;
    throw error;
  }
}
