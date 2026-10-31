import { Dexie, type DexieOptions, type Table } from 'dexie';
import type { DeviceKeyPair, DeviceRecord, SyncMeta } from '../client/store';
import type { OutboxEntry } from '../outbox';
import type { SyncDocument } from '../protocol';

/**
 * The device database (09 › قاعدة الجهاز، 15 › مخطط قاعدة الجهاز). Separate from the server's
 * tables, and its migrations only go forward: a new Dexie version adds to the schema below, it
 * never rewrites an earlier one.
 *
 * - device: the one record of this device (who it is, its token, its numbering codes)
 * - outbox (sync_outbox): every document as it will be sent, until confirmed + 30 days
 * - counters: last number per series and codes, and the per-device seq
 * - sync_cursors: change_xid cursor per pulled set
 * - meta: server epoch, clock offset, last sync times
 * - records: the local cache of pulled sets (products, users, settings…)
 * - doc_journal: the second copy of every document, written in the same transaction
 * - keys (v2): the device's ECDSA key pair, private key not extractable
 */
export interface DeviceRow extends DeviceRecord {
  key: 'self';
}
export interface CounterRow {
  name: string;
  last: number;
}
export interface CursorRow {
  set: string;
  cursor: string;
  updatedAt: number;
}
export interface MetaRow {
  key: 'sync';
  value: SyncMeta;
}
export interface RecordRow {
  set: string;
  id: string;
  data: Record<string, unknown> & { id: string };
}
export interface JournalRow {
  id: string;
  seq: number;
  doc: SyncDocument;
  savedAt: number;
}

export interface KeyRow {
  key: 'device';
  keys: DeviceKeyPair;
}

export const DEVICE_DB_NAME = 'serva-device';

export class DeviceDatabase extends Dexie {
  device!: Table<DeviceRow, 'self'>;
  outbox!: Table<OutboxEntry, number>;
  counters!: Table<CounterRow, string>;
  sync_cursors!: Table<CursorRow, string>;
  meta!: Table<MetaRow, 'sync'>;
  records!: Table<RecordRow, [string, string]>;
  doc_journal!: Table<JournalRow, string>;
  keys!: Table<KeyRow, 'device'>;

  constructor(name: string = DEVICE_DB_NAME, options: DexieOptions = {}) {
    // Saving a sale must reach the disk before its receipt prints (15 › الحفظ على القرص فعلاً).
    super(name, { chromeTransactionDurability: 'strict', ...options });
    this.version(1).stores({
      device: '&key',
      outbox: '&seq, &id, status, [status+seq], [status+confirmedAt]',
      counters: '&name',
      sync_cursors: '&set',
      meta: '&key',
      records: '&[set+id], set',
      doc_journal: '&id, seq',
    });
    // The device's key pair (CryptoKey objects are stored as they are: structured-cloneable).
    this.version(2).stores({ keys: '&key' });
  }
}
