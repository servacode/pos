import { gzipSync } from 'node:zlib';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  BootstrapError,
  createDeviceKeys,
  createFetchTransport,
  Heartbeat,
  Puller,
  runBootstrap,
  saveActivatedDevice,
  SyncEngine,
  type Timers,
} from '../src/client';
import { DeviceDatabase, DexieSyncStore } from '../src/dexie';
import { parseSnapshot, SnapshotFormatError, type SnapshotLine } from '../src';
import { freshStore, linkedStore, manualClock, ModelServer, ModelTransport, sale } from './helpers';

const DEVICE = '0192a000-0000-7000-8000-000000000002';
const noSleep = async () => undefined;

const ndjson = (lines: SnapshotLine[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const header: SnapshotLine = {
  kind: 'header',
  snapshotId: 's1',
  contractVersion: 1,
  serverEpoch: 3,
  createdAt: '2026-10-30T09:00:00.000Z',
  sets: ['users'],
};

describe('snapshot file format', () => {
  it('reads rows in order (later lines win, deletions remove), cursors and the epoch', () => {
    const parsed = parseSnapshot(
      ndjson([
        header,
        { kind: 'row', set: 'users', row: { id: 'a', v: 1 } },
        { kind: 'row', set: 'users', row: { id: 'b', v: 1 } },
        { kind: 'row', set: 'users', row: { id: 'a', v: 2 } },
        { kind: 'delete', set: 'users', id: 'b' },
        { kind: 'cursor', set: 'users', cursor: '42' },
        { kind: 'end', rows: 3 },
      ]),
    );
    expect(parsed).toEqual({
      snapshotId: 's1',
      serverEpoch: 3,
      sets: { users: [{ id: 'a', v: 2 }] },
      cursors: { users: '42' },
    });
  });

  it('refuses a cut or damaged file, so it is never half applied', () => {
    const cursor: SnapshotLine = { kind: 'cursor', set: 'users', cursor: '1' };
    const bad = [
      '',
      ndjson([{ kind: 'end', rows: 0 }]),
      ndjson([header, cursor]),
      ndjson([header, { kind: 'end', rows: 0 }]),
      ndjson([header, cursor, { kind: 'end', rows: 1 }]),
      ndjson([header, { kind: 'row', set: 'other', row: { id: 'x' } }, cursor, { kind: 'end', rows: 1 }]),
      ndjson([header, cursor, { kind: 'end', rows: 0 }, cursor]),
      `${ndjson([header, cursor])}\n{not json`,
    ];
    for (const text of bad) expect(() => parseSnapshot(text), text).toThrow(SnapshotFormatError);
  });
});

async function bootstrapSetup() {
  const store = await linkedStore();
  const server = new ModelServer();
  const transport = new ModelTransport(server, DEVICE);
  for (let i = 0; i < 30; i++)
    server.write('users', { id: `u${String(i).padStart(2, '0')}`, name: 'x'.repeat(40) });
  server.write('roles', { id: 'r1' });
  server.write('roles', { id: 'r2' });
  server.remove('roles', 'r2');
  return { store, server, transport };
}

describe('runBootstrap', () => {
  it('downloads the snapshot, applies every set with its cursors at once, and the pull carries on from there', async () => {
    const { store, server, transport } = await bootstrapSetup();
    const progress: Array<{ received: number; total: number }> = [];
    await runBootstrap({ store, transport, onProgress: (p) => progress.push(p), sleep: noSleep });

    expect((await store.readSet('users')).map((u) => u.id)).toHaveLength(30);
    expect(await store.readSet('roles')).toEqual([{ id: 'r1' }]);
    const xid = String(server.state.xid);
    expect(await store.getCursors()).toEqual({ users: xid, roles: xid });
    expect((await store.getMeta()).serverEpoch).toBe(1);
    expect(progress[0]).toEqual({ received: 0, total: progress.at(-1)!.total });
    expect(progress.at(-1)!.received).toBe(progress.at(-1)!.total);

    // Only what changed after the snapshot comes with the pull.
    server.write('users', { id: 'new' });
    const puller = new Puller({ store, transport });
    expect(await puller.pullOnce()).toEqual({ kind: 'pulled', hasMore: false, rows: 1 });
    expect(await store.readSet('users')).toHaveLength(31);
  });

  it('resumes after a lost connection from the bytes it already holds (Range, If-Range)', async () => {
    const { store, transport } = await bootstrapSetup();
    transport.cutAfter = 100;
    transport.downloadFaults.push('cut', 'lose_request', 'cut');
    const sleep = vi.fn(noSleep);
    await runBootstrap({ store, transport, sleep });
    expect(transport.downloads.map((d) => d.offset)).toEqual([0, 100, 100, 200]);
    expect(transport.downloads[1]!.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(await store.readSet('users')).toHaveLength(30);
  });

  it('starts the file again when the server sends all of it instead of the rest', async () => {
    const { store, transport } = await bootstrapSetup();
    transport.downloadFaults.push('cut', 'restart');
    await runBootstrap({ store, transport, sleep: noSleep });
    expect(await store.readSet('users')).toHaveLength(30);
  });

  it('refuses a damaged file (sha256), asks for a new snapshot once, then gives up', async () => {
    const { store, transport } = await bootstrapSetup();
    const real = transport.download.bind(transport);
    transport.download = (url, options) =>
      real(url, { ...options, onData: (chunk) => options.onData(chunk.map((b) => b ^ 0xff)) });
    const bootstrap = vi.spyOn(transport, 'bootstrap');
    await expect(runBootstrap({ store, transport, sleep: noSleep })).rejects.toEqual(
      new BootstrapError('corrupt'),
    );
    expect(bootstrap).toHaveBeenCalledTimes(2);
    // Nothing of it was applied.
    expect(await store.getCursors()).toEqual({});
    expect(await store.readSet('users')).toEqual([]);
  });

  it('asks again when the file expired (404) before it was downloaded', async () => {
    const { store, transport } = await bootstrapSetup();
    transport.downloadFaults.push('not_found');
    await runBootstrap({ store, transport, sleep: noSleep });
    expect(await store.readSet('users')).toHaveLength(30);
  });

  it('gives up after repeated failures without progress, and stops at once for a refused device', async () => {
    const { store, transport } = await bootstrapSetup();
    transport.downloadFaults.push(...Array<'lose_request'>(10).fill('lose_request'));
    await expect(runBootstrap({ store, transport, sleep: noSleep, maxAttempts: 4 })).rejects.toEqual(
      new BootstrapError('network'),
    );

    transport.bootstrap = async () => ({ ok: false, kind: 'unauthorized' });
    await expect(runBootstrap({ store, transport, sleep: noSleep })).rejects.toEqual(
      new BootstrapError('unauthorized'),
    );
    let calls = 0;
    transport.bootstrap = async () =>
      ++calls < 3 ? { ok: false, kind: 'busy', retryAfterMs: 5 } : { ok: false, kind: 'revoked' };
    const sleep = vi.fn(noSleep);
    await expect(runBootstrap({ store, transport, sleep })).rejects.toEqual(new BootstrapError('revoked'));
    expect(sleep.mock.calls).toEqual([[5], [5]]);
  });
});

describe('device activation helpers', () => {
  it('makes an ECDSA P-256 key pair whose private key never leaves the device, kept across restarts', async () => {
    const name = `keys-${Math.random()}`;
    const factory = new IDBFactory();
    const open = () => new DexieSyncStore(new DeviceDatabase(name, { indexedDB: factory, IDBKeyRange }));
    const store = open();
    const { publicKey } = await createDeviceKeys(store);
    // SPKI of a P-256 key is 91 bytes: 122 base64url characters.
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{122}$/);

    store.db.close();
    const reopened = open();
    const keys = (await reopened.getDeviceKeys())!;
    expect(keys.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', keys.privateKey)).rejects.toThrow();
    const spki = Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey)).toString('base64url');
    expect(spki).toBe(publicKey);
    const data = new TextEncoder().encode('serva');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, data);
    expect(
      await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, signature, data),
    ).toBe(true);
  });

  it('keeps an activated device so it numbers its documents with its own codes', async () => {
    const store = freshStore();
    const record = await saveActivatedDevice(store, {
      deviceId: DEVICE,
      token: `sdt_${'a'.repeat(43)}`,
      deviceCode: '007',
      tenantId: 't',
      storeName: 'مقهى الياسمين',
      branchId: 'b',
      branchCode: '002',
      branchName: 'فرع المزة',
      deviceName: 'كاشير 1',
      serverEpoch: 4,
    } as Parameters<typeof saveActivatedDevice>[1]);
    expect(record).toEqual({
      storeName: 'مقهى الياسمين',
      branchName: 'فرع المزة',
      deviceName: 'كاشير 1',
      deviceId: DEVICE,
      token: `sdt_${'a'.repeat(43)}`,
      branchCode: '002',
      deviceCode: '007',
      sets: [],
    });
    expect(await store.getDevice()).toEqual(record);
    expect((await store.getMeta()).serverEpoch).toBe(4);
    const entry = await store.createDocument(sale(), { now: Date.now(), newId: () => crypto.randomUUID() });
    expect(entry.doc.number).toBe('INV-002-007-0000001');
  });
});

