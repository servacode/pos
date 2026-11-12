import { and, asc, eq, sql } from 'drizzle-orm';
import { branches, devices, docSequences, syncInbox, withTenant, type Database } from '@serva/db';
import { parseDocNumber, type SyncDocument } from '@serva/sync';
import type { DeviceClaims } from '../auth/device-guard';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { costAfterPush } from './costing';
import { lifecycleInTx } from './subscription-gate';
import {
  classify,
  linkWaiting,
  recordReceived,
  runProcessor,
  type Prepared,
  type SyncProcessors,
} from './sync-push';

/**
 * Releases what a read-only store held back. While a store is read-only, sync push keeps a document
 * made after the cut-off whole, quarantined with the code subscription_read_only, and never posts
 * it (services/sync-push.ts). Once the store can write again (a payment confirmed or reported, the
 * platform set the subscription, any date change that ends the read-only state) those documents are
 * real sales and must reach the books. This re-processes them.
 *
 * - Only rows still quarantined with that code; the update that moves a row checks it again, so a
 *   second run (or two at once) posts nothing twice. A revoked-device quarantine (after_revocation)
 *   is the owner's to review and is never touched.
 * - Device by device, in device_seq order, under the same advisory lock a push takes
 *   (`sync:device:<id>`), each device in one transaction, each document in its own savepoint.
 * - Each document gets the checks a new one gets, except the read-only rule itself: number
 *   ownership and conflicts, dependencies, schema, and the revocation cut-off if the device was
 *   revoked meanwhile (it then waits for the owner as after_revocation); then the type's processor,
 *   exactly as push runs it.
 * - A document that depends on another one still in this quarantine waits for it; the passes go on
 *   until nothing more moves, so order across devices does not matter.
 * - Written to the audit log, with the count per device.
 */

export interface ReleaseReport {
  /** Posted or linked (accepted / pending_link) */
  released: number;
  /** Refused on the way out (a rule a new document would also fail) */
  rejected: number;
  /** Moved to the revoked-device review */
  revoked: number;
  /** Failed unexpectedly; still quarantined, the next trigger retries */
  failed: number;
  byDevice: Record<string, number>;
}

export interface ReleaseContext {
  processors: SyncProcessors;
  now: Date;
  meta: RequestMeta;
  /** false = the read-only rule is off (SUBSCRIPTION_ENFORCEMENT=false) */
  enforceSubscription?: boolean;
  onError?: (error: unknown, docId: string) => void;
}

const HELD = sql`status = 'quarantined' and result_code = 'subscription_read_only'`;
const MAX_PASSES = 10;

const empty = (): ReleaseReport => ({ released: 0, rejected: 0, revoked: 0, failed: 0, byDevice: {} });

/** The devices of the store that have documents waiting; none while the store is still read-only. */
async function devicesWithHeld(db: Database, tenantId: string, ctx: ReleaseContext): Promise<string[]> {
  return withTenant(db, tenantId, async (tx) => {
    // Cheap first: a store that is read-only releases nothing, whatever waits
    if (ctx.enforceSubscription !== false) {
      const life = await lifecycleInTx(tx, ctx.now);
      if (life?.readOnly) return [];
    }
    const rows = await tx.execute<{ device_id: string }>(
      sql`select distinct device_id from sync_inbox where tenant_id = ${tenantId} and ${HELD} order by device_id`,
    );
    return rows.map((r) => r.device_id);
  });
}

export async function releaseReadOnlyQuarantine(
  db: Database,
  tenantId: string,
  ctx: ReleaseContext,
): Promise<ReleaseReport> {
  const total = empty();
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const ids = await devicesWithHeld(db, tenantId, ctx);
    if (ids.length === 0) break;
    let moved = 0;
    for (const deviceId of ids) {
      const part = await releaseDevice(db, tenantId, deviceId, ctx);
      total.released += part.released;
      total.rejected += part.rejected;
      total.revoked += part.revoked;
      total.failed += part.failed;
      total.byDevice[deviceId] = (total.byDevice[deviceId] ?? 0) + part.released;
      moved += part.released + part.rejected + part.revoked;
    }
    if (moved === 0) break;
  }
  return total;
}

