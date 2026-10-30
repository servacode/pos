import type { OutboxEntry } from '../outbox';
import { CONFIRMED_RETENTION_DAYS } from '../protocol';
import { uuidv7 } from '../uuid';
import { backoffDelay } from './backoff';
import { Puller, type PullRun } from './pull';
import { Pusher, type PushRun } from './push';
import type { NewDocument, SyncStore } from './store';
import type { SyncTransport } from './transport';

export interface SyncState {
  pending: number;
  online: boolean;
  /** Failed cycles in a row; the next try waits backoffDelay(failures) */
  failures: number;
  lastPush: PushRun['kind'] | null;
  lastPull: PullRun['kind'] | null;
  /** Set when the server refused the device; sync stays off until restarted */
  stopped: 'unauthorized' | 'revoked' | 'refused' | null;
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

export interface SyncEngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  appVersion: string;
  now?: () => number;
  random?: () => number;
  newId?: () => string;
  timers?: Timers;
  isOnline?: () => boolean;
  /** How often to pull while connected (15 › التوقيت: every 30 seconds) */
  pullIntervalMs?: number;
  /** A saved document is sent this soon (15: within seconds) */
  pushDelayMs?: number;
  onState?: (state: SyncState) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Runs the push and pull loops: right after a document is saved, every 30 seconds while
 * connected, and with growing delays (2 s to 5 min) while the server cannot be reached.
 */
export class SyncEngine {
  readonly pusher: Pusher;
  readonly puller: Puller;
  private readonly store: SyncStore;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newId: () => string;
  private readonly timers: Timers;
  private readonly isOnline: () => boolean;
  private readonly pullIntervalMs: number;
  private readonly pushDelayMs: number;
  private readonly onState: ((state: SyncState) => void) | undefined;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private again = false;
  private started = false;
  private state: SyncState = {
    pending: 0,
    online: true,
    failures: 0,
    lastPush: null,
    lastPull: null,
    stopped: null,
  };

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.newId = options.newId ?? uuidv7;
    this.timers = options.timers ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    this.isOnline = options.isOnline ?? (() => true);
    this.pullIntervalMs = options.pullIntervalMs ?? 30_000;
    this.pushDelayMs = options.pushDelayMs ?? 1_000;
    this.onState = options.onState;
    const shared = { store: options.store, transport: options.transport, now: this.now };
    this.pusher = new Pusher({ ...shared, appVersion: options.appVersion });
    this.puller = new Puller(shared);
  }

  get current(): SyncState {
    return this.state;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  stop(): void {
    this.started = false;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** Saves a document locally (it is safe once this resolves) and sends it soon. */
  async save(input: NewDocument): Promise<OutboxEntry> {
    const entry = await this.store.createDocument(input, { now: this.now(), newId: this.newId });
    await this.publish({ pending: await this.store.countPending() });
    if (this.started && this.state.stopped === null) this.schedule(this.pushDelayMs);
    return entry;
  }

  /** One full cycle now: send everything, then pull everything. Concurrent calls share one run. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.cycle().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cycle(): Promise<void> {
    do {
      this.again = false;
      await this.runOnce();
    } while (this.again && this.state.stopped === null);
    if (this.started && this.state.stopped === null) {
      this.schedule(
        this.state.failures > 0 ? backoffDelay(this.state.failures, this.random) : this.pullIntervalMs,
      );
    }
  }

  private async runOnce(): Promise<void> {
    const online = this.isOnline();
    if (!online) {
      await this.publish({ online, pending: await this.store.countPending() });
      return;
    }
    const push = await this.pusher.drain();
    let pull: PullRun | null = null;
    if (push.kind !== 'stopped') pull = await this.puller.drain();
    // A restart (new server epoch) queued confirmed documents again: send them in this cycle.
    if (pull?.kind === 'restarted') await this.pusher.drain();

    const failed = push.kind === 'failed' || pull?.kind === 'failed';
    const stopped = push.kind === 'stopped' ? push.reason : pull?.kind === 'stopped' ? pull.reason : null;
    await this.store.pruneConfirmed(this.now() - CONFIRMED_RETENTION_DAYS * DAY_MS);
    await this.publish({
      online,
      pending: await this.store.countPending(),
      failures: failed ? this.state.failures + 1 : 0,
      lastPush: push.kind,
      lastPull: pull?.kind ?? null,
      stopped,
    });
  }

  private schedule(ms: number): void {
    if (!this.started) return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.syncNow();
    }, ms);
  }

  private async publish(patch: Partial<SyncState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    this.onState?.(this.state);
  }
}