describe('heartbeat', () => {
  it('sends the last number per series, the unsent count, the version and the space used, at most once a minute', async () => {
    const store = await linkedStore();
    await store.createDocument(sale(), { now: Date.now(), newId: () => crypto.randomUUID() });
    await store.createDocument(sale(), { now: Date.now(), newId: () => crypto.randomUUID() });
    const server = new ModelServer();
    const transport = new ModelTransport(server, DEVICE);
    const clock = manualClock();
    const heartbeat = new Heartbeat({
      store,
      transport,
      appVersion: '1.2.0',
      now: clock.now,
      storageUsage: async () => 1234.4,
    });
    expect(await heartbeat.beat()).toEqual({ kind: 'sent', commands: {} });
    expect(server.heartbeats).toEqual([
      {
        contractVersion: 1,
        appVersion: '1.2.0',
        sentAt: '2026-10-30T09:00:00.000Z',
        lastIssued: { INV: 2 },
        unsentCount: 2,
        storageUsedBytes: 1234,
      },
    ]);
    clock.advance(30_000);
    expect(await heartbeat.beat()).toEqual({ kind: 'skipped' });
    transport.heartbeatDown = true;
    clock.advance(30_000);
    expect(await heartbeat.beat()).toEqual({ kind: 'failed', reason: 'network' });
    transport.heartbeatDown = false;
    expect((await heartbeat.beat()).kind).toBe('sent');
    expect(server.heartbeats).toHaveLength(2);
  });

  it('goes out from the engine’s cycle, even when nothing could be sent', async () => {
    const store = await linkedStore();
    const server = new ModelServer();
    const transport = new ModelTransport(server, DEVICE);
    const timers: Timers = { set: () => null, clear: () => undefined };
    const engine = new SyncEngine({
      store,
      transport,
      appVersion: '1',
      timers,
      storageUsage: async () => null,
    });
    await engine.save(sale());
    transport.faults.push('lose_request');
    await engine.syncNow();
    expect(engine.current).toMatchObject({ lastPush: 'failed', lastHeartbeat: 'sent' });
    expect(server.heartbeats[0]).toMatchObject({
      unsentCount: 1,
      lastIssued: { INV: 1 },
      storageUsedBytes: null,
    });
  });
});

