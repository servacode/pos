import { sql } from 'drizzle-orm';
import type { SyncDocument } from '@serva/sync';
import { actAsStore, liftAppendOnly, type Database, type Transaction } from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import { checkIntegrity, ledgerFingerprint, stockFingerprint, type Fingerprint } from './integrity';
import type { SyncProcessors } from './sync-push';

/**
 * Deterministic rebuild (task M1-7, ADR-0015): the books are a function of the stored documents
 * alone. This proves it for one store, without changing anything:
 *
 * 1. In one transaction, the fingerprints of the live books are taken (services/integrity.ts).
 * 2. Everything the documents produced is removed: their invoices and lines and payments, returns
 *    and their lines, customer payments, exchange vouchers, customers a till added, drawer
 *    movements, shifts, stock movements (stock levels go back to what other movements make) and
 *    journal entries. Rows that no document produced stay.
 * 3. Every document the server posted (processed_at set) is run again through its processor, in
 *    the canonical order of ADR-0015: business date, device time, document id. Not the order they
 *    arrived in, which the books must not depend on.
 * 4. The fingerprints are taken again and the integrity check runs on the rebuilt books.
 * 5. The transaction is always rolled back.
 *
 * Same fingerprints mean the live books are exactly what the documents say, whatever the order of
 * arrival, the retries and the restores were. Entry numbers are not compared (they follow arrival
 * by design; ADR-0006 moves them to the day close).
 *
 * It needs the table owner (DATABASE_MIGRATION_URL): the append-only guard is lifted inside the
 * transaction so the old effects can be removed, and row-level security is forced on the owner so
 * the processors see this store only, as they do live; both come back with the rollback. The store
 * tables are locked while it runs, a few seconds for a shop's day: run it off hours.
 */

export interface RebuildReport {
  tenantId: string;
  /** Documents run again */
  replayed: number;
  /** Documents whose processor failed on the second run: a rebuild that cannot be trusted */
  failed: { docId: string; error: string }[];
  live: { ledger: Fingerprint; stock: Fingerprint };
  rebuilt: { ledger: Fingerprint; stock: Fingerprint };
  /** The rebuilt books pass every integrity check but the numbering one (numbers follow arrival) */
  rebuiltOk: boolean;
  /** Same ledger and stock fingerprints, nothing failed, and the rebuilt books check out */
  same: boolean;
}

type PostedRow = Record<string, unknown> & {
  doc_id: string;
  status: 'accepted' | 'pending_link';
  payload: SyncDocument;
  device_id: string;
};

class RolledBack extends Error {
  constructor(readonly report: RebuildReport) {
    super('rebuild rolled back');
  }
}

async function removeEffects(tx: Transaction, tenantId: string): Promise<void> {
  await liftAppendOnly(tx);
  const docs = sql`(select doc_id from sync_inbox where tenant_id = ${tenantId})`;
  await tx.execute(sql`delete from journal_lines l using journal_entries e
    where l.tenant_id = ${tenantId} and e.tenant_id = l.tenant_id and e.id = l.entry_id and e.source_id in ${docs}`);
  await tx.execute(sql`delete from journal_entries where tenant_id = ${tenantId} and source_id in ${docs}`);
  await tx.execute(sql`delete from invoice_payments where tenant_id = ${tenantId} and invoice_id in ${docs}`);
  await tx.execute(sql`delete from invoice_lines where tenant_id = ${tenantId} and invoice_id in ${docs}`);
  await tx.execute(sql`delete from invoices where tenant_id = ${tenantId} and id in ${docs}`);
  await tx.execute(sql`delete from cash_movements where tenant_id = ${tenantId} and id in ${docs}`);
  await tx.execute(sql`delete from sale_return_lines where tenant_id = ${tenantId} and return_id in ${docs}`);
  await tx.execute(sql`delete from sale_returns where tenant_id = ${tenantId} and id in ${docs}`);
  await tx.execute(sql`delete from receipts where tenant_id = ${tenantId} and id in ${docs}`);
  await tx.execute(sql`delete from vouchers where tenant_id = ${tenantId} and return_id in ${docs}`);
  await tx.execute(sql`delete from customers where tenant_id = ${tenantId} and created_by_doc in ${docs}`);
  await tx.execute(
    sql`delete from shifts where tenant_id = ${tenantId} and (id in ${docs} or close_doc_id in ${docs})`,
  );
  await tx.execute(sql`delete from stock_movements where tenant_id = ${tenantId} and doc_id in ${docs}`);
  // Levels back to what the remaining movements (opening stock, …) make
  await tx.execute(sql`
    update stock_levels s set qty = coalesce((
      select sum(m.qty) from stock_movements m
      where m.tenant_id = s.tenant_id and m.branch_id = s.branch_id and m.variant_id = s.variant_id), 0)
    where s.tenant_id = ${tenantId}`);
}

