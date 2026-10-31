import { CONTRACT_VERSION, type SyncCommands } from '../protocol';
import type { SyncStore } from './store';
import type { SyncTransport } from './transport';

export interface HeartbeatOptions {
  store: SyncStore;
  transport: SyncTransport;
  appVersion: string;
  now?: () => number;
  /** At most one heartbeat this often (default 60 s) */
  intervalMs?: number;
  /** Bytes the device database uses, when the platform can tell */
  storageUsage?: () => Promise<number | null>;
}

/** skipped: one was sent within the interval */
export type HeartbeatRun =
  { kind: 'skipped' } | { kind: 'sent'; commands: SyncCommands } | { kind: 'failed'; reason: string };

/**
 * The heartbeat (15 › إشارة حياة): the last number issued per series, how many documents wait to be
 * sent, the app version, the clock and the space used. The server compares the numbers with what
 * reached it, so the owner sees what a device still holds even when it cannot send.
 */
export class Heartbeat {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly appVersion: string;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly storageUsage: () => Promise<number | null>;
  private lastSentAt: number | null = null;

  constructor(options: HeartbeatOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.appVersion = options.appVersion;
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.storageUsage = options.storageUsage ?? (async () => null);
  }

  /** Sends one unless one was sent within the interval (or `force`). */
  async beat(force = false): Promise<HeartbeatRun> {
    const now = this.now();
    if (!force && this.lastSentAt !== null && now - this.lastSentAt < this.intervalMs) {
      return { kind: 'skipped' };
    }
    const [lastIssued, unsentCount, storageUsedBytes] = await Promise.all([
      this.store.lastIssued(),
      this.store.countPending(),
      this.storageUsage().catch(() => null),
    ]);
    const res = await this.transport.heartbeat({
      contractVersion: CONTRACT_VERSION,
      appVersion: this.appVersion,
      sentAt: new Date(now).toISOString(),
      lastIssued,
      unsentCount,
      storageUsedBytes: storageUsedBytes === null ? null : Math.max(0, Math.round(storageUsedBytes)),
    });
    if (!res.ok) return { kind: 'failed', reason: res.kind };
    this.lastSentAt = now;
    const serverTime = Date.parse(res.body.serverTime);
    if (Number.isFinite(serverTime)) await this.store.setMeta({ clockOffsetMs: now - serverTime });
    return { kind: 'sent', commands: res.body.commands ?? {} };
  }
}
