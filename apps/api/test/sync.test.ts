import { gunzipSync, gzipSync } from 'node:zlib';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createUuidV7,
  formatDocNumber,
  parseSnapshot,
  payloadHash,
  PUSH_MAX_WIRE_BYTES,
  type DocType,
  type PullResponse,
  type PushResponse,
  type ResyncResponse,
  type SyncDocument,
  type SyncDocumentBody,
} from '@serva/sync';
import { DocumentRejection } from '../src/services/sync-push';
import { createDevice, type TestDevice } from './devices';
import {
  closeAppDb,
  closeOwnerDb,
  makeApp,
  ownerDb,
  registerStore,
  resetDatabase,
  salePayload,
} from './helpers';
import { TEST_OWNER_URL } from './urls';

let app: FastifyInstance;
const newId = createUuidV7();

beforeAll(async () => {
  app = await makeApp(
    {},
    {
      syncProcessors: {
        // Stand-ins for phase 1 posting: a sale whose printed total differs from the server's
        // computation is accepted with a flag; an unbalanced receipt is refused.
        sale: async ({ doc }) =>
          doc.payload.printedTotal !== undefined &&
          doc.payload.printedTotal !== (doc.payload.totals as { totalMinor: number }).totalMinor
            ? { flags: ['totals_mismatch'] }
            : doc.payload.permissionWithdrawn
              ? { flags: ['permission_stale'] }
              : undefined,
        receipt: async ({ doc }) => {
          if (doc.payload.unbalanced) throw new DocumentRejection('unbalanced');
        },
      },
    },
  );
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

async function store(phone = '0911111111') {
  const { body } = await registerStore(app, { phone });
  return {
    tenantId: body.tenant.id as string,
    userId: body.user.id as string,
    accessToken: body.accessToken as string,
  };
}

/** Builds documents the way a device does, numbered per series. */
function deviceDocs(device: Pick<TestDevice, 'code'>, branchCode = '001') {
  let seq = 0;
  const counters = new Map<string, number>();
  const series: Partial<Record<DocType, string>> = { sale: 'INV', return: 'SRT', receipt: 'RCV' };
  return (
    type: DocType = 'sale',
    payload: Record<string, unknown> = type === 'sale' ? salePayload(1500) : { total: 1500 },
    deps: string[] = [],
  ) => {
    seq += 1;
    const s = series[type];
    const n = s ? (counters.get(s) ?? 0) + 1 : 0;
    if (s) counters.set(s, n);
    const body: SyncDocumentBody = {
      id: newId(),
      seq,
      type,
      number: s ? formatDocNumber({ series: s, branchCode, deviceCode: device.code, sequence: n }) : null,
      deviceTime: '2026-10-30T08:59:00.000Z',
      businessDate: '2026-10-30',
      deviceOffsetMs: 0,
      engineVersion: '1.0.0',
      contractVersion: 1,
      deps,
      payload,
    };
    return { ...body, hash: payloadHash(body) } satisfies SyncDocument;
  };
}

function push(device: TestDevice, documents: SyncDocument[], extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: { authorization: device.authorization },
    payload: {
      contractVersion: 1,
      appVersion: '1.0.0',
      sentAt: '2026-10-30T09:00:00.000Z',
      documents,
      ...extra,
    },
  });
}

async function pushOk(device: TestDevice, documents: SyncDocument[], extra: Record<string, unknown> = {}) {
  const res = await push(device, documents, extra);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PushResponse>();
}

