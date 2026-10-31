import type { DexieOptions } from 'dexie';
import {
  EMPTY_META,
  type AppliedSnapshot,
  type CreateContext,
  type DeviceKeyPair,
  type DeviceRecord,
  type NewDocument,
  type ResultUpdate,
  type SyncMeta,
  type SyncStore,
} from '../client/store';
import { seriesOf } from '../doc-types';
import { formatDocNumber, MAX_SEQUENCE } from '../numbering';
import { documentBytes, type OutboxEntry, type OutboxStatus } from '../outbox';
import { CONTRACT_VERSION, payloadHash, type PullSetPage, type SyncDocumentBody } from '../protocol';
import { DeviceDatabase } from './database';

export class DeviceNotLinkedError extends Error {
  override readonly name = 'DeviceNotLinkedError';
  constructor() {
    super('This device has no numbering codes yet: link it before saving numbered documents');
  }
}

const SEQ_COUNTER = 'seq';
const seriesCounter = (series: string, branchCode: string, deviceCode: string) =>
  `series:${series}:${branchCode}:${deviceCode}`;

const between = (status: OutboxStatus, from: number = -Infinity, to: number = Infinity) =>
  [
    [status, from],
    [status, to],
  ] as const;

/** SyncStore over the Dexie device database. */
export class DexieSyncStore implements SyncStore {
  constructor(readonly db: DeviceDatabase) {}

  async getDevice(): Promise<DeviceRecord | null> {
    const row = await this.db.device.get('self');
    if (!row) return null;
    const { key: _key, ...device } = row;
    return device;
  }

  async putDevice(device: DeviceRecord): Promise<void> {
    await this.db.device.put({ ...device, key: 'self' });
  }

  async getDeviceKeys(): Promise<DeviceKeyPair | null> {
    return (await this.db.keys.get('device'))?.keys ?? null;
  }

  async putDeviceKeys(keys: DeviceKeyPair): Promise<void> {
    await this.db.keys.put({ key: 'device', keys });
  }

  async createDocument(input: NewDocument, context: CreateContext): Promise<OutboxEntry> {
    const { db } = this;
    return db.transaction('rw', [db.device, db.counters, db.outbox, db.doc_journal, db.meta], async () => {
      const device = await db.device.get('self');
      const series = seriesOf(input.type);
      let number: string | null = null;
      if (series !== null) {
        if (!device?.branchCode || !device.deviceCode) throw new DeviceNotLinkedError();
        const name = seriesCounter(series, device.branchCode, device.deviceCode);
        const last = (await db.counters.get(name))?.last ?? 0;
        if (last >= MAX_SEQUENCE) throw new RangeError(`series ${series} is exhausted on this device`);
        await db.counters.put({ name, last: last + 1 });
        number = formatDocNumber({
          series,
          branchCode: device.branchCode,
          deviceCode: device.deviceCode,
          sequence: last + 1,
        });
      }
      const seq = ((await db.counters.get(SEQ_COUNTER))?.last ?? 0) + 1;
      await db.counters.put({ name: SEQ_COUNTER, last: seq });
      const meta = (await db.meta.get('sync'))?.value;

      const body: SyncDocumentBody = {
        id: context.newId(),
        seq,
        type: input.type,
        number,
        deviceTime: new Date(context.now).toISOString(),
        businessDate: input.businessDate,
        deviceOffsetMs: meta?.clockOffsetMs ?? 0,
        engineVersion: input.engineVersion,
        contractVersion: CONTRACT_VERSION,
        deps: input.deps ?? [],
        payload: input.payload,
      };
      const doc = { ...body, hash: payloadHash(body) };
      const entry: OutboxEntry = {
        seq,
        id: doc.id,
        type: doc.type,
        bytes: documentBytes(doc),
        doc,
        status: 'pending',
        attempts: 0,
        lastError: null,
        flags: [],
        createdAt: context.now,
        confirmedAt: null,
      };
      await db.outbox.add(entry);
      await db.doc_journal.add({ id: doc.id, seq, doc, savedAt: context.now });
      return entry;
    });
  }

  listPending(): Promise<OutboxEntry[]> {
    return this.db.outbox
      .where('[status+seq]')
      .between(...between('pending'), true, true)
      .toArray();
  }

  listByStatus(status: OutboxStatus): Promise<OutboxEntry[]> {
    return this.db.outbox
      .where('[status+seq]')
      .between(...between(status), true, true)
      .toArray();
  }

  async heldIds(): Promise<Set<string>> {
    const held = await this.db.outbox.where('status').equals('held').toArray();
    return new Set(held.map((entry) => entry.id));
  }

  async recordResults(updates: ResultUpdate[], now: number): Promise<void> {
    if (updates.length === 0) return;
    const bySeq = new Map(updates.map((u) => [u.seq, u]));
    await this.db.outbox
      .where('seq')
      .anyOf([...bySeq.keys()])
      .modify((entry) => {
        const update = bySeq.get(entry.seq)!;
        entry.status = update.status;
        entry.attempts += 1;
        entry.lastError = update.error;
        entry.flags = update.flags;
        entry.confirmedAt = update.status === 'confirmed' ? now : null;
      });
  }

