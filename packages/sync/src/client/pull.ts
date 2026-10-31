import { epochChanged } from '../outbox';
import { INITIAL_CURSOR, type PullSetPage } from '../protocol';
import { BootstrapError, downloadSnapshot } from './bootstrap';
import type { SyncStore } from './store';
import type { SyncTransport } from './transport';

export interface PullOptions {
  store: SyncStore;
  transport: SyncTransport;
  now?: () => number;
  /** Rows per page; the server's maximum (5,000) by default */
  limit?: number;
}

export type PullRun =
  /** A page was applied; `hasMore` asks for the next one */
  | { kind: 'pulled'; hasMore: boolean; rows: number }
  /** The server asked to download these sets again; their rows and cursors were dropped */
  | { kind: 'resync'; sets: string[] }
  /** The server epoch changed: every set downloads again and confirmed documents are resent */
  | { kind: 'restarted'; requeued: number }
  | { kind: 'failed'; reason: string; retryAfterMs: number | null }
  | { kind: 'stopped'; reason: 'unauthorized' | 'revoked' | 'refused' };

/**
 * Pulls what changed since the device's cursors (15 › السحب إلى الجهاز): one cursor per set,
 * kept on the device, never on the server. A page and its new cursors are applied in one local
 * transaction, so a crash in the middle leaves the old cursors and the page is simply pulled again.
 */
export class Puller {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly now: () => number;
  private readonly limit: number | undefined;

  constructor(options: PullOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.now = options.now ?? Date.now;
    this.limit = options.limit;
  }

  private async requestCursors(): Promise<Record<string, string>> {
    const [device, cursors] = await Promise.all([this.store.getDevice(), this.store.getCursors()]);
    const sets = device?.sets.length ? device.sets : Object.keys(cursors);
    const request: Record<string, string> = {};
    for (const set of sets) request[set] = cursors[set] ?? INITIAL_CURSOR;
    return request;
  }

  async pullOnce(): Promise<PullRun> {
    const res = await this.transport.pull(await this.requestCursors(), this.limit);
    if (!res.ok) {
      switch (res.kind) {
        case 'unauthorized':
        case 'revoked':
          return { kind: 'stopped', reason: res.kind };
        case 'refused':
          return { kind: 'stopped', reason: 'refused' };
        case 'busy':
          return { kind: 'failed', reason: 'busy', retryAfterMs: res.retryAfterMs };
        case 'too_large':
          return { kind: 'failed', reason: 'too_large', retryAfterMs: null };
        default:
          return { kind: 'failed', reason: res.kind, retryAfterMs: null };
      }
    }
    const body = res.body;
    const meta = await this.store.getMeta();
    if (epochChanged(meta.serverEpoch, body.serverEpoch)) {
      const { requeued } = await this.store.restartAfterRestore(body.serverEpoch);
      return { kind: 'restarted', requeued };
    }
    if (meta.serverEpoch === null) await this.store.setMeta({ serverEpoch: body.serverEpoch });

    const resync = body.commands?.resync ?? [];
    const pages: Record<string, PullSetPage> = {};
    let rows = 0;
    for (const [set, page] of Object.entries(body.sets)) {
      if (resync.includes(set)) continue;
      pages[set] = page;
      rows += page.upserts.length + page.deletes.length;
    }
    const now = this.now();
    await this.store.applyPullPage(pages, now);
    await this.store.setMeta({ lastPullAt: now });
    if (resync.length > 0) {
      await this.store.resetSets(resync);
      return { kind: 'resync', sets: resync };
    }
    return { kind: 'pulled', hasMore: body.hasMore, rows };
  }

  /**
   * Downloads these sets again from scratch (after local damage, or when asked to): tells the
   * server, then drops their rows and cursors so the next pull starts them over.
   */
  async resync(sets: string[]): Promise<PullRun> {
    const res = await this.transport.resync(sets);
    if (!res.ok) {
      if (res.kind === 'unauthorized' || res.kind === 'revoked') return { kind: 'stopped', reason: res.kind };
      return {
        kind: 'failed',
        reason: res.kind,
        retryAfterMs: res.kind === 'busy' ? res.retryAfterMs : null,
      };
    }
    const meta = await this.store.getMeta();
    if (epochChanged(meta.serverEpoch, res.body.serverEpoch)) {
      const { requeued } = await this.store.restartAfterRestore(res.body.serverEpoch);
      return { kind: 'restarted', requeued };
    }
    const names = Object.keys(res.body.sets);
    try {
      // The answer is a snapshot of those sets: they are replaced at once, then pulled from its cursors.
      const snapshot = await downloadSnapshot(this.transport, res.body, { maxAttempts: 3 });
      await this.store.applySnapshot({ sets: snapshot.sets, cursors: snapshot.cursors }, this.now());
    } catch (error) {
      if (!(error instanceof BootstrapError)) throw error;
      if (error.reason === 'unauthorized' || error.reason === 'revoked') {
        return { kind: 'stopped', reason: error.reason };
      }
      // No snapshot: the sets download again from the start with the next pulls.
      await this.store.resetSets(names);
    }
    return { kind: 'resync', sets: names };
  }

  /** Pulls pages until nothing more is waiting, a pull fails, or `maxPages` were taken. */
  async drain(maxPages = 1000): Promise<PullRun> {
    let last: PullRun = { kind: 'pulled', hasMore: false, rows: 0 };
    for (let i = 0; i < maxPages; i++) {
      last = await this.pullOnce();
      if (last.kind === 'failed' || last.kind === 'stopped') return last;
      if (last.kind === 'pulled' && !last.hasMore) return last;
    }
    return last;
  }
}