export async function checkRebuild(
  db: Database,
  input: { tenantId: string; processors: SyncProcessors; now: Date },
): Promise<RebuildReport> {
  const { tenantId, processors, now } = input;
  try {
    await db.transaction(async (tx) => {
      // The processors run exactly as they do live: scoped to this store by row-level security,
      // which the owner role would otherwise bypass (forced for this transaction only).
      await actAsStore(tx, tenantId);
      const live = {
        ledger: await ledgerFingerprint(tx, tenantId),
        stock: await stockFingerprint(tx, tenantId),
      };
      await removeEffects(tx, tenantId);

      const posted = await tx.execute<PostedRow>(sql`
        select doc_id, status, payload, device_id from sync_inbox
        where tenant_id = ${tenantId} and status in ('accepted', 'pending_link') and processed_at is not null
        order by business_date, device_time, doc_id`);
      const devices = new Map<string, DeviceClaims>();
      const deviceOf = async (id: string) => {
        let claims = devices.get(id);
        if (!claims) {
          const [row] = await tx.execute<{
            deviceId: string;
            tenantId: string;
            branchId: string;
            code: string;
            revokedAt: Date | null;
          }>(sql`select id as "deviceId", tenant_id as "tenantId", branch_id as "branchId", code,
                        revoked_at as "revokedAt"
                 from devices where tenant_id = ${tenantId} and id = ${id}`);
          if (!row) throw new Error(`device ${id} is unknown`);
          claims = row;
          devices.set(id, claims);
        }
        return claims;
      };

      const failed: RebuildReport['failed'] = [];
      let replayed = 0;
      for (const row of posted) {
        const processor = processors[row.payload.type];
        if (!processor) {
          failed.push({ docId: row.doc_id, error: `no processor for ${row.payload.type}` });
          continue;
        }
        try {
          await tx.transaction(async (sp: Transaction) => {
            await processor({
              tx: sp,
              device: await deviceOf(row.device_id),
              doc: row.payload,
              status: row.status,
              now,
            });
          });
          replayed += 1;
        } catch (error) {
          const cause = (error as { cause?: Error }).cause;
          failed.push({
            docId: row.doc_id,
            error: (cause?.message ?? (error as Error).message).slice(0, 200),
          });
        }
      }

      const rebuilt = {
        ledger: await ledgerFingerprint(tx, tenantId),
        stock: await stockFingerprint(tx, tenantId),
      };
      // Entry numbers follow the order of arrival, and a rebuild posts in another: every check but
      // the numbering one must hold on the rebuilt books.
      const rebuiltOk = (await checkIntegrity(tx, tenantId)).checks.every(
        (c) => c.ok || c.name === 'journal_numbering',
      );
      const same =
        failed.length === 0 &&
        rebuiltOk &&
        rebuilt.ledger.hash === live.ledger.hash &&
        rebuilt.stock.hash === live.stock.hash;
      throw new RolledBack({ tenantId, replayed, failed, live, rebuilt, rebuiltOk, same });
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.report;
    throw error;
  }
  throw new Error('rebuild did not run');
}