async function releaseDevice(
  db: Database,
  tenantId: string,
  deviceId: string,
  ctx: ReleaseContext,
): Promise<ReleaseReport> {
  const report = empty();
  return withTenant(db, tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sync:device:${deviceId}`}, 0))`);
    // Checked again under the lock: the store may have gone read-only again since the first look
    if (ctx.enforceSubscription !== false) {
      const life = await lifecycleInTx(tx, ctx.now);
      if (life?.readOnly) return report;
    }
    const [row] = await tx
      .select({
        deviceId: devices.id,
        tenantId: devices.tenantId,
        branchId: devices.branchId,
        code: devices.code,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.id, deviceId));
    if (!row?.code) return report;
    const device: DeviceClaims = { ...row, code: row.code };
    const prepared: Prepared = {
      readOnly: null,
      branchCode: (
        await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, device.branchId))
      )[0]!.code,
      announced: new Map(
        (
          await tx
            .select({ series: docSequences.series, last: docSequences.lastAnnounced })
            .from(docSequences)
            .where(eq(docSequences.deviceId, deviceId))
        ).map((r) => [r.series, r.last]),
      ),
    };

    const held = await tx
      .select({ docId: syncInbox.docId, payload: syncInbox.payload })
      .from(syncInbox)
      .where(
        and(
          eq(syncInbox.tenantId, tenantId),
          eq(syncInbox.deviceId, deviceId),
          eq(syncInbox.status, 'quarantined'),
          eq(syncInbox.resultCode, 'subscription_read_only'),
        ),
      )
      .orderBy(asc(syncInbox.deviceSeq));

    const received = new Map<string, number>();
    for (const { docId, payload } of held) {
      const doc = payload as SyncDocument;
      try {
        await tx.transaction(async (sp) => {
          const verdict = await classify(sp, device, doc, prepared, ctx.now, true);
          // Waits for a dependency still in this quarantine: the next pass
          if (verdict.deferred) return;
          let next = {
            status: verdict.status,
            code: verdict.code,
            flags: verdict.flags,
            processedAt: null as Date | null,
          };
          if (verdict.status === 'accepted' || verdict.status === 'pending_link') {
            const done = await sp.transaction((work) =>
              runProcessor(
                work,
                device,
                doc,
                verdict.status,
                verdict.code,
                verdict.flags,
                ctx.now,
                ctx.processors,
              ),
            );
            next = {
              status: done.finalStatus,
              code: done.finalCode,
              flags: done.finalFlags,
              processedAt: done.processedAt,
            };
          }
          // The claim: only a row still held moves, so a document is never posted twice
          const moved = await sp
            .update(syncInbox)
            .set({
              status: next.status,
              resultCode: next.code,
              flags: next.flags,
              processedAt: next.processedAt,
            })
            .where(
              and(
                eq(syncInbox.tenantId, tenantId),
                eq(syncInbox.docId, docId),
                eq(syncInbox.status, 'quarantined'),
                eq(syncInbox.resultCode, 'subscription_read_only'),
              ),
            )
            .returning({ docId: syncInbox.docId });
          if (moved.length !== 1) throw new Error('quarantined document already moved');
          if (next.status === 'rejected') report.rejected += 1;
          else if (next.status === 'quarantined') report.revoked += 1;
          else {
            report.released += 1;
            await linkWaiting(sp, tenantId, docId);
            if (doc.number) {
              const parsed = parseDocNumber(doc.number)!;
              received.set(parsed.series, Math.max(received.get(parsed.series) ?? 0, parsed.sequence));
            }
          }
        });
      } catch (error) {
        // Its savepoint is rolled back; it stays quarantined and the next trigger tries again
        report.failed += 1;
        ctx.onError?.(error, docId);
      }
    }
    await recordReceived(tx, device, received);
    if (report.released + report.rejected + report.revoked + report.failed > 0) {
      await audit(
        tx,
        {
          tenantId,
          actorType: 'system',
          action: 'sync.quarantine_released',
          entity: 'sync_inbox',
          entityId: deviceId,
          deviceId,
          data: {
            code: 'subscription_read_only',
            released: report.released,
            rejected: report.rejected,
            revoked: report.revoked,
            failed: report.failed,
          },
        },
        ctx.meta,
      );
    }
    return report;
  });
}

/**
 * The release as the triggers call it (a push, a payment, the platform): it never throws, because
 * what triggered it already succeeded and the next trigger retries; whatever was released is costed
 * right away, as after a push.
 */
export async function releaseQuietly(
  db: Database,
  tenantId: string,
  ctx: ReleaseContext,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    const report = await releaseReadOnlyQuarantine(db, tenantId, ctx);
    if (report.released > 0) await costAfterPush(db, tenantId, onFailure);
  } catch (error) {
    onFailure(error);
  }
}
