import type { DocType } from '../doc-types';
import type { OutboxEntry, OutboxStatus } from '../outbox';
import type { PullSetPage, SyncFlag } from '../protocol';

/**
 * What a linked device keeps about itself (replaces the step-1 localStorage record). Until the
 * device is activated (17 › POST /v1/devices/activate) it may hold only the names shown on the
 * login screen; it then gets its server id, its token and its numbering codes.
 */
export interface DeviceRecord {
  storeName: string;
  branchName: string;
  deviceName: string;
  /** Server id of the device (devices.id) */
  deviceId: string | null;
  /** Long device token sent as `Authorization: Device <token>` */
  token: string | null;
  /** 3-digit codes used in document numbers (INV-<branch>-<device>-<seq>) */
  branchCode: string | null;
  deviceCode: string | null;
  /** Sets this device pulls; empty = what the server gives its kind */
  sets: string[];
}

export interface NewDocument {
  type: DocType;
  payload: Record<string, unknown>;
  deps?: string[];
  businessDate: string;
  engineVersion: string;
}

export interface CreateContext {
  now: number;
  newId: () => string;
}

export interface SyncMeta {
  /** The server epoch last seen; null before the first answer */
  serverEpoch: number | null;
  /** Device clock minus server clock (ms) at the last answer */
  clockOffsetMs: number;
  lastPushAt: number | null;
  lastPullAt: number | null;
  /** True once navigator.storage.persist() was granted */
  storagePersisted: boolean | null;
}

export interface ResultUpdate {
  seq: number;
  status: OutboxStatus;
  error: string | null;
  flags: SyncFlag[];
}

/**
 * Storage behind the sync loops. The browser uses Dexie (IndexedDB, `@serva/sync/dexie`); the
 * Windows and Android builds can implement the same interface over SQLite. Every method is one
 * local transaction: it happens entirely or not at all.
 */
export interface SyncStore {
  getDevice(): Promise<DeviceRecord | null>;
  putDevice(device: DeviceRecord): Promise<void>;

  /**
   * Saves a document in the outbox, with its id, its seq, its number and a second copy in the
   * journal, in one transaction: the number is taken only if the document is saved.
   */
  createDocument(input: NewDocument, context: CreateContext): Promise<OutboxEntry>;
  /** Pending entries in seq order */
  listPending(): Promise<OutboxEntry[]>;
  listByStatus(status: OutboxStatus): Promise<OutboxEntry[]>;
  heldIds(): Promise<Set<string>>;
  /** Stores the answer for each sent document */
  recordResults(updates: ResultUpdate[], now: number): Promise<void>;
  /** Counts a failed attempt for these entries */
  recordAttempt(seqs: number[], error: string): Promise<void>;
  /** The highest seq among confirmed entries, 0 when none */
  maxConfirmedSeq(): Promise<number>;
  /** Puts confirmed entries with seq above `afterSeq` back in the queue; returns how many */
  requeueConfirmed(afterSeq: number): Promise<number>;
  /** Forgets confirmed entries confirmed before this time */
  pruneConfirmed(before: number): Promise<number>;
  /** The last number issued per series with the current codes (heartbeat) */
  lastIssued(): Promise<Record<string, number>>;
  countPending(): Promise<number>;

  getMeta(): Promise<SyncMeta>;
  setMeta(patch: Partial<SyncMeta>): Promise<void>;
  /**
   * After the server epoch changed (restore from backup): records the new epoch, puts every
   * retained confirmed document back in the queue and forgets every pulled set and cursor, in
   * one transaction, so a crash in the middle cannot leave half of it done.
   */
  restartAfterRestore(serverEpoch: number): Promise<{ requeued: number }>;

  getCursors(): Promise<Record<string, string>>;
  /** Applies a pull page to the local cache and saves the new cursors, all at once */
  applyPullPage(sets: Record<string, PullSetPage>, now: number): Promise<void>;
  /** Drops the cached rows and cursors of these sets so they download again */
  resetSets(sets: string[]): Promise<void>;
  /** Rows of a pulled set */
  readSet(set: string): Promise<Array<Record<string, unknown> & { id: string }>>;
}

export const EMPTY_META: SyncMeta = {
  serverEpoch: null,
  clockOffsetMs: 0,
  lastPushAt: null,
  lastPullAt: null,
  storagePersisted: null,
};
