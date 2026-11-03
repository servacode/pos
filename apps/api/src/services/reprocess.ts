import { and, eq, sql } from 'drizzle-orm';
import type { SyncDocument } from '@serva/sync';
import { devices, syncInbox, withTenant, type Database, type Transaction } from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { DocumentRejection, type SyncProcessors } from './sync-push';

/**
 * The catch-up of held documents (task M1-4; the mechanism documented with M0-3 in the ADR
 * register). A document whose type had no processor when it arrived was stored whole, accepted and
 * flagged held_for_processing, with processed_at null. Once a processor for that type exists, this
 * posts those documents. It is never automatic: someone runs it for one type and one store, and
 * the run is written to the audit log.
 *
 * - Only documents still held: accepted or waiting for a link, flagged, processed_at null.
 * - In the order each device made them (device_seq), device by device, so a document never
 *   posts before an earlier one of the same till.
 * - Each in its own savepoint: one that fails is rolled back alone and stays held, the rest go on.
 * - Success sets processed_at and drops the flag, so running it again posts nothing twice.
 * - A processor that finds the document invalid in itself (DocumentRejection) marks it rejected
 *   with its code, as it would have been on arrival, and nothing it wrote is kept.
 *
 * The processor runs with the document exactly as it arrived (its stored payload) and the device
 * as the server knows it now; a revoked device's documents are posted too, since they were
 * accepted while it was linked.
 */

export interface ReprocessReport {
  tenantId: string;
  type: string;
  /** Held documents of this type found */
  found: number;
  processed: number;
  rejected: { docId: string; code: string }[];
  /** Still held: the processor threw something else; nothing of them was kept */
  failed: { docId: string; error: string }[];
}

type HeldRow = Record<string, unknown> & {
  doc_id: string;
  status: 'accepted' | 'pending_link';
  flags: string[];
  payload: SyncDocument;
  device_id: string;
};

export async function reprocessHeld(
  db: Database,
  input: {
    tenantId: string;
    type: string;
    processors: SyncProcessors;
    now: Date;
    actorUserId?: string | null;
  },
  meta: RequestMeta,
): Promise<ReprocessReport> {
  const processor = input.processors[input.type as keyof SyncProcessors];
  if (!processor) throw new Error(`No processor for ${input.type}: nothing to catch up.`);
  return withTenant(db, input.tenantId, async (tx) => {
    // One catch-up per store and type at a time
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`reprocess:${input.tenantId}:${input.type}`}, 0))`,
    );
    const held = await tx.execute<HeldRow>(sql`
      select doc_id, status, flags, payload, device_id from sync_inbox
      where tenant_id = ${input.tenantId} and doc_type = ${input.type}
        and status in ('accepted', 'pending_link') and processed_at is null
        and 'held_for_processing' = any(flags)
      order by device_id, device_seq`);

    const deviceCache = new Map<string, DeviceClaims>();
    const deviceOf = async (id: string): Promise<DeviceClaims> => {
      const known = deviceCache.get(id);
      if (known) return known;
      const [row] = await tx
        .select({
          deviceId: devices.id,
          tenantId: devices.tenantId,
          branchId: devices.branchId,
          code: devices.code,
          revokedAt: devices.revokedAt,
        })
        .from(devices)
        .where(eq(devices.id, id));
      if (!row?.code) throw new Error(`device ${id} has no code`);
      const claims: DeviceClaims = { ...row, code: row.code };
      deviceCache.set(id, claims);
      return claims;
    };

    const report: ReprocessReport = {
      tenantId: input.tenantId,
      type: input.type,
      found: held.length,
      processed: 0,
      rejected: [],
      failed: [],
    };
    const where = (docId: string) => and(eq(syncInbox.tenantId, input.tenantId), eq(syncInbox.docId, docId));
    const withoutHeld = (flags: string[]) => flags.filter((f) => f !== 'held_for_processing');

    for (const row of held) {
      try {
        await tx.transaction(async (sp: Transaction) => {
          let extra: Awaited<ReturnType<typeof processor>>;
          try {
            // The processor in a savepoint of its own: a rejection keeps nothing it wrote
            extra = await sp.transaction(async (work: Transaction) =>
              processor({
                tx: work,
                device: await deviceOf(row.device_id),
                doc: row.payload,
                status: row.status,
                now: input.now,
              }),
            );
          } catch (error) {
            if (!(error instanceof DocumentRejection)) throw error;
            await sp
              .update(syncInbox)
              .set({ status: 'rejected', resultCode: error.code, flags: withoutHeld(row.flags) })
              .where(where(row.doc_id));
            report.rejected.push({ docId: row.doc_id, code: error.code });
            return;
          }
          const flags = [...new Set([...withoutHeld(row.flags), ...(extra?.flags ?? [])])];
          await sp.update(syncInbox).set({ flags, processedAt: input.now }).where(where(row.doc_id));
          report.processed += 1;
        });
      } catch (error) {
        report.failed.push({ docId: row.doc_id, error: (error as Error).message.slice(0, 200) });
      }
    }

    await audit(
      tx,
      {
        tenantId: input.tenantId,
        userId: input.actorUserId ?? null,
        actorType: input.actorUserId ? 'user' : 'system',
        action: 'documents.reprocess_held',
        entity: 'sync_inbox',
        data: {
          type: report.type,
          found: report.found,
          processed: report.processed,
          rejected: report.rejected.length,
          failed: report.failed.length,
        },
      },
      meta,
    );
    return report;
  });
}
