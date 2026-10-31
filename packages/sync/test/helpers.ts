import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type {
  DeviceRecord,
  DownloadOptions,
  NewDocument,
  SyncTransport,
  TransportResult,
} from '../src/client';
import { DexieSyncStore, DeviceDatabase } from '../src/dexie';
import {
  CONTRACT_VERSION,
  INITIAL_CURSOR,
  payloadHash,
  pushRequestSchema,
  type BootstrapResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushResult,
  type ResyncResponse,
  type SnapshotLine,
  type StoredStatus,
} from '../src';

let dbCounter = 0;

/** A Dexie store over a fresh in-memory IndexedDB. */
export function freshStore(): DexieSyncStore {
  dbCounter += 1;
  return new DexieSyncStore(
    new DeviceDatabase(`test-${dbCounter}`, { indexedDB: new IDBFactory(), IDBKeyRange }),
  );
}

export function linkedDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    storeName: 'مقهى الياسمين',
    branchName: 'الفرع الرئيسي',
    deviceName: 'كاشير 2',
    deviceId: '0192a000-0000-7000-8000-000000000002',
    token: 'sdt_test',
    branchCode: '001',
    deviceCode: '002',
    sets: [],
    ...overrides,
  };
}

export async function linkedStore(overrides: Partial<DeviceRecord> = {}): Promise<DexieSyncStore> {
  const store = freshStore();
  await store.putDevice(linkedDevice(overrides));
  return store;
}

export function sale(total = 1500, overrides: Partial<NewDocument> = {}): NewDocument {
  return {
    type: 'sale',
    payload: { total, currency: 'SYP', lines: [{ lineNo: 1, variantId: 'v1', qty: 1000, price: total }] },
    businessDate: '2026-10-30',
    engineVersion: '1.0.0',
    ...overrides,
  };
}

/** A clock tests move by hand. */
export function manualClock(start = Date.parse('2026-10-30T09:00:00Z')) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

// ─── A model server: the contract's rules, in memory ─────────────────────────

interface InboxRow {
  hash: string;
  deviceId: string;
  seq: number;
  number: string | null;
  type: string;
  status: StoredStatus;
  receivedAt: string;
}

interface ServerState {
  epoch: number;
  inbox: Map<string, InboxRow>;
  xid: number;
  rows: Map<
    string,
    Map<string, { xid: number; data: Record<string, unknown> & { id: string }; deleted: boolean }>
  >;
}

const clone = (state: ServerState): ServerState => ({
  epoch: state.epoch,
  inbox: new Map(state.inbox),
  xid: state.xid,
  rows: new Map([...state.rows].map(([set, rows]) => [set, new Map(rows)])),
});

/**
 * Implements push, pull and resync the way the contract describes them, so the device loops can
 * be exercised against lost requests, lost answers, replays and restores without a database.
 */
export class ModelServer {
  state: ServerState = { epoch: 1, inbox: new Map(), xid: 0, rows: new Map() };
  /** Results of id_conflict answers: should never happen to a well-behaved device */
  readonly conflicts: string[] = [];

  snapshot(): ServerState {
    return clone(this.state);
  }

  /** Restores a backup: everything after it is lost and the epoch moves on. */
  restore(backup: ServerState): void {
    const epoch = this.state.epoch + 1;
    this.state = clone(backup);
    this.state.epoch = epoch;
  }

  write(set: string, data: Record<string, unknown> & { id: string }): void {
    this.state.xid += 1;
    const rows = this.state.rows.get(set) ?? new Map();
    rows.set(data.id, { xid: this.state.xid, data, deleted: false });
    this.state.rows.set(set, rows);
  }

  remove(set: string, id: string): void {
    this.state.xid += 1;
    const rows = this.state.rows.get(set);
    const row = rows?.get(id);
    if (rows && row) rows.set(id, { ...row, xid: this.state.xid, deleted: true });
  }

