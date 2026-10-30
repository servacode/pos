import { epochChanged, outcomeOf, selectBatch, type OutboxEntry } from '../outbox';
import {
  CONTRACT_VERSION,
  PUSH_MAX_DOCUMENTS,
  PUSH_TARGET_BYTES,
  type PushResponse,
  type SyncCommands,
} from '../protocol';
import type { ResultUpdate, SyncStore } from './store';
import type { SyncTransport } from './transport';

export interface PushOptions {
  store: SyncStore;
  transport: SyncTransport;
  appVersion: string;
  now?: () => number;
  maxDocs?: number;
  maxBytes?: number;
}

export type PushRun =
  /** Nothing to send */
  | { kind: 'idle' }
  /** A batch was answered */
  | { kind: 'sent'; sent: number; confirmed: number; held: number; retry: number; commands: SyncCommands }
  /** 413: the next batch is smaller; send again at once */
  | { kind: 'split'; maxDocs: number }
  /** The server epoch changed: confirmed documents are queued again */
  | { kind: 'restarted'; requeued: number }
  /** Nothing reached the server or it is busy: wait (backoff) and try again */
  | { kind: 'failed'; reason: string; retryAfterMs: number | null }
  /** The device token was refused, or the device revoked: stop until something changes */
  | { kind: 'stopped'; reason: 'unauthorized' | 'revoked' | 'refused' };

/**
 * Sends the outbox in creation order (15 › الإرسال). Each call sends one batch of at most 50
 * documents and 4 MB; on 413 the next batch is half the size. Everything it knows lives in the
 * store, so after a crash or a restart it simply carries on: a batch sent without an answer is
 * sent again and the server answers «duplicate».
 */
export class Pusher {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly appVersion: string;
  private readonly now: () => number;
  private readonly maxDocsLimit: number;
  private readonly maxBytes: number;
  private maxDocs: number;

  constructor(options: PushOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.appVersion = options.appVersion;
    this.now = options.now ?? Date.now;
    this.maxDocsLimit = options.maxDocs ?? PUSH_MAX_DOCUMENTS;
    this.maxBytes = options.maxBytes ?? PUSH_TARGET_BYTES;
    this.maxDocs = this.maxDocsLimit;
  }

  get batchSize(): number {
    return this.maxDocs;
  }

  async pushOnce(): Promise<PushRun> {
    const [pending, held] = await Promise.all([this.store.listPending(), this.store.heldIds()]);
    const { batch } = selectBatch(pending, held, { maxDocs: this.maxDocs, maxBytes: this.maxBytes });
    if (batch.length === 0) return { kind: 'idle' };

    const res = await this.transport.push({
      contractVersion: CONTRACT_VERSION,
      appVersion: this.appVersion,
      sentAt: new Date(this.now()).toISOString(),
      lastIssued: await this.store.lastIssued(),
      documents: batch.map((entry) => entry.doc),
    });

    if (!res.ok) {
      switch (res.kind) {
        case 'too_large':
          if (batch.length > 1) {
            this.maxDocs = Math.max(1, Math.floor(batch.length / 2));
            return { kind: 'split', maxDocs: this.maxDocs };
          }
          // One document alone is too large: set it aside for support, the queue goes on.
          await this.store.recordResults(
            [{ seq: batch[0]!.seq, status: 'held', error: 'payload_too_large', flags: [] }],
            this.now(),
          );
          return { kind: 'sent', sent: 1, confirmed: 0, held: 1, retry: 0, commands: {} };
        case 'unauthorized':
        case 'revoked':
          return { kind: 'stopped', reason: res.kind };
        case 'refused':
          await this.store.recordAttempt(
            batch.map((e) => e.seq),
            `refused_${res.status}`,
          );
          return { kind: 'stopped', reason: 'refused' };
        case 'busy':
          await this.store.recordAttempt(
            batch.map((e) => e.seq),
            'busy',
          );
          return { kind: 'failed', reason: 'busy', retryAfterMs: res.retryAfterMs };
        default:
          await this.store.recordAttempt(
            batch.map((e) => e.seq),
            res.kind,
          );
          return { kind: 'failed', reason: res.kind, retryAfterMs: null };
      }
    }

    const restarted = await this.observeEpoch(res.body);
    const counts = await this.recordAnswer(batch, res.body);
    if (this.maxDocs < this.maxDocsLimit) this.maxDocs = Math.min(this.maxDocsLimit, this.maxDocs * 2);
    if (restarted !== null) return { kind: 'restarted', requeued: restarted };
    return { kind: 'sent', sent: batch.length, ...counts, commands: res.body.commands ?? {} };
  }

  /** Sends batches until the queue is empty or a send fails; returns the last run. */
  async drain(maxBatches = 1000): Promise<PushRun> {
    let last: PushRun = { kind: 'idle' };
    for (let i = 0; i < maxBatches; i++) {
      last = await this.pushOnce();
      if (last.kind === 'idle' || last.kind === 'failed' || last.kind === 'stopped') return last;
    }
    return last;
  }

  /** Returns the number of requeued documents when the epoch changed, else null. */
  private async observeEpoch(body: PushResponse): Promise<number | null> {
    const meta = await this.store.getMeta();
    if (epochChanged(meta.serverEpoch, body.serverEpoch)) {
      return (await this.store.restartAfterRestore(body.serverEpoch)).requeued;
    }
    if (meta.serverEpoch === null) await this.store.setMeta({ serverEpoch: body.serverEpoch });
    return null;
  }

  private async recordAnswer(
    batch: OutboxEntry[],
    body: PushResponse,
  ): Promise<{ confirmed: number; held: number; retry: number }> {
    const bySeq = new Map(batch.map((entry) => [entry.id, entry.seq]));
    const updates: ResultUpdate[] = [];
    const counts = { confirmed: 0, held: 0, retry: 0 };
    for (const result of body.results) {
      const seq = bySeq.get(result.id);
      if (seq === undefined) continue;
      bySeq.delete(result.id);
      const status = outcomeOf(result);
      if (status === 'confirmed') counts.confirmed++;
      else if (status === 'held') counts.held++;
      else counts.retry++;
      const reason = result.status === 'duplicate' ? (result.outcome ?? 'accepted') : result.status;
      updates.push({
        seq,
        status,
        error: status === 'confirmed' ? null : (result.code ?? reason),
        flags: result.flags ?? [],
      });
    }
    // The server held nothing of ours above resendFrom before this batch: anything confirmed
    // above it was lost (a restore whose epoch bump was missed) and goes back in the queue. The
    // documents of this batch are not confirmed yet, so they are not touched.
    if ((await this.store.maxConfirmedSeq()) > body.resendFrom) {
      await this.store.requeueConfirmed(body.resendFrom);
    }
    const now = this.now();
    await this.store.recordResults(updates, now);
    // A document the server did not answer for stays pending and is sent again.
    if (bySeq.size > 0) await this.store.recordAttempt([...bySeq.values()], 'no_answer');

    const serverTime = Date.parse(body.serverTime);
    await this.store.setMeta({
      lastPushAt: now,
      ...(Number.isFinite(serverTime) ? { clockOffsetMs: now - serverTime } : {}),
    });
    return counts;
  }
}