async function pull(device: TestDevice, cursors: Record<string, string> = {}, limit?: number) {
  const query = new URLSearchParams({ cursors: JSON.stringify(cursors) });
  if (limit) query.set('limit', String(limit));
  const res = await app.inject({
    method: 'GET',
    url: `/v1/sync/pull?${query.toString()}`,
    headers: { authorization: device.authorization },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<PullResponse>();
}

const inbox = (tenantId: string) =>
  ownerDb()<
    { doc_id: string; status: string; result_code: string | null; flags: string[]; number: string | null }[]
  >`
    select doc_id, status, result_code, flags, number from sync_inbox where tenant_id = ${tenantId} order by device_seq`;

describe('device authentication', () => {
  it('refuses a missing, malformed, unknown or user token, and a revoked device on pull', async () => {
    const { tenantId, accessToken } = await store();
    const revoked = await createDevice(tenantId, { revoked: true });
    for (const authorization of [
      undefined,
      'Device nope',
      `Device sdt_${'A'.repeat(43)}`,
      `Bearer ${accessToken}`,
      `Device ${accessToken}`,
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sync/pull',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode, authorization).toBe(401);
    }
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sync/pull',
      headers: { authorization: revoked.authorization },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('device_revoked');
  });

  it('refuses a device of a suspended store', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    await ownerDb()`update tenants set status = 'suspended' where id = ${tenantId}`;
    expect((await push(device, [deviceDocs(device)()])).statusCode).toBe(401);
  });

  it('limits pushes per device', async () => {
    const limited = await makeApp({ SYNC_PUSH_RATE_LIMIT_PER_MINUTE: '1' });
    try {
      const { tenantId } = await store();
      const device = await createDevice(tenantId);
      const doc = deviceDocs(device);
      const send = () =>
        limited.inject({
          method: 'POST',
          url: '/v1/sync/push',
          headers: { authorization: device.authorization },
          payload: {
            contractVersion: 1,
            appVersion: '1',
            sentAt: '2026-10-30T09:00:00.000Z',
            documents: [doc()],
          },
        });
      expect((await send()).statusCode).toBe(200);
      const second = await send();
      expect(second.statusCode).toBe(429);
      expect(second.headers['retry-after']).toBeDefined();
    } finally {
      await limited.close();
    }
  });
});

describe('POST /v1/sync/push', () => {
  it('accepts new documents, and answers a replay of the same batch exactly as the first time', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const batch = [doc(), doc(), doc('customer', { name: 'سمير' })];

    const first = await pushOk(device, batch);
    expect(first.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
    expect(first.serverEpoch).toBe(1);
    expect(first.resendFrom).toBe(0);

    const again = await pushOk(device, batch);
    expect(again.results.map((r) => [r.status, r.outcome])).toEqual([
      ['duplicate', 'accepted'],
      ['duplicate', 'accepted'],
      ['duplicate', 'accepted'],
    ]);
    expect(again.results.map((r) => r.receivedAt)).toEqual(first.results.map((r) => r.receivedAt));
    expect(again.resendFrom).toBe(3);
    const third = await pushOk(device, batch);
    expect(third.results).toEqual(again.results);
    expect(await inbox(tenantId)).toHaveLength(3);
  });

  it('answers id_conflict for the same id with different content, keeps the first, and records it', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const original = deviceDocs(device)();
    await pushOk(device, [original]);

    const { hash: _hash, ...body } = original;
    const changedBody = { ...body, payload: { total: 9999 } };
    const changed = { ...changedBody, hash: payloadHash(changedBody) };
    const res = await pushOk(device, [changed]);
    expect(res.results).toEqual([{ id: original.id, status: 'id_conflict', flags: [] }]);
    const [row] = await ownerDb()<
      { payload_hash: string }[]
    >`select payload_hash from sync_inbox where doc_id = ${original.id}`;
    expect(row!.payload_hash).toBe(original.hash);
    const [log] = await ownerDb()<{ action: string; actor_type: string }[]>`
      select action, actor_type from audit_logs where tenant_id = ${tenantId} and action = 'sync.id_conflict'`;
    expect(log).toEqual({ action: 'sync.id_conflict', actor_type: 'device' });
  });

  it('rejects a reused number, a number of another device, and a document whose hash does not match', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const other = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const first = doc();
    const { hash: _h, ...body } = doc();
    const reuse = { ...body, id: newId(), number: first.number };
    const stolenBody = {
      ...body,
      id: newId(),
      seq: 50,
      number: formatDocNumber({ series: 'INV', branchCode: '001', deviceCode: other.code, sequence: 1 }),
    };
    const tamperedBody = {
      ...body,
      id: newId(),
      seq: 51,
      number: formatDocNumber({ series: 'INV', branchCode: '001', deviceCode: device.code, sequence: 9 }),
    };

    const res = await pushOk(device, [
      first,
      { ...reuse, hash: payloadHash(reuse) },
      { ...stolenBody, hash: payloadHash(stolenBody) },
      { ...tamperedBody, hash: payloadHash({ ...tamperedBody, payload: {} }) },
    ]);
    expect(res.results.map((r) => [r.status, r.code])).toEqual([
      ['accepted', undefined],
      ['rejected', 'number_conflict'],
      ['rejected', 'number_not_owned'],
      ['rejected', 'hash_mismatch'],
    ]);
    // Refused documents are kept in the inbox (the manager's rejected list), except a damaged one.
    expect((await inbox(tenantId)).map((r) => r.status)).toEqual(['accepted', 'rejected', 'rejected']);
  });

  it('processes a batch in creation order whatever order it arrives in, and old batches replayed later change nothing', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const sale = doc();
    const ret = doc('return', { total: 500 }, [sale.id]);
    const later = [doc(), doc()];

    // The return arrives before its sale in the request body: the server still sees the sale first.
    const res = await pushOk(device, [ret, sale]);
    expect(res.results.map((r) => [r.id, r.status])).toEqual([
      [sale.id, 'accepted'],
      [ret.id, 'accepted'],
    ]);
    await pushOk(device, later);
    const replay = await pushOk(device, [ret, sale]);
    expect(replay.results.every((r) => r.status === 'duplicate')).toBe(true);
    expect((await inbox(tenantId)).map((r) => r.doc_id)).toEqual([
      sale.id,
      ret.id,
      ...later.map((d) => d.id),
    ]);
  });

  it('accepts a return for another device’s sale that has not arrived (pending_link) and links it when it does', async () => {
    const { tenantId } = await store();
    const a = await createDevice(tenantId);
    const b = await createDevice(tenantId);
    const sale = deviceDocs(a)();
    const ret = deviceDocs(b)('return', { total: 500 }, [sale.id]);

    const early = await pushOk(b, [ret]);
    expect(early.results[0]).toMatchObject({ status: 'pending_link', flags: ['pending_link'] });
    await pushOk(a, [sale]);
    const rows = await inbox(tenantId);
    expect(rows.find((r) => r.doc_id === ret.id)).toMatchObject({ status: 'accepted', flags: [] });
    // Its replay now reports what it became.
    expect((await pushOk(b, [ret])).results[0]).toMatchObject({ status: 'duplicate', outcome: 'accepted' });
  });

  it('refuses what depends on a refused document of the device', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const bad = doc('receipt', { unbalanced: true });
    const dependent = doc('receipt', { amount: 1 }, [bad.id]);
    const res = await pushOk(device, [bad, dependent]);
    expect(res.results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'unbalanced'],
      ['rejected', 'dependency_rejected'],
    ]);
  });

  it('rejects a malformed payload alone with invalid_payload, and the rest of the batch goes on', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const unbalanced = salePayload(1500);
    (unbalanced.totals as { totalMinor: number }).totalMinor = 1400;
    const res = await pushOk(device, [doc('sale', { total: 1500 }), doc('sale', unbalanced), doc()]);
    expect(res.results.map((r) => [r.status, r.code ?? null])).toEqual([
      ['rejected', 'invalid_payload'],
      ['rejected', 'invalid_payload'],
      ['accepted', null],
    ]);
    // Kept as they arrived, with their code, for the manager’s list of refused documents.
    const rows = await ownerDb()<{ status: string; result_code: string | null }[]>`
      select status, result_code from sync_inbox where device_id = ${device.deviceId} order by device_seq`;
    expect(rows.map((r) => r.result_code)).toEqual(['invalid_payload', 'invalid_payload', null]);
  });

  it('accepts and flags what happened in the shop: totals_mismatch, permission_stale, clock_skew', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const mismatch = doc('sale', salePayload(1500, { printedTotal: 1400 }));
    const stale = doc('sale', salePayload(1500, { permissionWithdrawn: true }));
    const { hash: _h, ...aheadBody } = doc();
    aheadBody.deviceTime = '2026-10-30T10:00:00.000Z'; // an hour ahead of the server clock
    const res = await pushOk(device, [mismatch, stale, { ...aheadBody, hash: payloadHash(aheadBody) }]);
    expect(res.results.map((r) => [r.status, r.flags])).toEqual([
      ['accepted', ['totals_mismatch']],
      ['accepted', ['permission_stale']],
      ['accepted', ['clock_skew']],
    ]);
  });

  it('keeps the heartbeat and what arrived per series (doc_sequences), and the device’s last contact', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    await pushOk(device, [doc(), doc(), doc('return', { total: 1 })], { lastIssued: { INV: 5, SRT: 1 } });
    const rows = await ownerDb()<{ series: string; last_announced: number; last_received: number }[]>`
      select series, last_announced, last_received from doc_sequences where device_id = ${device.deviceId} order by series`;
    expect(rows).toEqual([
      { series: 'INV', last_announced: 5, last_received: 2 },
      { series: 'SRT', last_announced: 1, last_received: 1 },
    ]);
    const [seen] = await ownerDb()<{ app_version: string; last_sync_at: Date; clock_offset_ms: number }[]>`
      select app_version, last_sync_at, clock_offset_ms from devices where id = ${device.deviceId}`;
    expect(seen).toMatchObject({ app_version: '1.0.0', clock_offset_ms: 0 });
    expect(seen!.last_sync_at.toISOString()).toBe('2026-10-30T09:00:00.000Z');
  });

  it('a revoked device: accepts what it numbered up to its last announcement, quarantines the rest, then says wipe', async () => {
    const { tenantId, accessToken } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const sent = [doc(), doc()];
    await pushOk(device, [sent[0]!], { lastIssued: { INV: 2 } });
    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/devices/${device.deviceId}/revoke`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);

    const res = await pushOk(device, [sent[1]!, doc(), doc('customer', { name: 'x' })], {
      lastIssued: { INV: 99 },
    });
    expect(res.results.map((r) => [r.status, r.code])).toEqual([
      ['accepted', undefined],
      ['quarantined', 'after_revocation'],
      ['quarantined', 'after_revocation'],
    ]);
    expect(res.commands).toEqual({ wipe: true });
    const [seq] = await ownerDb()<{ last_announced: number }[]>`
      select last_announced from doc_sequences where device_id = ${device.deviceId} and series = 'INV'`;
    expect(seq!.last_announced).toBe(2);
  });

  it('keeps stores apart: the same document id in two stores, and no store sees the other’s inbox', async () => {
    const a = await store('0911111111');
    const b = await store('0922222222');
    const deviceA = await createDevice(a.tenantId);
    const deviceB = await createDevice(b.tenantId);
    const doc = deviceDocs(deviceA)();
    await pushOk(deviceA, [doc]);
    // A return in store B naming store A's sale does not find it.
    const ret = deviceDocs(deviceB)('return', { total: 1 }, [doc.id]);
    expect((await pushOk(deviceB, [ret])).results[0]!.status).toBe('pending_link');
    expect(await inbox(b.tenantId)).toHaveLength(1);
    expect(await inbox(a.tenantId)).toHaveLength(1);
  });

  it('takes gzip bodies, answers 413 above 5 MB on the wire, 415 for other encodings, 400 above 50 documents', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const doc = deviceDocs(device);
    const body = (documents: SyncDocument[]) =>
      JSON.stringify({ contractVersion: 1, appVersion: '1', sentAt: '2026-10-30T09:00:00.000Z', documents });
    const headers = { authorization: device.authorization, 'content-type': 'application/json' };

    const zipped = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { ...headers, 'content-encoding': 'gzip' },
      payload: gzipSync(body([doc()])),
    });
    expect(zipped.statusCode, zipped.body).toBe(200);
    expect(zipped.json().results[0].status).toBe('accepted');

    const huge = body([doc('sale', salePayload(100, { padding: 'x'.repeat(PUSH_MAX_WIRE_BYTES) }))]);
    const tooLarge = await app.inject({ method: 'POST', url: '/v1/sync/push', headers, payload: huge });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe('payload_too_large');

    const brotli = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: { ...headers, 'content-encoding': 'br' },
      payload: body([doc()]),
    });
    expect(brotli.statusCode).toBe(415);

    const many = Array.from({ length: 51 }, () => doc());
    expect((await push(device, many)).statusCode).toBe(400);
  });
});

describe('GET /v1/sync/pull', () => {
  it('downloads every set from scratch, without secrets', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const res = await pull(device);
    expect(Object.keys(res.sets).sort()).toEqual(['branches', 'roles', 'settings', 'user_roles', 'users']);
    expect(res.hasMore).toBe(false);
    expect(res.serverEpoch).toBe(1);
    expect(res.sets.branches!.upserts).toEqual([
      expect.objectContaining({ code: '001', name: 'الفرع الرئيسي', isActive: true }),
    ]);
    expect(res.sets.settings!.upserts).toEqual([
      expect.objectContaining({ id: tenantId, baseCurrency: 'SYP' }),
    ]);
    const user = res.sets.users!.upserts[0]!;
    expect(Object.keys(user).sort()).toEqual(['fullName', 'id', 'status', 'version']);
    expect(JSON.stringify(res)).not.toMatch(/passwordHash|pinHash|password_hash|pin_hash|\$argon2/);
    expect(JSON.stringify(res.sets.users)).not.toMatch(/phone|\+963/);
  });

  it('then only what changed, deletions included, and nothing of another store', async () => {
    const a = await store('0911111111');
    const b = await store('0922222222');
    const device = await createDevice(a.tenantId);
    const first = await pull(device);
    const cursors = Object.fromEntries(Object.entries(first.sets).map(([k, v]) => [k, v.cursor]));

    await ownerDb()`update users set full_name = 'سارة' where tenant_id = ${a.tenantId}`;
    await ownerDb()`update users set full_name = 'غريب' where tenant_id = ${b.tenantId}`;
    await ownerDb()`delete from user_roles where tenant_id = ${a.tenantId}`;
    const next = await pull(device, cursors);
    expect(next.sets.users!.upserts.map((u) => u.fullName)).toEqual(['سارة']);
    expect(next.sets.user_roles!.deletes).toHaveLength(1);
    expect(next.sets.branches!.upserts).toEqual([]);
    expect(next.sets.users!.cursor > cursors.users!).toBe(true);
  });

  it('never skips a transaction that commits after a later one (pg_snapshot_xmin)', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const start = await pull(device, { branches: '0', users: '0' });
    const cursors = { branches: start.sets.branches!.cursor, users: start.sets.users!.cursor };

    const slow = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {}, idle_timeout: 5 });
    const reserved = await slow.reserve();
    let open = false;
    try {
      await reserved`begin`;
      open = true;
      // The slow transaction takes its id first …
      await reserved`update branches set name = 'فرع بطيء' where tenant_id = ${tenantId}`;
      // … a later one commits first.
      await ownerDb()`update users set full_name = 'سريع' where tenant_id = ${tenantId}`;

      const during = await pull(device, cursors);
      // Neither is sent yet: the later one waits until the slow one is done.
      expect(during.sets.users!.upserts).toEqual([]);
      expect(during.sets.branches!.upserts).toEqual([]);

      await reserved`commit`;
      open = false;
      const after = await pull(device, {
        branches: during.sets.branches!.cursor,
        users: during.sets.users!.cursor,
      });
      expect(after.sets.branches!.upserts.map((b) => b.name)).toEqual(['فرع بطيء']);
      expect(after.sets.users!.upserts.map((u) => u.fullName)).toEqual(['سريع']);
    } finally {
      if (open) await reserved`rollback`;
      reserved.release();
      await slow.end({ timeout: 1 });
    }
  });

  it('a device offline for a long time catches up page by page, even inside one large transaction', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    let cursors: Record<string, string> = { users: (await pull(device, { users: '0' })).sets.users!.cursor };

    // Months of changes: one big import of 23 people in one transaction, edits, and deletions.
    await ownerDb()`
      insert into users (tenant_id, full_name)
      select ${tenantId}, 'موظف ' || g from generate_series(1, 23) g`;
    for (let i = 0; i < 5; i++)
      await ownerDb()`update users set full_name = full_name || '+' where tenant_id = ${tenantId} and full_name = ${`موظف ${i + 1}`}`;
    await ownerDb()`delete from users where tenant_id = ${tenantId} and full_name like 'موظف 2%'`;

    const local = new Map<string, Record<string, unknown>>();
    let pages = 0;
    for (;;) {
      const page = await pull(device, cursors, 4);
      pages += 1;
      for (const row of page.sets.users!.upserts) local.set(row.id, row);
      for (const id of page.sets.users!.deletes) local.delete(id);
      cursors = { users: page.sets.users!.cursor };
      if (!page.hasMore) break;
    }
    expect(pages).toBeGreaterThan(5);
    const server = await ownerDb()<{ id: string; full_name: string }[]>`
      select id, full_name from users where tenant_id = ${tenantId} and full_name like 'موظف%'`;
    expect([...local.values()].map((r) => r.fullName).sort()).toEqual(server.map((r) => r.full_name).sort());
    expect(local.size).toBe(server.length);
  });

  it('tells a device to download a set again when its cursor is older than the kept tombstones', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const first = await pull(device, { users: '0' });
    await ownerDb()`update server_state set tombstone_horizon = pg_current_xact_id()`;
    const res = await pull(device, { users: first.sets.users!.cursor });
    expect(res.commands).toEqual({ resync: ['users'] });
    expect(res.sets).toEqual({});
    // From scratch it works again.
    expect((await pull(device, { users: '0' })).sets.users!.upserts).toHaveLength(1);
  });

  it('refuses an unknown set or a malformed cursor', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    for (const cursors of ['{"products_x":"0"}', '{"users":"abc"}', 'nope']) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sync/pull?cursors=${encodeURIComponent(cursors)}`,
        headers: { authorization: device.authorization },
      });
      expect(res.statusCode, cursors).toBe(400);
    }
  });
});