describe('fetch transport: heartbeat, bootstrap and download', () => {
  const file = new Uint8Array(gzipSync('hello snapshot'));

  /** The file, or its first `cutAfter` bytes and then a dropped connection. */
  function streamed(bytes: Uint8Array, cutAfter?: number) {
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(cutAfter === undefined ? bytes : bytes.slice(0, cutAfter));
        } else if (cutAfter === undefined) {
          controller.close();
        } else {
          controller.error(new TypeError('network'));
        }
      },
    });
  }

  it('posts the heartbeat and gets the bootstrap with the device token', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const transport = createFetchTransport({
      getToken: () => 'sdt_x',
      appVersion: '1',
      fetch,
      baseUrl: 'https://api',
    });
    await transport.heartbeat({
      contractVersion: 1,
      appVersion: '1',
      sentAt: '2026-10-30T09:00:00Z',
      unsentCount: 0,
    });
    await transport.bootstrap();
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://api/v1/sync/heartbeat', 'POST'],
      ['https://api/v1/sync/bootstrap', 'GET'],
    ]);
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe('Device sdt_x');
  });

  it('asks for the rest with Range and If-Range, keeps what came before a cut, and restarts on a 200', async () => {
    const answers = [
      new Response(streamed(file, 5), { status: 200 }),
      new Response(streamed(file.slice(5)), { status: 206 }),
      new Response(streamed(file), { status: 200 }),
      new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }),
    ];
    const fetch = vi.fn(async () => answers.shift()!);
    const transport = createFetchTransport({ getToken: () => 'sdt_x', appVersion: '1', fetch });
    const got: number[] = [];
    let restarts = 0;
    const options = (offset: number) => ({
      offset,
      etag: '"abc"',
      onData: (c: Uint8Array) => got.push(c.length),
      onRestart: () => restarts++,
    });

    expect(await transport.download('/v1/sync/snapshots/x', options(0))).toEqual({
      ok: false,
      kind: 'network',
    });
    expect(got).toEqual([5]);
    expect(await transport.download('/v1/sync/snapshots/x', options(5))).toEqual({
      ok: true,
      body: { complete: true },
    });
    expect(await transport.download('/v1/sync/snapshots/x', options(5))).toMatchObject({ ok: true });
    expect(restarts).toBe(1);
    expect(await transport.download('/v1/sync/snapshots/x', options(0))).toEqual({
      ok: false,
      kind: 'refused',
      status: 404,
      code: 'not_found',
    });
    const headers = (fetch.mock.calls as unknown as Array<[string, RequestInit]>).map(
      ([, init]) => init.headers as Record<string, string>,
    );
    expect(headers[0]!.Range).toBeUndefined();
    expect(headers[1]).toMatchObject({
      Range: 'bytes=5-',
      'If-Range': '"abc"',
      Authorization: 'Device sdt_x',
    });
  });
});