  async recordAttempt(seqs: number[], error: string): Promise<void> {
    if (seqs.length === 0) return;
    await this.db.outbox
      .where('seq')
      .anyOf(seqs)
      .modify((entry) => {
        entry.attempts += 1;
        entry.lastError = error;
      });
  }

  async maxConfirmedSeq(): Promise<number> {
    const last = await this.db.outbox
      .where('[status+seq]')
      .between(...between('confirmed'), true, true)
      .last();
    return last?.seq ?? 0;
  }

  requeueConfirmed(afterSeq: number): Promise<number> {
    return this.db.outbox
      .where('[status+seq]')
      .between(...between('confirmed', afterSeq), false, true)
      .modify({ status: 'pending', confirmedAt: null });
  }

  async pruneConfirmed(before: number): Promise<number> {
    const { db } = this;
    return db.transaction('rw', [db.outbox, db.doc_journal], async () => {
      const old = await db.outbox
        .where('[status+confirmedAt]')
        .between(['confirmed', -Infinity], ['confirmed', before], true, false)
        .toArray();
      await db.outbox.bulkDelete(old.map((entry) => entry.seq));
      await db.doc_journal.bulkDelete(old.map((entry) => entry.id));
      return old.length;
    });
  }

  async lastIssued(): Promise<Record<string, number>> {
    const device = await this.db.device.get('self');
    if (!device?.branchCode || !device.deviceCode) return {};
    const suffix = `:${device.branchCode}:${device.deviceCode}`;
    const rows = await this.db.counters.where('name').startsWith('series:').toArray();
    const issued: Record<string, number> = {};
    for (const row of rows) {
      if (!row.name.endsWith(suffix)) continue;
      issued[row.name.slice('series:'.length, -suffix.length)] = row.last;
    }
    return issued;
  }

  countPending(): Promise<number> {
    return this.db.outbox.where('status').equals('pending').count();
  }

  async getMeta(): Promise<SyncMeta> {
    return { ...EMPTY_META, ...(await this.db.meta.get('sync'))?.value };
  }

  async setMeta(patch: Partial<SyncMeta>): Promise<void> {
    const { db } = this;
    await db.transaction('rw', db.meta, async () => {
      const current = { ...EMPTY_META, ...(await db.meta.get('sync'))?.value };
      await db.meta.put({ key: 'sync', value: { ...current, ...patch } });
    });
  }

  async restartAfterRestore(serverEpoch: number): Promise<{ requeued: number }> {
    const { db } = this;
    return db.transaction('rw', [db.meta, db.outbox, db.sync_cursors, db.records], async () => {
      const current = { ...EMPTY_META, ...(await db.meta.get('sync'))?.value };
      await db.meta.put({ key: 'sync', value: { ...current, serverEpoch } });
      const requeued = await db.outbox
        .where('status')
        .equals('confirmed')
        .modify({ status: 'pending', confirmedAt: null });
      await db.sync_cursors.clear();
      await db.records.clear();
      return { requeued };
    });
  }

  async getCursors(): Promise<Record<string, string>> {
    const rows = await this.db.sync_cursors.toArray();
    return Object.fromEntries(rows.map((row) => [row.set, row.cursor]));
  }

  async applyPullPage(sets: Record<string, PullSetPage>, now: number): Promise<void> {
    const { db } = this;
    await db.transaction('rw', [db.records, db.sync_cursors], async () => {
      for (const [set, page] of Object.entries(sets)) {
        if (page.deletes.length > 0) await db.records.bulkDelete(page.deletes.map((id) => [set, id]));
        if (page.upserts.length > 0) {
          await db.records.bulkPut(page.upserts.map((data) => ({ set, id: data.id, data })));
        }
        await db.sync_cursors.put({ set, cursor: page.cursor, updatedAt: now });
      }
    });
  }

  async resetSets(sets: string[]): Promise<void> {
    const { db } = this;
    await db.transaction('rw', [db.records, db.sync_cursors], async () => {
      await db.records.where('set').anyOf(sets).delete();
      await db.sync_cursors.bulkDelete(sets);
    });
  }

  async applySnapshot(snapshot: AppliedSnapshot, now: number): Promise<void> {
    const { db } = this;
    await db.transaction('rw', [db.records, db.sync_cursors, db.meta], async () => {
      for (const [set, rows] of Object.entries(snapshot.sets)) {
        await db.records.where('set').equals(set).delete();
        if (rows.length > 0) await db.records.bulkPut(rows.map((data) => ({ set, id: data.id, data })));
      }
      for (const [set, cursor] of Object.entries(snapshot.cursors)) {
        await db.sync_cursors.put({ set, cursor, updatedAt: now });
      }
      if (snapshot.serverEpoch !== undefined) {
        const current = { ...EMPTY_META, ...(await db.meta.get('sync'))?.value };
        await db.meta.put({
          key: 'sync',
          value: { ...current, serverEpoch: snapshot.serverEpoch, lastPullAt: now },
        });
      }
    });
  }

  async readSet(set: string): Promise<Array<Record<string, unknown> & { id: string }>> {
    const rows = await this.db.records.where('set').equals(set).toArray();
    return rows.map((row) => row.data);
  }
}

/** Opens (creating or upgrading) the device database and returns a store over it. */
export function openDeviceStore(name?: string, options?: DexieOptions): DexieSyncStore {
  return new DexieSyncStore(new DeviceDatabase(name, options));
}