describe('POST /v1/sync/resync and the server epoch', () => {
  it('answers a snapshot of the sets it asks for, in the bootstrap’s shape', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/resync',
      headers: { authorization: device.authorization },
      payload: { sets: ['users', 'roles'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<ResyncResponse>();
    expect(body).toMatchObject({
      serverEpoch: 1,
      url: `/v1/sync/snapshots/${body.snapshotId}`,
      sets: { users: { cursor: '0', snapshotUrl: body.url }, roles: { cursor: '0', snapshotUrl: body.url } },
    });
    expect(Object.keys(body.cursors).sort()).toEqual(['roles', 'users']);
    const file = await app.inject({
      method: 'GET',
      url: body.url,
      headers: { authorization: device.authorization },
    });
    const snapshot = parseSnapshot(gunzipSync(file.rawPayload).toString('utf8'));
    expect(Object.keys(snapshot.sets).sort()).toEqual(['roles', 'users']);
    expect(snapshot.sets.roles).toHaveLength(3);
  });

  it('carries the epoch on every answer; server_epoch_bump() after a restore moves it on', async () => {
    const { tenantId } = await store();
    const device = await createDevice(tenantId);
    expect((await pull(device)).serverEpoch).toBe(1);
    const [bumped] = await ownerDb()<{ epoch: number }[]>`select server_epoch_bump() as epoch`;
    expect(bumped!.epoch).toBe(2);
    expect((await pull(device)).serverEpoch).toBe(2);
    expect((await pushOk(device, [deviceDocs(device)()])).serverEpoch).toBe(2);
  });
});
