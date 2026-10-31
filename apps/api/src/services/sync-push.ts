import { timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  branches,
  devices,
  docSequences,
  syncInbox,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import {
  CONTRACT_VERSION,
  parseDocNumber,
  payloadHash,
  SUPPORTED_CONTRACT_VERSIONS,
  type DocType,
  type pushRequestSchema,
  type PushResponse,
  type PushResult,
  type StoredStatus,
  type SyncDocument,
  type SyncFlag,
} from '@serva/sync';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { audit } from './audit';
import type { RequestMeta } from '../types';
import { readServerState } from './sync-state';

/** Payload hashes are not secrets, but compare them in constant time so no comparison leaks timing. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

type PushRequest = z.output<typeof pushRequestSchema>;

/** A document a processor finds invalid in itself (unbalanced, …): stored as rejected with this code. */
export class DocumentRejection extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DocumentRejection';
  }
}

export interface DocumentContext {
  tx: Transaction;
  device: DeviceClaims;
  doc: SyncDocument;
  status: 'accepted' | 'pending_link';
  now: Date;
}

/**
 * What the server does with an accepted document of a type, inside that document's short
 * transaction (15 › معاملة قصيرة): phase 1 posts the sale, its stock movements and its journal
 * entry here. A processor returns flags (accept-and-flag: permission_stale, totals_mismatch…)
 * and throws DocumentRejection only for what is structurally invalid. Nothing is registered yet:
 * every phase-0 document is stored and accepted as it arrived.
 */
export type DocumentProcessor = (ctx: DocumentContext) => Promise<{ flags?: SyncFlag[] } | void>;
export type SyncProcessors = Partial<Record<DocType, DocumentProcessor>>;

/** A device clock this far ahead of the server's (after its known offset) is flagged (15 › ساعة الجهاز). */
const CLOCK_SKEW_MS = 5 * 60_000;

interface Prepared {
  branchCode: string;
  announced: Map<string, number>;
}

/**
 * POST /v1/sync/push. Documents of one device are processed one after another under an advisory
 * lock on the device, so two requests from it never interleave; each document runs in its own
 * savepoint, so one failure never undoes or stops the others. The answer for a document depends
 * only on what the inbox holds, so the same batch sent again gets the same answers.
 */
export interface PushContext {
  meta: RequestMeta;
  now: Date;
  processors?: SyncProcessors;
  /** Where unexpected per-document errors are logged (the document itself answers retry) */
  onError?: (error: unknown, docId: string) => void;
}