  push(deviceId: string, request: PushRequest, now = new Date()): PushResponse {
    const req = pushRequestSchema.parse(request);
    const results: PushResult[] = [];
    const resendFrom = Math.max(
      0,
      ...[...this.state.inbox.values()].filter((r) => r.deviceId === deviceId).map((r) => r.seq),
    );
    for (const doc of req.documents) {
      const { hash, ...body } = doc;
      if (payloadHash(body) !== hash) {
        results.push({ id: doc.id, status: 'rejected', code: 'hash_mismatch', flags: [] });
        continue;
      }
      const existing = this.state.inbox.get(doc.id);
      if (existing) {
        if (existing.hash === hash) {
          results.push({
            id: doc.id,
            status: 'duplicate',
            outcome: existing.status,
            flags: [],
            receivedAt: existing.receivedAt,
          });
        } else {
          this.conflicts.push(doc.id);
          results.push({ id: doc.id, status: 'id_conflict', flags: [] });
        }
        continue;
      }
      const numberTaken =
        doc.number !== null &&
        [...this.state.inbox.values()].some(
          (row) => row.type === doc.type && row.number === doc.number && row.status !== 'rejected',
        );
      const missingDep = doc.deps.some((dep) => !this.state.inbox.has(dep));
      const rejectedDep = doc.deps.some((dep) => {
        const status = this.state.inbox.get(dep)?.status;
        return status === 'rejected' || status === 'quarantined';
      });
      const code = numberTaken ? 'number_conflict' : rejectedDep ? 'dependency_rejected' : null;
      const status: StoredStatus = code ? 'rejected' : missingDep ? 'pending_link' : 'accepted';
      const receivedAt = now.toISOString();
      this.state.inbox.set(doc.id, {
        hash,
        deviceId,
        seq: doc.seq,
        number: doc.number,
        type: doc.type,
        status,
        receivedAt,
      });
      results.push({
        id: doc.id,
        status,
        flags: status === 'pending_link' ? ['pending_link'] : [],
        receivedAt,
        ...(code ? { code } : {}),
      });
    }
    return {
      contractVersion: CONTRACT_VERSION,
      serverEpoch: this.state.epoch,
      serverTime: now.toISOString(),
      resendFrom,
      results,
      commands: {},
    };
  }

  pull(cursors: Record<string, string>, limit = 5000): PullResponse {
    const sets = Object.keys(cursors).length > 0 ? Object.keys(cursors) : [...this.state.rows.keys()];
    const out: PullResponse['sets'] = {};
    let hasMore = false;
    for (const set of sets) {
      const after = Number((cursors[set] ?? INITIAL_CURSOR).split('.')[0]);
      const changed = [...(this.state.rows.get(set)?.values() ?? [])]
        .filter((row) => row.xid > after)
        .sort((a, b) => a.xid - b.xid);
      const page = changed.slice(0, limit);
      if (changed.length > limit) hasMore = true;
      const cursor = page.length === limit && hasMore ? page.at(-1)!.xid : Math.max(after, this.state.xid);
      out[set] = {
        upserts: page.filter((r) => !r.deleted).map((r) => r.data),
        deletes: page.filter((r) => r.deleted).map((r) => r.data.id),
        cursor: String(cursor),
      };
    }
    return {
      contractVersion: CONTRACT_VERSION,
      serverEpoch: this.state.epoch,
      serverTime: new Date().toISOString(),
      sets: out,
      hasMore,
      commands: {},
    };
  }

  /** Snapshot files by id, as the server keeps them */
  readonly files = new Map<string, Uint8Array>();
  readonly heartbeats: HeartbeatRequest[] = [];

  /** A snapshot file of these sets, in the server's format, from the same rows a pull reads. */
  buildSnapshot(sets: string[] = [...this.state.rows.keys()]): BootstrapResponse {
    const snapshotId = `00000000-0000-4000-8000-${String(this.files.size + 1).padStart(12, '0')}`;
    const lines: SnapshotLine[] = [
      {
        kind: 'header',
        snapshotId,
        contractVersion: CONTRACT_VERSION,
        serverEpoch: this.state.epoch,
        createdAt: new Date().toISOString(),
        sets,
      },
    ];
    const cursors: Record<string, string> = {};
    let rows = 0;
    for (const set of sets) {
      const page = this.pull({ [set]: INITIAL_CURSOR }, Number.MAX_SAFE_INTEGER).sets[set]!;
      for (const row of page.upserts) lines.push({ kind: 'row', set, row });
      rows += page.upserts.length;
      cursors[set] = page.cursor;
      lines.push({ kind: 'cursor', set, cursor: page.cursor });
    }
    lines.push({ kind: 'end', rows });
    const file = new Uint8Array(gzipSync(lines.map((l) => `${JSON.stringify(l)}\n`).join('')));
    this.files.set(snapshotId, file);
    return {
      contractVersion: CONTRACT_VERSION,
      serverTime: new Date().toISOString(),
      snapshotId,
      url: `/v1/sync/snapshots/${snapshotId}`,
      bytes: file.length,
      sha256: createHash('sha256').update(file).digest('hex'),
      cursors,
      serverEpoch: this.state.epoch,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }

  resync(sets: string[]): ResyncResponse {
    const snapshot = this.buildSnapshot(sets);
    return {
      ...snapshot,
      sets: Object.fromEntries(sets.map((s) => [s, { cursor: INITIAL_CURSOR, snapshotUrl: snapshot.url }])),
    };
  }

  heartbeat(request: HeartbeatRequest): HeartbeatResponse {
    this.heartbeats.push(structuredClone(request));
    return {
      contractVersion: CONTRACT_VERSION,
      serverEpoch: this.state.epoch,
      serverTime: new Date().toISOString(),
      commands: {},
    };
  }
}

export type Fault = 'lose_request' | 'lose_response' | 'busy' | 'too_large';
/** cut: the connection drops after `cutAfter` bytes; restart: a 200 with the whole file to a Range */
export type DownloadFault = 'cut' | 'lose_request' | 'restart' | 'not_found';

/** A transport to a ModelServer that can lose requests or answers on demand. */
export class ModelTransport implements SyncTransport {
  readonly faults: Fault[] = [];
  /** Batches larger than this answer 413 */
  maxDocs = Infinity;
  /** Documents too large to be sent even alone */
  readonly oversized = new Set<string>();
  readonly pushes: PushRequest[] = [];

