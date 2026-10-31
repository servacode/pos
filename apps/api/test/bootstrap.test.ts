import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseSnapshot, type BootstrapResponse, type PullResponse } from '@serva/sync';
import { Puller, runBootstrap, saveActivatedDevice } from '@serva/sync/client';
import { DeviceDatabase, DexieSyncStore } from '@serva/sync/dexie';
import { ManualClock } from '../src/clock';
import { requestedRange } from '../src/routes/sync';
import {
  createDevice,
  firstBranch,
  injectTransport,
  linkDevice,
  type Fault,
  type TestDevice,
} from './devices';
import {
  closeAppDb,
  closeOwnerDb,
  makeApp,
  ownerDb,
  registerStore,
  resetDatabase,
  snapshotDir,
} from './helpers';
import { seedCatalog } from './catalog-fixtures';
import { TEST_OWNER_URL } from './urls';

let app: FastifyInstance;
let clock: ManualClock;
let dbCount = 0;

beforeAll(async () => {
  clock = new ManualClock();
  app = await makeApp({ SNAPSHOT_TTL_SECONDS: '600' }, { clock });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
  clock.set('2026-10-30T09:00:00.000Z');
});

async function store(phone = '0911111111') {
  const { body } = await registerStore(app, { phone });
  return { tenantId: body.tenant.id as string, accessToken: body.accessToken as string };
}

async function bootstrap(device: TestDevice): Promise<BootstrapResponse> {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/sync/bootstrap',
    headers: { authorization: device.authorization },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const download = (device: TestDevice, url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { authorization: device.authorization, ...headers } });

/** Every set from cursor 0, page by page, applied the way a device applies pages. */
async function fullPull(device: TestDevice) {
  const local: Record<string, Map<string, Record<string, unknown>>> = {};
  let cursors: Record<string, string> = {};
  for (;;) {
    const query = new URLSearchParams({ cursors: JSON.stringify(cursors), limit: '2' });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?${query.toString()}`,
      headers: { authorization: device.authorization },
    });
    const page = res.json<PullResponse>();
    for (const [set, data] of Object.entries(page.sets)) {
      const rows = (local[set] ??= new Map());
      for (const row of data.upserts) rows.set(row.id, row);
      for (const id of data.deletes) rows.delete(id);
      cursors = { ...cursors, [set]: data.cursor };
    }
    if (!page.hasMore) break;
  }
  return Object.fromEntries(
    Object.entries(local).map(([set, rows]) => [
      set,
      [...rows.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    ]),
  );
}

describe('GET /v1/sync/bootstrap and the snapshot file', () => {
  it('describes a gzip NDJSON snapshot whose size and sha256 match, holding every set of a full pull', async () => {
    const { tenantId, accessToken } = await store();
    const catalog = await seedCatalog(app, tenantId, accessToken);
    const device = await createDevice(tenantId);
    const info = await bootstrap(device);
    expect(info).toMatchObject({
      contractVersion: 1,
      serverEpoch: 1,
      url: `/v1/sync/snapshots/${info.snapshotId}`,
      expiresAt: '2026-10-30T09:10:00.000Z',
    });
    expect(Object.keys(info.cursors).sort()).toEqual([
      'barcodes',
      'branches',
      'categories',
      'exchange_rates',
      'prices',
      'products',
      'roles',
      'settings',
      'stock_levels',
      'tax_rates',
      'units',
      'user_roles',
      'users',
      'variants',
    ]);

    const file = await download(device, info.url);
    expect(file.statusCode).toBe(200);
    expect(file.headers).toMatchObject({
      'content-type': 'application/gzip',
      'accept-ranges': 'bytes',
      etag: `"${info.sha256}"`,
      'content-length': String(info.bytes),
    });
    expect(file.headers['content-encoding']).toBeUndefined();
    expect(file.rawPayload.length).toBe(info.bytes);
    expect(createHash('sha256').update(file.rawPayload).digest('hex')).toBe(info.sha256);

    const snapshot = parseSnapshot(gunzipSync(file.rawPayload).toString('utf8'));
    expect(snapshot.cursors).toEqual(info.cursors);
    const sorted = Object.fromEntries(
      Object.entries(snapshot.sets).map(([set, rows]) => [
        set,
        [...rows].sort((a, b) => a.id.localeCompare(b.id)),
      ]),
    );
    expect(sorted).toEqual(await fullPull(device));
    expect(JSON.stringify(snapshot)).not.toMatch(/passwordHash|pinHash|\$argon2|\+963/);
    // Real catalog rows, and only the device's branch's stock.
    expect(sorted.products).toHaveLength(2);
    expect(sorted.variants).toHaveLength(3);
    expect(sorted.prices).toHaveLength(3);
    expect(sorted.barcodes).toHaveLength(3);
    expect(sorted.units).toHaveLength(2);
    expect(sorted.stock_levels).toEqual([expect.objectContaining({ branchId: device.branchId, qty: 24000 })]);
    expect(JSON.stringify(sorted.stock_levels)).not.toContain(catalog.otherBranchId);
  });

  it('resumes with Range (206), restarts when If-Range no longer matches, and refuses a range past the end', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const info = await bootstrap(device);
    const whole = (await download(device, info.url)).rawPayload;

    const rest = await download(device, info.url, { range: 'bytes=100-', 'if-range': `"${info.sha256}"` });
    expect(rest.statusCode).toBe(206);
    expect(rest.headers['content-range']).toBe(`bytes 100-${info.bytes - 1}/${info.bytes}`);
    expect(Buffer.compare(rest.rawPayload, whole.subarray(100))).toBe(0);

    const middle = await download(device, info.url, { range: 'bytes=10-19' });
    expect(middle.statusCode).toBe(206);
    expect(Buffer.compare(middle.rawPayload, whole.subarray(10, 20))).toBe(0);

    const changed = await download(device, info.url, { range: 'bytes=100-', 'if-range': '"another"' });
    expect(changed.statusCode).toBe(200);
    expect(changed.rawPayload.length).toBe(info.bytes);

    const past = await download(device, info.url, { range: `bytes=${info.bytes}-` });
    expect(past.statusCode).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${info.bytes}`);
  });

  it('reuses a recent snapshot for the branch, makes a new one later or after a restore, and deletes expired files', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const first = await bootstrap(device);
    expect((await bootstrap(await createDevice(tenantId))).snapshotId).toBe(first.snapshotId);

    clock.advance(5 * 60_000);
    const second = await bootstrap(device);
    expect(second.snapshotId).not.toBe(first.snapshotId);
    // The first file can still be downloaded until it expires.
    expect((await download(device, first.url)).statusCode).toBe(200);

    await ownerDb()`select server_epoch_bump()`;
    const third = await bootstrap(device);
    expect(third.snapshotId).not.toBe(second.snapshotId);
    expect(third.serverEpoch).toBe(2);

    clock.advance(5 * 60_000);
    expect((await download(device, first.url)).statusCode).toBe(404);
    await bootstrap(device);
    expect((await readdir(snapshotDir)).filter((f) => f.startsWith(first.snapshotId))).toEqual([]);
  });

  it('refuses a revoked device, and an unknown snapshot id', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const info = await bootstrap(device);
    expect((await download(device, '/v1/sync/snapshots/../../etc/passwd')).statusCode).toBe(404);
    expect(
      (await download(device, '/v1/sync/snapshots/0192a000-0000-7000-8000-000000000001')).statusCode,
    ).toBe(404);
    await ownerDb()`update devices set status = 'revoked', revoked_at = now() where id = ${device.deviceId}`;
    const res = await download(device, info.url);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('device_revoked');
  });
});

