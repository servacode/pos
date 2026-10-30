import fc from 'fast-check';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createUuidV7, parseDocNumber, type PushRequest } from '@serva/sync';
import { Puller, Pusher, type NewDocument, type SyncTransport } from '@serva/sync/client';
import { DeviceDatabase, DexieSyncStore } from '@serva/sync/dexie';
import { createDevice, injectTransport, type Fault, type TestDevice } from './devices';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * The real device code (Dexie over an in-memory IndexedDB, the fetch transport, the push and pull
 * loops) against the real server and database.
 */

let app: FastifyInstance;
let tenantId: string;
let dbCount = 0;

beforeAll(async () => {
  await resetDatabase();
  app = await makeApp();
  tenantId = (await registerStore(app)).body.tenant.id;
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});

interface Client {
  device: TestDevice;
  store: DexieSyncStore;
  faults: Fault[];
  sent: PushRequest[];
  transport: SyncTransport;
  pusher: Pusher;
  puller: Puller;
}

async function client(): Promise<Client> {
  const device = await createDevice(tenantId);
  dbCount += 1;
  const store = new DexieSyncStore(
    new DeviceDatabase(`api-client-${dbCount}`, { indexedDB: new IDBFactory(), IDBKeyRange }),
  );
  await store.putDevice({
    storeName: 'متجر',
    branchName: 'الفرع الرئيسي',
    deviceName: device.code,
    deviceId: device.deviceId,
    token: device.token,
    branchCode: '001',
    deviceCode: device.code,
    sets: ['users', 'branches'],
  });
  const faults: Fault[] = [];
  const sent: PushRequest[] = [];
  const inner = injectTransport(app, device, faults);
  const transport: SyncTransport = {
    ...inner,
    push: (request) => {
      sent.push(structuredClone(request));
      return inner.push(request);
    },
  };
  return {
    device,
    store,
    faults,
    sent,
    transport,
    pusher: new Pusher({ store, transport, appVersion: '1.0.0' }),
    puller: new Puller({ store, transport, limit: 3 }),
  };
}

const newId = createUuidV7();
const sale = (total: number, deps: string[] = []): NewDocument => ({
  type: deps.length ? 'return' : 'sale',
  payload: { total, lines: [{ lineNo: 1, qty: 1000, price: total }] },
  deps,
  businessDate: '2026-10-30',
  engineVersion: '1.0.0',
});

const inboxOf = (deviceIds: string[]) =>
  ownerDb()<{ doc_id: string; payload_hash: string; status: string; number: string; device_id: string }[]>`
    select doc_id, payload_hash, status, number, device_id from sync_inbox where device_id = any(${deviceIds}::uuid[])`;

/** Simulates restoring the database from a backup taken when only `kept` had arrived. */
async function restoreBackup(deviceIds: string[], kept: Set<string>) {
  const rows = await inboxOf(deviceIds);
  const lost = rows.filter((r) => !kept.has(r.doc_id)).map((r) => r.doc_id);
  if (lost.length > 0) await ownerDb()`delete from sync_inbox where doc_id = any(${lost}::uuid[])`;
  await ownerDb()`select server_epoch_bump()`;
}