  constructor(
    readonly server: ModelServer,
    readonly deviceId: string,
  ) {}

  private fault(): Fault | undefined {
    return this.faults.shift();
  }

  async push(request: PushRequest): Promise<TransportResult<PushResponse>> {
    this.pushes.push(structuredClone(request));
    if (request.documents.length > this.maxDocs) return { ok: false, kind: 'too_large' };
    if (request.documents.some((d) => this.oversized.has(d.id))) return { ok: false, kind: 'too_large' };
    const fault = this.fault();
    if (fault === 'lose_request') return { ok: false, kind: 'network' };
    if (fault === 'busy') return { ok: false, kind: 'busy', retryAfterMs: 1000 };
    // A transient 413 models a batch over the size limit; one document alone fits.
    if (fault === 'too_large' && request.documents.length > 1) return { ok: false, kind: 'too_large' };
    const body = this.server.push(this.deviceId, structuredClone(request));
    if (fault === 'lose_response') return { ok: false, kind: 'network' };
    return { ok: true, body };
  }

  async pull(cursors: Record<string, string>, limit?: number): Promise<TransportResult<PullResponse>> {
    const fault = this.fault();
    if (fault === 'lose_request' || fault === 'lose_response') return { ok: false, kind: 'network' };
    if (fault === 'busy') return { ok: false, kind: 'busy', retryAfterMs: null };
    return { ok: true, body: this.server.pull(cursors, limit) };
  }

  async resync(sets: string[]): Promise<TransportResult<ResyncResponse>> {
    return { ok: true, body: this.server.resync(sets) };
  }

  readonly downloadFaults: DownloadFault[] = [];
  /** Bytes sent before a 'cut' */
  cutAfter = 64;
  /** Every download request: where it started from */
  readonly downloads: Array<{ offset: number; etag: string | null }> = [];
  heartbeatDown = false;

  async heartbeat(request: HeartbeatRequest): Promise<TransportResult<HeartbeatResponse>> {
    if (this.heartbeatDown) return { ok: false, kind: 'network' };
    return { ok: true, body: this.server.heartbeat(request) };
  }

  async bootstrap(): Promise<TransportResult<BootstrapResponse>> {
    return { ok: true, body: this.server.buildSnapshot() };
  }

  async download(url: string, options: DownloadOptions): Promise<TransportResult<{ complete: true }>> {
    this.downloads.push({ offset: options.offset, etag: options.etag });
    const fault = this.downloadFaults.shift();
    if (fault === 'lose_request') return { ok: false, kind: 'network' };
    const file = this.server.files.get(url.split('/').at(-1)!);
    if (!file || fault === 'not_found') return { ok: false, kind: 'refused', status: 404, code: 'not_found' };
    let from = options.offset;
    if (fault === 'restart' && from > 0) {
      options.onRestart();
      from = 0;
    }
    const rest = file.subarray(from);
    if (fault === 'cut') {
      options.onData(rest.slice(0, this.cutAfter));
      return { ok: false, kind: 'network' };
    }
    // In two pieces, as a network would.
    const half = Math.ceil(rest.length / 2);
    options.onData(rest.slice(0, half));
    options.onData(rest.slice(half));
    return { ok: true, body: { complete: true } };
  }
}
