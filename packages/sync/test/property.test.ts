import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Puller, Pusher } from '../src/client';
import { createUuidV7, parseDocNumber, type PushRequest } from '../src';
import { linkedDevice, linkedStore, ModelServer, ModelTransport, sale, type Fault } from './helpers';

type Command =
  | { kind: 'save'; device: number; count: number; dependOn: number | null }
  | { kind: 'push'; device: number; fault: Fault | null }
  | { kind: 'pull'; device: number; fault: Fault | null }
  | { kind: 'replay'; device: number; pick: number }
  | { kind: 'write'; user: number }
  | { kind: 'delete'; user: number }
  | { kind: 'backup' }
  | { kind: 'restore' };

const DEVICES = 3;
const device = fc.integer({ min: 0, max: DEVICES - 1 });
const fault = fc.constantFrom<Fault | null>(
  null,
  null,
  null,
  'lose_request',
  'lose_response',
  'busy',
  'too_large',
);
const command: fc.Arbitrary<Command> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('save'),
      device,
      count: fc.integer({ min: 1, max: 4 }),
      dependOn: fc.option(fc.nat(), { nil: null }),
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ kind: fc.constant('push'), device, fault }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant('pull'), device, fault }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('replay'), device, pick: fc.nat() }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('write'), user: fc.integer({ min: 0, max: 5 }) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('delete'), user: fc.integer({ min: 0, max: 5 }) }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'backup' as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'restore' as const }), weight: 1 },
);

/**
 * The phase-3 promise in miniature: whatever the order of saves, sends, lost requests, lost
 * answers, replays of old batches and restores of the server from a backup, once the network is
 * good again every document saved on every device is on the server exactly once, unchanged, and
 * every device sees the server's data.
 */
describe('sync under random interleavings (model server)', () => {
  it('loses nothing and duplicates nothing', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 40 }), async (commands) => {
        const server = new ModelServer();
        const devices = await Promise.all(
          Array.from({ length: DEVICES }, async (_, i) => {
            const deviceId = `device-${i}`;
            const store = await linkedStore({
              deviceId,
              deviceCode: String(i + 1).padStart(3, '0'),
              sets: ['users'],
            });
            const transport = new ModelTransport(server, deviceId);
            return {
              deviceId,
              store,
              transport,
              pusher: new Pusher({ store, transport, appVersion: '1' }),
              puller: new Puller({ store, transport, limit: 2 }),
              newId: createUuidV7(),
              sent: [] as PushRequest[],
            };
          }),
        );
        const created: { id: string; hash: string; device: number }[] = [];
        let backup: ReturnType<ModelServer['snapshot']> | null = null;

        for (const c of commands) {
          switch (c.kind) {
            case 'save': {
              const d = devices[c.device]!;
              for (let i = 0; i < c.count; i++) {
                const dep =
                  c.dependOn !== null && created.length > 0 ? created[c.dependOn % created.length]! : null;
                const input = dep ? sale(100, { type: 'return', deps: [dep.id] }) : sale(1000 + i);
                const entry = await d.store.createDocument(input, { now: Date.now(), newId: d.newId });
                created.push({ id: entry.id, hash: entry.doc.hash, device: c.device });
              }
              break;
            }
            case 'push': {
              const d = devices[c.device]!;
              if (c.fault) d.transport.faults.push(c.fault);
              await d.pusher.pushOnce();
              break;
            }
            case 'pull': {
              const d = devices[c.device]!;
              if (c.fault) d.transport.faults.push(c.fault);
              await d.puller.pullOnce();
              break;
            }
            case 'replay': {
              // An old batch arrives again (a slow proxy, a retried request): out of order.
              const d = devices[c.device]!;
              const old = d.transport.pushes;
              if (old.length > 0) server.push(d.deviceId, structuredClone(old[c.pick % old.length]!));
              break;
            }
            case 'write':
              server.write('users', { id: `u${c.user}`, name: `user ${c.user} @${server.state.xid}` });
              break;
            case 'delete':
              server.remove('users', `u${c.user}`);
              break;
            case 'backup':
              backup = server.snapshot();
              break;
            case 'restore':
              if (backup) server.restore(backup);
              break;
          }
        }

        // The network is good again: every device syncs until it has nothing left.
        for (let round = 0; round < 3; round++) {
          for (const d of devices) {
            d.transport.faults.length = 0;
            await d.pusher.drain();
            await d.puller.drain();
            await d.pusher.drain();
          }
        }

        // Zero loss, zero duplicates, nothing changed on the way.
        expect(server.conflicts).toEqual([]);
        expect(server.state.inbox.size).toBe(created.length);
        for (const doc of created) expect(server.state.inbox.get(doc.id)?.hash).toBe(doc.hash);
        const statuses = new Set([...server.state.inbox.values()].map((r) => r.status));
        expect([...statuses].every((s) => s === 'accepted' || s === 'pending_link')).toBe(true);

        for (const [i, d] of devices.entries()) {
          expect(await d.store.countPending()).toBe(0);
          expect(await d.store.heldIds()).toEqual(new Set());
          // Numbers per series are 1..n with no gap.
          const mine = [...server.state.inbox.values()].filter((r) => r.deviceId === d.deviceId);
          const bySeries = new Map<string, number[]>();
          for (const row of mine) {
            const parsed = parseDocNumber(row.number!)!;
            expect(parsed.deviceCode).toBe(String(i + 1).padStart(3, '0'));
            bySeries.set(parsed.series, [...(bySeries.get(parsed.series) ?? []), parsed.sequence]);
          }
          for (const sequences of bySeries.values()) {
            expect(sequences.sort((a, b) => a - b)).toEqual(sequences.map((_, k) => k + 1));
          }
          // The device sees exactly the server's live users.
          const live = [...(server.state.rows.get('users')?.values() ?? [])]
            .filter((r) => !r.deleted)
            .map((r) => r.data);
          const local = await d.store.readSet('users');
          expect(local.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
            live.sort((a, b) => a.id.localeCompare(b.id)),
          );
        }
      }),
      { numRuns: Number(process.env.FC_NUM_RUNS ?? 60) },
    );
  }, 60_000);

  it('gives the same device the same answer for a replayed batch', async () => {
    const server = new ModelServer();
    const store = await linkedStore();
    const transport = new ModelTransport(server, linkedDevice().deviceId!);
    for (let i = 0; i < 3; i++)
      await store.createDocument(sale(), { now: Date.now(), newId: createUuidV7() });
    await new Pusher({ store, transport, appVersion: '1' }).drain();
    const first = server.push(linkedDevice().deviceId!, structuredClone(transport.pushes[0]!));
    const again = server.push(linkedDevice().deviceId!, structuredClone(transport.pushes[0]!));
    expect(again.results).toEqual(first.results);
    expect(first.results.every((r) => r.status === 'duplicate' && r.outcome === 'accepted')).toBe(true);
  });
});
