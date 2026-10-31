import { Dexie } from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DeviceDatabase, DeviceNotLinkedError, DexieSyncStore } from '../src/dexie';
import { createUuidV7, payloadHash, syncDocumentSchema } from '../src';
import { freshStore, linkedDevice, linkedStore, sale } from './helpers';

const ctx = (now = Date.parse('2026-10-30T09:00:00Z')) => ({ now, newId: createUuidV7({ now: () => now }) });

describe('device database (Dexie)', () => {
  it('saves a document with its id, seq, number, hash and a journal copy, in one step', async () => {
    const store = await linkedStore();
    const entry = await store.createDocument(sale(), ctx());

    expect(entry).toMatchObject({ seq: 1, status: 'pending', attempts: 0, type: 'sale' });
    expect(entry.doc.number).toBe('INV-001-002-0000001');
    const { hash, ...body } = entry.doc;
    expect(hash).toBe(payloadHash(body));
    expect(syncDocumentSchema.safeParse(entry.doc).success).toBe(true);
    expect(await store.db.doc_journal.get(entry.id)).toMatchObject({ seq: 1, doc: entry.doc });
    expect(await store.countPending()).toBe(1);
  });

  it('numbers each series on its own, with no gap, and one seq across all types', async () => {
    const store = await linkedStore();
    const docs = [];
    for (const type of ['sale', 'sale', 'return', 'customer', 'sale', 'receipt'] as const) {
      const input = type === 'customer' ? sale(0, { type, payload: { name: 'زبون' } }) : sale(100, { type });
      docs.push((await store.createDocument(input, ctx())).doc);
    }
    expect(docs.map((d) => [d.seq, d.number])).toEqual([
      [1, 'INV-001-002-0000001'],
      [2, 'INV-001-002-0000002'],
      [3, 'SRT-001-002-0000001'],
      [4, null],
      [5, 'INV-001-002-0000003'],
      [6, 'RCV-001-002-0000001'],
    ]);
    expect(await store.lastIssued()).toEqual({ INV: 3, SRT: 1, RCV: 1 });
  });

  it('does not consume a number when saving fails part way (no gap after a crash)', async () => {
    const store = await linkedStore();
    await store.createDocument(sale(), ctx());
    await expect(
      store.createDocument(sale(), {
        now: Date.now(),
        newId: () => {
          throw new Error('power cut');
        },
      }),
    ).rejects.toThrow('power cut');
    // An unhashable payload fails inside the same transaction too.
    await expect(store.createDocument(sale(1, { payload: { total: 1.5 } }), ctx())).rejects.toThrow();

    const next = await store.createDocument(sale(), ctx());
    expect(next.doc.number).toBe('INV-001-002-0000002');
    expect(next.seq).toBe(2);
    expect(await store.db.outbox.count()).toBe(2);
    expect(await store.db.doc_journal.count()).toBe(2);
  });

  it('a re-activated device (new device code) starts its own series, so no printed number repeats', async () => {
    const store = await linkedStore();
    await store.createDocument(sale(), ctx());
    const device = (await store.getDevice())!;
    await store.putDevice({ ...device, deviceCode: '003' });
    const next = await store.createDocument(sale(), ctx());
    expect(next.doc.number).toBe('INV-001-003-0000001');
    expect(next.seq).toBe(2);
  });

  it('refuses numbered documents before the device is linked, but takes unnumbered ones', async () => {
    const store = freshStore();
    await expect(store.createDocument(sale(), ctx())).rejects.toThrow(DeviceNotLinkedError);
    const customer = await store.createDocument(
      sale(0, { type: 'customer', payload: { name: 'سمير' } }),
      ctx(),
    );
    expect(customer.doc.number).toBeNull();
    expect(await store.lastIssued()).toEqual({});
  });

  it('applies a pull page and its cursors at once, and forgets a set on resync', async () => {
    const store = await linkedStore();
    await store.applyPullPage(
      {
        users: {
          upserts: [
            { id: 'u1', name: 'سارة' },
            { id: 'u2', name: 'علي' },
          ],
          deletes: [],
          cursor: '10',
        },
        branches: { upserts: [{ id: 'b1' }], deletes: [], cursor: '7' },
      },
      1,
    );
    await store.applyPullPage(
      { users: { upserts: [{ id: 'u1', name: 'سارة م' }], deletes: ['u2'], cursor: '12' } },
      2,
    );
    expect(await store.readSet('users')).toEqual([{ id: 'u1', name: 'سارة م' }]);
    expect(await store.getCursors()).toEqual({ users: '12', branches: '7' });

    await store.resetSets(['users']);
    expect(await store.readSet('users')).toEqual([]);
    expect(await store.getCursors()).toEqual({ branches: '7' });
  });

  it('applies a snapshot in one step: its sets replaced, their cursors and the epoch saved, other sets kept', async () => {
    const store = await linkedStore();
    await store.applyPullPage(
      {
        users: { upserts: [{ id: 'stale' }], deletes: [], cursor: '3' },
        roles: { upserts: [{ id: 'r1' }], deletes: [], cursor: '3' },
      },
      1,
    );
    await store.applySnapshot(
      { sets: { users: [{ id: 'u1' }, { id: 'u2' }], branches: [] }, cursors: { users: '9', branches: '9' } },
      2,
    );
    expect(await store.readSet('users')).toEqual([{ id: 'u1' }, { id: 'u2' }]);
    expect(await store.readSet('roles')).toEqual([{ id: 'r1' }]);
    expect(await store.getCursors()).toEqual({ users: '9', branches: '9', roles: '3' });
    expect((await store.getMeta()).serverEpoch).toBeNull();
    await store.applySnapshot({ sets: {}, cursors: {}, serverEpoch: 5 }, 3);
    expect(await store.getMeta()).toMatchObject({ serverEpoch: 5, lastPullAt: 3 });
  });

  it('opens a database made by the first version and keeps what it holds (forward-only upgrade)', async () => {
    const factory = new IDBFactory();
    const old = new Dexie('upgrade-test', { indexedDB: factory, IDBKeyRange });
    old
      .version(1)
      .stores({ device: '&key', outbox: '&seq, &id, status, [status+seq], [status+confirmedAt]' });
    await old.table('device').put({ ...linkedDevice(), key: 'self' });
    old.close();

    const store = new DexieSyncStore(new DeviceDatabase('upgrade-test', { indexedDB: factory, IDBKeyRange }));
    expect(await store.getDevice()).toEqual(linkedDevice());
    expect(await store.getDeviceKeys()).toBeNull();
    expect(store.db.verno).toBe(2);
  });

  it('after a server restore, queues every retained confirmed document again and forgets pulled data', async () => {
    const store = await linkedStore();
    const a = await store.createDocument(sale(), ctx());
    const b = await store.createDocument(sale(), ctx());
    await store.createDocument(sale(), ctx());
    await store.recordResults(
      [
        { seq: a.seq, status: 'confirmed', error: null, flags: [] },
        { seq: b.seq, status: 'held', error: 'rejected', flags: [] },
      ],
      5,
    );
    await store.applyPullPage({ users: { upserts: [{ id: 'u1' }], deletes: [], cursor: '9' } }, 1);
    await store.setMeta({ serverEpoch: 1 });

    expect(await store.restartAfterRestore(2)).toEqual({ requeued: 1 });
    expect((await store.listPending()).map((e) => e.seq)).toEqual([1, 3]);
    expect([...(await store.heldIds())]).toEqual([b.id]);
    expect(await store.getCursors()).toEqual({});
    expect(await store.readSet('users')).toEqual([]);
    expect((await store.getMeta()).serverEpoch).toBe(2);
  });

  it('keeps confirmed documents 30 days, then forgets them and their journal copy', async () => {
    const store = await linkedStore();
    const old = await store.createDocument(sale(), ctx());
    const recent = await store.createDocument(sale(), ctx());
    const pending = await store.createDocument(sale(), ctx());
    await store.recordResults([{ seq: old.seq, status: 'confirmed', error: null, flags: [] }], 1_000);
    await store.recordResults([{ seq: recent.seq, status: 'confirmed', error: null, flags: [] }], 5_000);

    expect(await store.pruneConfirmed(2_000)).toBe(1);
    expect((await store.db.outbox.toArray()).map((e) => e.seq)).toEqual([recent.seq, pending.seq]);
    expect(await store.db.doc_journal.get(old.id)).toBeUndefined();
    expect(await store.maxConfirmedSeq()).toBe(recent.seq);
    expect(await store.requeueConfirmed(1)).toBe(1);
    expect(await store.maxConfirmedSeq()).toBe(0);
  });
});