describe('device client against the server', () => {
  it('a device offline for days sends everything once, in order, and catches up on changes', async () => {
    const c = await client();
    for (let i = 0; i < 120; i++) await c.store.createDocument(sale(100 + i), { now: Date.now(), newId });
    await ownerDb()`
      insert into users (tenant_id, full_name) select ${tenantId}, 'جديد ' || g from generate_series(1, 10) g`;

    c.faults.push('lose_request', 'lose_response');
    expect((await c.pusher.drain()).kind).toBe('failed');
    expect((await c.pusher.drain()).kind).toBe('failed');
    expect((await c.pusher.drain()).kind).toBe('idle');
    expect(c.sent.map((r) => r.documents.length)).toEqual([50, 50, 50, 50, 20]);
    expect(await c.store.countPending()).toBe(0);

    const rows = await inboxOf([c.device.deviceId]);
    expect(rows).toHaveLength(120);
    expect(new Set(rows.map((r) => r.number)).size).toBe(120);
    expect(rows.every((r) => r.status === 'accepted')).toBe(true);

    expect((await c.puller.drain()).kind).toBe('pulled');
    const users = await c.store.readSet('users');
    const [count] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from users where tenant_id = ${tenantId}`;
    expect(users).toHaveLength(count!.n);
  });

  it('after the server is restored from a backup (new epoch), the device resends what was lost', async () => {
    const c = await client();
    for (let i = 0; i < 6; i++) await c.store.createDocument(sale(i + 1), { now: Date.now(), newId });
    await c.pusher.drain();
    const backup = new Set((await inboxOf([c.device.deviceId])).slice(0, 2).map((r) => r.doc_id));
    await restoreBackup([c.device.deviceId], backup);
    expect(await inboxOf([c.device.deviceId])).toHaveLength(2);

    // The next answer carries the new epoch: everything confirmed goes back in the queue.
    await c.store.createDocument(sale(99), { now: Date.now(), newId });
    const run = await c.pusher.pushOnce();
    expect(run.kind).toBe('restarted');
    await c.pusher.drain();
    const rows = await inboxOf([c.device.deviceId]);
    expect(rows).toHaveLength(7);
    expect(await c.store.countPending()).toBe(0);
    expect((await c.store.getMeta()).serverEpoch).toBeGreaterThan(1);
  });

  it('random push/pull interleavings with lost requests, lost answers, replays and restores lose and duplicate nothing', async () => {
    type Command =
      | { kind: 'save'; device: number; count: number; dependOn: number | null }
      | { kind: 'push'; device: number; fault: Fault | null }
      | { kind: 'pull'; device: number; fault: Fault | null }
      | { kind: 'replay'; device: number; pick: number }
      | { kind: 'edit'; user: number }
      | { kind: 'backup' }
      | { kind: 'restore' };
    const device = fc.integer({ min: 0, max: 1 });
    const fault = fc.constantFrom<Fault | null>(null, null, 'lose_request', 'lose_response');
    const command: fc.Arbitrary<Command> = fc.oneof(
      {
        arbitrary: fc.record({
          kind: fc.constant('save' as const),
          device,
          count: fc.integer({ min: 1, max: 3 }),
          dependOn: fc.option(fc.nat(), { nil: null }),
        }),
        weight: 4,
      },
      { arbitrary: fc.record({ kind: fc.constant('push' as const), device, fault }), weight: 4 },
      { arbitrary: fc.record({ kind: fc.constant('pull' as const), device, fault }), weight: 2 },
      { arbitrary: fc.record({ kind: fc.constant('replay' as const), device, pick: fc.nat() }), weight: 2 },
      { arbitrary: fc.record({ kind: fc.constant('edit' as const), user: fc.nat() }), weight: 1 },
      { arbitrary: fc.constant({ kind: 'backup' as const }), weight: 1 },
      { arbitrary: fc.constant({ kind: 'restore' as const }), weight: 1 },
    );

    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 25 }), async (commands) => {
        const clients = [await client(), await client()];
        const ids = clients.map((c) => c.device.deviceId);
        const created: { id: string; hash: string }[] = [];
        let backup: Set<string> | null = null;

        for (const c of commands) {
          switch (c.kind) {
            case 'save': {
              const cl = clients[c.device]!;
              for (let i = 0; i < c.count; i++) {
                const dep =
                  c.dependOn !== null && created.length > 0 ? created[c.dependOn % created.length]! : null;
                const entry = await cl.store.createDocument(sale(100 + i, dep ? [dep.id] : []), {
                  now: Date.now(),
                  newId,
                });
                created.push({ id: entry.id, hash: entry.doc.hash });
              }
              break;
            }
            case 'push': {
              const cl = clients[c.device]!;
              if (c.fault) cl.faults.push(c.fault);
              await cl.pusher.pushOnce();
              break;
            }
            case 'pull': {
              const cl = clients[c.device]!;
              if (c.fault) cl.faults.push(c.fault);
              await cl.puller.pullOnce();
              break;
            }
            case 'replay': {
              // An old batch arrives again, after newer ones: out of order.
              const cl = clients[c.device]!;
              if (cl.sent.length > 0) {
                const res = await app.inject({
                  method: 'POST',
                  url: '/v1/sync/push',
                  headers: { authorization: cl.device.authorization },
                  payload: cl.sent[c.pick % cl.sent.length]!,
                });
                expect(res.statusCode).toBe(200);
                for (const r of res.json<{ results: { status: string }[] }>().results) {
                  expect(['accepted', 'duplicate', 'pending_link']).toContain(r.status);
                }
              }
              break;
            }
            case 'edit':
              await ownerDb()`
                update users set full_name = ${`موظف ${c.user}`} where id = (
                  select id from users where tenant_id = ${tenantId} order by id offset ${c.user % 5} limit 1)`;
              break;
            case 'backup':
              backup = new Set((await inboxOf(ids)).map((r) => r.doc_id));
              break;
            case 'restore':
              if (backup) await restoreBackup(ids, backup);
              break;
          }
        }

        // The network is good again.
        for (let round = 0; round < 3; round++) {
          for (const cl of clients) {
            cl.faults.length = 0;
            await cl.pusher.drain();
            await cl.puller.drain();
            await cl.pusher.drain();
          }
        }

        const rows = await inboxOf(ids);
        // Zero loss, zero duplicates, nothing altered.
        expect(rows).toHaveLength(created.length);
        const byId = new Map(rows.map((r) => [r.doc_id, r]));
        for (const doc of created) expect(byId.get(doc.id)?.payload_hash).toBe(doc.hash);
        expect(rows.filter((r) => r.status !== 'accepted' && r.status !== 'pending_link')).toEqual([]);
        for (const cl of clients) {
          expect(await cl.store.countPending()).toBe(0);
          expect(await cl.store.heldIds()).toEqual(new Set());
          // Each device's numbers are 1..n with no gap and no repeat.
          const sequences = rows
            .filter((r) => r.device_id === cl.device.deviceId)
            .map((r) => parseDocNumber(r.number)!)
            .reduce<Record<string, number[]>>(
              (acc, n) => ({ ...acc, [n.series]: [...(acc[n.series] ?? []), n.sequence] }),
              {},
            );
          for (const list of Object.values(sequences)) {
            expect(list.sort((a, b) => a - b)).toEqual(list.map((_, k) => k + 1));
          }
          // And it sees the server's people as they are now.
          const server = await ownerDb()<{ id: string; full_name: string }[]>`
            select id, full_name from users where tenant_id = ${tenantId} order by id`;
          const local = (await cl.store.readSet('users')).sort((a, b) => a.id.localeCompare(b.id));
          expect(local.map((u) => [u.id, u.fullName])).toEqual(server.map((u) => [u.id, u.full_name]));
        }
      }),
      { numRuns: Number(process.env.FC_NUM_RUNS ?? 12) },
    );
  }, 300_000);
});