export async function pushDocuments(
  db: Database,
  device: DeviceClaims,
  request: PushRequest,
  { meta, now, processors = {}, onError }: PushContext,
): Promise<PushResponse> {
  return withTenant(db, device.tenantId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`sync:device:${device.deviceId}`}, 0))`,
    );
    const state = await readServerState(tx);

    const [last] = await tx
      .select({ max: sql<string>`coalesce(max(${syncInbox.deviceSeq}), 0)` })
      .from(syncInbox)
      .where(and(eq(syncInbox.tenantId, device.tenantId), eq(syncInbox.deviceId, device.deviceId)));
    const resendFrom = Number(last?.max ?? 0);

    // Heartbeat: what the device says it issued. A revoked device's cut-off is what it announced
    // before it was revoked, so it can no longer move it.
    if (!device.revokedAt) await recordAnnounced(tx, device, request.lastIssued);
    const prepared: Prepared = {
      branchCode: (
        await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, device.branchId))
      )[0]!.code,
      announced: new Map(
        (
          await tx
            .select({ series: docSequences.series, last: docSequences.lastAnnounced })
            .from(docSequences)
            .where(eq(docSequences.deviceId, device.deviceId))
        ).map((r) => [r.series, r.last]),
      ),
    };

    const results: PushResult[] = [];
    const received = new Map<string, number>();
    for (const doc of [...request.documents].sort((a, b) => a.seq - b.seq)) {
      let result: PushResult;
      try {
        result = await tx.transaction((sp) =>
          processDocument(sp, device, doc, request, prepared, now, processors),
        );
      } catch (error) {
        // Its savepoint is rolled back and nothing of it is kept: the device sends it again.
        onError?.(error, doc.id);
        result = { id: doc.id, status: 'retry', flags: [] };
      }
      if (result.status === 'id_conflict') {
        await audit(
          tx,
          {
            tenantId: device.tenantId,
            actorType: 'device',
            action: 'sync.id_conflict',
            entity: 'sync_inbox',
            entityId: doc.id,
            data: { deviceId: device.deviceId, seq: doc.seq, number: doc.number, hash: doc.hash },
          },
          meta,
        );
      }
      const stored = result.status === 'duplicate' ? result.outcome : result.status;
      if ((stored === 'accepted' || stored === 'pending_link') && doc.number) {
        const parsed = parseDocNumber(doc.number)!;
        received.set(parsed.series, Math.max(received.get(parsed.series) ?? 0, parsed.sequence));
      }
      results.push(result);
    }
    await recordReceived(tx, device, received);

    const sentAt = Date.parse(request.sentAt);
    await tx
      .update(devices)
      .set({
        lastSeenAt: now,
        lastSyncAt: now,
        appVersion: request.appVersion,
        clockOffsetMs: Number.isFinite(sentAt) ? clampInt(sentAt - now.getTime()) : null,
      })
      .where(eq(devices.id, device.deviceId));

    return {
      contractVersion: CONTRACT_VERSION,
      serverEpoch: state.serverEpoch,
      serverTime: now.toISOString(),
      resendFrom,
      results,
      commands: device.revokedAt ? { wipe: true } : {},
    };
  });
}

const clampInt = (n: number) => Math.max(-2_147_483_648, Math.min(2_147_483_647, Math.round(n)));

async function processDocument(
  tx: Transaction,
  device: DeviceClaims,
  doc: SyncDocument,
  request: PushRequest,
  prepared: Prepared,
  now: Date,
  processors: SyncProcessors,
): Promise<PushResult> {
  const { hash, ...body } = doc;
  // The hash is the document's identity: recomputed here, never taken on trust.
  if (!sameHash(payloadHash(body), hash))
    return { id: doc.id, status: 'rejected', code: 'hash_mismatch', flags: [] };

  const [existing] = await tx
    .select({
      status: syncInbox.status,
      payloadHash: syncInbox.payloadHash,
      resultCode: syncInbox.resultCode,
      flags: syncInbox.flags,
      receivedAt: syncInbox.receivedAt,
    })
    .from(syncInbox)
    .where(and(eq(syncInbox.tenantId, device.tenantId), eq(syncInbox.docId, doc.id)));
  if (existing) {
    if (!sameHash(existing.payloadHash, hash)) return { id: doc.id, status: 'id_conflict', flags: [] };
    return {
      id: doc.id,
      status: 'duplicate',
      outcome: existing.status as StoredStatus,
      ...(existing.resultCode ? { code: existing.resultCode } : {}),
      flags: existing.flags as SyncFlag[],
      receivedAt: existing.receivedAt.toISOString(),
    };
  }

  const { status, code, flags } = await classify(tx, device, doc, prepared, now);
  const [row] = await tx
    .insert(syncInbox)
    .values({
      tenantId: device.tenantId,
      docId: doc.id,
      deviceId: device.deviceId,
      deviceSeq: doc.seq,
      docType: doc.type,
      number: doc.number,
      payloadHash: hash,
      payload: doc,
      deps: doc.deps,
      contractVersion: doc.contractVersion,
      engineVersion: doc.engineVersion,
      appVersion: request.appVersion,
      deviceTime: new Date(doc.deviceTime),
      businessDate: doc.businessDate,
      status,
      resultCode: code,
      flags,
      receivedAt: now,
      processedAt: now,
    })
    .returning({ receivedAt: syncInbox.receivedAt });

  let finalFlags = flags;
  let finalStatus: StoredStatus = status;
  let finalCode = code;
  if (status === 'accepted' || status === 'pending_link') {
    const processor = processors[doc.type];
    try {
      const extra = processor ? await processor({ tx, device, doc, status, now }) : undefined;
      if (extra?.flags?.length) finalFlags = [...new Set([...flags, ...extra.flags])];
    } catch (error) {
      if (!(error instanceof DocumentRejection)) throw error;
      finalStatus = 'rejected';
      finalCode = error.code;
    }
    if (finalFlags !== flags || finalStatus !== status) {
      await tx
        .update(syncInbox)
        .set({ status: finalStatus, resultCode: finalCode, flags: finalFlags })
        .where(and(eq(syncInbox.tenantId, device.tenantId), eq(syncInbox.docId, doc.id)));
    }
    if (finalStatus !== 'rejected') await linkWaiting(tx, device.tenantId, doc.id, now);
  }
  return {
    id: doc.id,
    status: finalStatus,
    ...(finalCode ? { code: finalCode } : {}),
    flags: finalFlags,
    receivedAt: row!.receivedAt.toISOString(),
  };
}

/** The status a new document gets, from what it carries and what the inbox already holds. */
async function classify(
  tx: Transaction,
  device: DeviceClaims,
  doc: SyncDocument,
  prepared: Prepared,
  now: Date,
): Promise<{ status: StoredStatus; code: string | null; flags: SyncFlag[] }> {
  const rejected = (code: string) => ({ status: 'rejected' as const, code, flags: [] });
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(doc.contractVersion)) return rejected('contract_unsupported');

  const parsed = doc.number ? parseDocNumber(doc.number) : null;
  if (parsed) {
    if (parsed.deviceCode !== device.code || parsed.branchCode !== prepared.branchCode) {
      return rejected('number_not_owned');
    }
    const [taken] = await tx
      .select({ docId: syncInbox.docId })
      .from(syncInbox)
      .where(
        and(
          eq(syncInbox.tenantId, device.tenantId),
          eq(syncInbox.docType, doc.type),
          eq(syncInbox.number, doc.number!),
          sql`${syncInbox.status} <> 'rejected'`,
        ),
      )
      .limit(1);
    if (taken) return rejected('number_conflict');
  }

  // A revoked device: only what it numbered up to its last announced number is accepted on its
  // own; the rest waits for the owner (17 › الجهاز الموقوف). Its clock is not trusted for this.
  if (device.revokedAt) {
    const cutOff = parsed ? (prepared.announced.get(parsed.series) ?? 0) : 0;
    if (!parsed || parsed.sequence > cutOff) {
      return { status: 'quarantined', code: 'after_revocation', flags: [] };
    }
  }

  const flags: SyncFlag[] = [];
  let status: StoredStatus = 'accepted';
  if (doc.deps.length > 0) {
    const found = await tx
      .select({ docId: syncInbox.docId, status: syncInbox.status })
      .from(syncInbox)
      .where(and(eq(syncInbox.tenantId, device.tenantId), inArray(syncInbox.docId, doc.deps)));
    // The device holds back what depends on its own refused documents; one sent in the same
    // batch as the refused document is refused with it.
    if (found.some((d) => d.status === 'rejected' || d.status === 'quarantined')) {
      return rejected('dependency_rejected');
    }
    // A return for a sale of another device that has not arrived yet: accepted, linked later.
    if (found.length < new Set(doc.deps).size) {
      status = 'pending_link';
      flags.push('pending_link');
    }
  }

  const correctedDeviceTime = Date.parse(doc.deviceTime) - doc.deviceOffsetMs;
  if (correctedDeviceTime - now.getTime() > CLOCK_SKEW_MS) flags.push('clock_skew');
  return { status, code: null, flags };
}

/** Documents that were waiting for this one, and now have every dependency, become accepted. */
async function linkWaiting(tx: Transaction, tenantId: string, docId: string, now: Date): Promise<void> {
  await tx.execute(sql`
    update sync_inbox w
    set status = 'accepted', flags = array_remove(w.flags, 'pending_link'), processed_at = ${now.toISOString()}::timestamptz
    where w.tenant_id = ${tenantId} and w.status = 'pending_link' and w.deps @> array[${docId}]::uuid[]
      and not exists (
        select 1 from unnest(w.deps) as d(id)
        where not exists (
          select 1 from sync_inbox i
          where i.tenant_id = w.tenant_id and i.doc_id = d.id and i.status in ('accepted', 'pending_link')))`);
}

async function recordAnnounced(tx: Transaction, device: DeviceClaims, lastIssued: Record<string, number>) {
  for (const [series, last] of Object.entries(lastIssued)) {
    await tx
      .insert(docSequences)
      .values({ tenantId: device.tenantId, deviceId: device.deviceId, series, lastAnnounced: last })
      .onConflictDoUpdate({
        target: [docSequences.tenantId, docSequences.deviceId, docSequences.series],
        set: { lastAnnounced: sql`greatest(${docSequences.lastAnnounced}, excluded.last_announced)` },
      });
  }
}

async function recordReceived(tx: Transaction, device: DeviceClaims, received: Map<string, number>) {
  for (const [series, last] of received) {
    await tx
      .insert(docSequences)
      .values({ tenantId: device.tenantId, deviceId: device.deviceId, series, lastReceived: last })
      .onConflictDoUpdate({
        target: [docSequences.tenantId, docSequences.deviceId, docSequences.series],
        set: { lastReceived: sql`greatest(${docSequences.lastReceived}, excluded.last_received)` },
      });
  }
}
