import type { DocType } from './doc-types';
import { utf8Length } from './hash';
import type { PushResult, SyncCommands, SyncDocument, SyncFlag } from './protocol';

/**
 * The device outbox (09 › قاعدة الجهاز: sync_outbox). A document enters it in the same local
 * transaction that saves it and takes its number, then leaves only by being confirmed by the
 * server; confirmed documents stay 30 days so they can be resent after a server restore.
 *
 * - pending: waiting to be sent (or sent, with no answer yet: the server ignores the duplicate);
 * - confirmed: the server holds it (accepted, duplicate of an accepted one, pending_link);
 * - held: set aside (rejected, id_conflict, quarantined, too large on its own). It does not stop
 *   the queue, but documents of this device that depend on it wait with it.
 */
export type OutboxStatus = 'pending' | 'confirmed' | 'held';

export interface OutboxEntry {
  /** Per-device creation order; the primary key of the outbox */
  seq: number;
  id: string;
  type: DocType;
  /** Size of the document's JSON (bytes), for batch limits */
  bytes: number;
  doc: SyncDocument;
  status: OutboxStatus;
  attempts: number;
  /** Last error or rejection code, for the manager's rejected list */
  lastError: string | null;
  flags: SyncFlag[];
  createdAt: number;
  confirmedAt: number | null;
}

export function documentBytes(doc: SyncDocument): number {
  return utf8Length(JSON.stringify(doc));
}

export interface BatchLimits {
  maxDocs: number;
  maxBytes: number;
}

/**
 * Picks the next batch: pending entries in seq order, as many as fit the limits. An entry that
 * depends (directly or through another waiting entry) on a held document of this device stays
 * back, and so does nothing else. The first entry is always taken even when it alone exceeds the
 * byte limit, so the server can answer 413 for it and the device can hold it.
 */
export function selectBatch(
  pending: readonly OutboxEntry[],
  heldIds: ReadonlySet<string>,
  limits: BatchLimits,
): { batch: OutboxEntry[]; blocked: OutboxEntry[] } {
  const waiting = new Set(heldIds);
  const batch: OutboxEntry[] = [];
  const blocked: OutboxEntry[] = [];
  let bytes = 0;
  for (const entry of [...pending].sort((a, b) => a.seq - b.seq)) {
    if (entry.doc.deps.some((dep) => waiting.has(dep))) {
      waiting.add(entry.id);
      blocked.push(entry);
      continue;
    }
    if (batch.length >= limits.maxDocs) break;
    if (batch.length > 0 && bytes + entry.bytes > limits.maxBytes) break;
    batch.push(entry);
    bytes += entry.bytes;
  }
  return { batch, blocked };
}

/** What the device does with a document after the server's answer. */
export function outcomeOf(result: PushResult): OutboxStatus {
  const status = result.status === 'duplicate' ? (result.outcome ?? 'accepted') : result.status;
  switch (status) {
    case 'accepted':
    case 'pending_link':
      return 'confirmed';
    case 'retry':
      return 'pending';
    default:
      return 'held';
  }
}

/** The answer of one push, as the device stores it. */
export interface PushOutcome {
  results: PushResult[];
  serverEpoch: number;
  resendFrom: number;
  commands: SyncCommands;
}

/**
 * Server epoch (15 › الحقبة بعد الاستعادة): every sync answer carries it; a new value means the
 * server was restored from a backup and may have lost documents it had confirmed.
 */
export function epochChanged(known: number | null, received: number): boolean {
  return known !== null && known !== received;
}