describe('a new device with the real client: link, bootstrap, then pull', () => {
  async function newDevice(name: string) {
    dbCount += 1;
    return new DexieSyncStore(
      new DeviceDatabase(`bootstrap-${name}-${dbCount}`, { indexedDB: new IDBFactory(), IDBKeyRange }),
    );
  }

  it('bootstrap followed by pull equals a full pull, even with a write that commits during the snapshot', async () => {
    const { tenantId, accessToken } = await store();
    const catalog = await seedCatalog(app, tenantId, accessToken);
    const linked = await linkDevice(app, accessToken, await firstBranch(tenantId));
    const local = await newDevice('a');
    await saveActivatedDevice(local, linked.activated);
    const faults: Fault[] = [];
    const transport = injectTransport(app, linked, faults);

    // A slow transaction takes its id before the snapshot and commits after it; a later one
    // commits before it.
    const slow = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {}, idle_timeout: 5 });
    const reserved = await slow.reserve();
    let open = false;
    try {
      await reserved`begin`;
      open = true;
      await reserved`update branches set name = 'فرع بطيء' where tenant_id = ${tenantId}`;
      await ownerDb()`update users set full_name = 'سريع' where tenant_id = ${tenantId}`;
      await ownerDb()`insert into users (tenant_id, full_name) values (${tenantId}, 'موظف جديد')`;

      // The download is cut half way once: the client asks for the rest.
      faults.push('none', 'cut_body');
      const progress: number[] = [];
      await runBootstrap({
        store: local,
        transport,
        onProgress: (p) => progress.push(p.received),
        sleep: async () => {},
      });
      const downloads = transport.requests.filter((r) => r.url.startsWith('/v1/sync/snapshots/'));
      expect(downloads).toHaveLength(2);
      expect(downloads[1]!.headers.Range).toMatch(/^bytes=\d+-$/);
      expect(progress.at(-1)).toBeGreaterThan(0);

      // Neither write is in the snapshot: the later one waits for the slow one (xmin). The user
      // it changed has moved past the snapshot's bound, so it comes with the pull.
      expect((await local.readSet('branches')).map((b) => b.name).sort()).toEqual([
        'الفرع الرئيسي',
        'فرع الرشيد',
      ]);
      expect(await local.readSet('users')).toEqual([]);

      await reserved`commit`;
      open = false;
    } finally {
      if (open) await reserved`rollback`;
      reserved.release();
      await slow.end({ timeout: 1 });
    }
    // And more writes after it all: a price edit, a barcode removed, a product archived.
    const [tea, shirt] = catalog.products;
    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/products/${tea!.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        version: tea!.version,
        variants: [
          { id: tea!.variants[0]!.id, price: { currency: 'SYP', priceMinor: 4_750_000 }, barcodes: [] },
        ],
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/v1/products/${shirt!.id}/archive`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    await ownerDb()`delete from user_roles where tenant_id = ${tenantId}`;
    expect((await new Puller({ store: local, transport, limit: 2 }).drain()).kind).toBe('pulled');
    const full = await fullPull(linked);
    for (const [set, rows] of Object.entries(full)) {
      const mine = [...(await local.readSet(set))].sort((a, b) => a.id.localeCompare(b.id));
      expect(mine, set).toEqual(rows);
    }
    expect((await local.readSet('branches')).map((b) => b.name)).toEqual(['فرع بطيء', 'فرع بطيء']);
    expect((await local.readSet('users')).map((u) => u.fullName).sort()).toEqual(['سريع', 'موظف جديد']);
    expect(await local.readSet('user_roles')).toEqual([]);
    expect((await local.readSet('prices')).map((p) => p.priceMinor).sort()).toEqual([1200, 1300, 4_750_000]);
    expect((await local.readSet('barcodes')).map((b) => b.code)).toEqual([
      shirt!.variants[1]!.barcodes[0]!.code,
    ]);
    expect((await local.readSet('products')).find((p) => p.id === shirt!.id)).toMatchObject({
      archived: true,
    });
    expect((await local.getMeta()).serverEpoch).toBe(1);
  });
});

describe('POST /v1/sync/heartbeat', () => {
  it('records what the device reports, and refuses a malformed heartbeat', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const send = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/sync/heartbeat',
        headers: { authorization: device.authorization },
        payload,
      });
    const good = {
      contractVersion: 1,
      appVersion: '1.4.0',
      sentAt: '2026-10-30T08:59:58.500Z',
      lastIssued: { INV: 12, RCV: 3 },
      unsentCount: 2,
      storageUsedBytes: 123_456_789,
    };
    const res = await send(good);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      contractVersion: 1,
      serverEpoch: 1,
      serverTime: '2026-10-30T09:00:00.000Z',
      commands: {},
    });
    const [row] = await ownerDb()`
      select last_seen_at, last_heartbeat_at, unsent_count, storage_used_bytes, app_version, clock_offset_ms
      from devices where id = ${device.deviceId}`;
    expect(row).toMatchObject({
      unsent_count: 2,
      storage_used_bytes: '123456789',
      app_version: '1.4.0',
      clock_offset_ms: -1500,
    });
    expect(row!.last_heartbeat_at.toISOString()).toBe('2026-10-30T09:00:00.000Z');
    const sequences = await ownerDb()`
      select series, last_announced from doc_sequences where device_id = ${device.deviceId} order by series`;
    expect(sequences).toEqual([
      { series: 'INV', last_announced: 12 },
      { series: 'RCV', last_announced: 3 },
    ]);
    // Announced numbers only go up.
    await send({ ...good, lastIssued: { INV: 4 } });
    const [inv] = await ownerDb()<{ last_announced: number }[]>`
      select last_announced from doc_sequences where device_id = ${device.deviceId} and series = 'INV'`;
    expect(inv!.last_announced).toBe(12);

    for (const bad of [
      { ...good, unsentCount: -1 },
      { ...good, lastIssued: { invoice: 1 } },
      { ...good, sentAt: 'yesterday' },
      { ...good, storageUsedBytes: 1.5 },
      { contractVersion: 1 },
    ]) {
      expect((await send(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe('requestedRange', () => {
  const etag = '"e"';
  it('reads one byte range, and falls back to the whole file when it cannot', () => {
    expect(requestedRange(undefined, undefined, etag, 100)).toBeNull();
    expect(requestedRange('bytes=0-', undefined, etag, 100)).toEqual({ start: 0, end: 99 });
    expect(requestedRange('bytes=10-19', etag, etag, 100)).toEqual({ start: 10, end: 19 });
    expect(requestedRange('bytes=90-500', undefined, etag, 100)).toEqual({ start: 90, end: 99 });
    expect(requestedRange('bytes=-10', undefined, etag, 100)).toEqual({ start: 90, end: 99 });
    expect(requestedRange('bytes=-500', undefined, etag, 100)).toEqual({ start: 0, end: 99 });
    expect(requestedRange('bytes=100-', undefined, etag, 100)).toBe('unsatisfiable');
    expect(requestedRange('bytes=-0', undefined, etag, 100)).toBe('unsatisfiable');
    expect(requestedRange('bytes=0-1,5-6', undefined, etag, 100)).toBeNull();
    expect(requestedRange('bytes=20-10', undefined, etag, 100)).toBeNull();
    expect(requestedRange('items=0-1', undefined, etag, 100)).toBeNull();
    expect(requestedRange('bytes=-', undefined, etag, 100)).toBeNull();
    expect(requestedRange('bytes=5-', '"old"', etag, 100)).toBeNull();
  });
});
