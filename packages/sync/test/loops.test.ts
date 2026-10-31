import { describe, expect, it, vi } from 'vitest';
import { Puller, Pusher, SyncEngine, backoffDelay, BACKOFF_MAX_MS, type Timers } from '../src/client';
import { createUuidV7 } from '../src';
import { linkedDevice, linkedStore, manualClock, ModelServer, ModelTransport, sale } from './helpers';

const DEVICE = linkedDevice().deviceId!;

async function setup(count = 0) {
  const store = await linkedStore();
  const server = new ModelServer();
  const transport = new ModelTransport(server, DEVICE);
  const clock = manualClock();
  const newId = createUuidV7({ now: clock.now });
  const save = async (n = 1, input = sale()) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(await store.createDocument(input, { now: clock.now(), newId }));
    return out;
  };
  await save(count);
  const pusher = new Pusher({ store, transport, appVersion: '1.0.0', now: clock.now });
  const puller = new Puller({ store, transport, now: clock.now });
  return { store, server, transport, clock, save, pusher, puller };
}

describe('push loop', () => {
  it('sends the outbox in creation order, 50 at a time, and confirms each document', async () => {
    const { store, server, transport, pusher } = await setup(120);
    const run = await pusher.drain();
    expect(run.kind).toBe('idle');
    expect(transport.pushes.map((p) => p.documents.length)).toEqual([50, 50, 20]);
    const seqs = transport.pushes.flatMap((p) => p.documents.map((d) => d.seq));
    expect(seqs).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(transport.pushes[0]!.lastIssued).toEqual({ INV: 120 });
    expect(await store.countPending()).toBe(0);
    expect(server.state.inbox.size).toBe(120);
    expect((await store.getMeta()).serverEpoch).toBe(1);
  });

  it('splits the batch on 413 and grows it back after a success', async () => {
    const { transport, pusher, store } = await setup(40);
    transport.maxDocs = 10;
    const first = await pusher.pushOnce();
    expect(first).toEqual({ kind: 'split', maxDocs: 20 });
    expect(await pusher.pushOnce()).toEqual({ kind: 'split', maxDocs: 10 });
    expect((await pusher.pushOnce()).kind).toBe('sent');
    expect(pusher.batchSize).toBe(20);
    transport.maxDocs = Infinity;
    await pusher.drain();
    expect(await store.countPending()).toBe(0);
  });

  it('sets aside one document that is too large on its own and carries on', async () => {
    const { transport, pusher, store } = await setup(3);
    const [first] = await store.listPending();
    transport.oversized.add(first!.id);
    expect(await pusher.pushOnce()).toEqual({ kind: 'split', maxDocs: 1 });
    expect(await pusher.pushOnce()).toMatchObject({ kind: 'sent', held: 1 });
    await pusher.drain();
    expect((await store.listByStatus('held')).map((e) => [e.seq, e.lastError])).toEqual([
      [1, 'payload_too_large'],
    ]);
    expect((await store.listByStatus('confirmed')).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('keeps everything when the request or the answer is lost, and a resend is answered as duplicate', async () => {
    const { transport, pusher, store, server } = await setup(3);
    transport.faults.push('lose_request');
    expect(await pusher.pushOnce()).toEqual({ kind: 'failed', reason: 'network', retryAfterMs: null });
    expect(server.state.inbox.size).toBe(0);

    transport.faults.push('lose_response');
    expect((await pusher.pushOnce()).kind).toBe('failed');
    expect(server.state.inbox.size).toBe(3);
    expect(await store.countPending()).toBe(3);
    expect((await store.listPending()).map((e) => e.attempts)).toEqual([2, 2, 2]);

    const run = await pusher.pushOnce();
    expect(run).toMatchObject({ kind: 'sent', confirmed: 3 });
    expect(server.state.inbox.size).toBe(3);
    expect(server.conflicts).toEqual([]);
  });

  it('resumes after a restart from what the device database holds', async () => {
    const { store, transport, clock } = await setup(70);
    const first = new Pusher({ store, transport, appVersion: '1.0.0', now: clock.now });
    await first.pushOnce();
    // The app closes; a new instance over the same database carries on with the rest.
    const second = new Pusher({ store, transport, appVersion: '1.0.0', now: clock.now });
    await second.drain();
    expect(transport.pushes.map((p) => p.documents[0]!.seq)).toEqual([1, 51]);
    expect(await store.countPending()).toBe(0);
  });

  it('holds what the server refuses, holds its dependents with it, and sends the rest', async () => {
    const { store, server, pusher, save, clock } = await setup();
    const [original] = await save(1);
    // Another document already took this number on the server: the sale is refused.
    server.state.inbox.set('other', {
      hash: 'x',
      deviceId: 'other',
      seq: 1,
      number: original!.doc.number,
      type: 'sale',
      status: 'accepted',
      receivedAt: '',
    });
    const ret = await store.createDocument(sale(100, { type: 'return', deps: [original!.id] }), {
      now: clock.now(),
      newId: createUuidV7(),
    });
    const [later] = await save(1);
    await pusher.drain();
    // The return went in the same batch, so the server refused it too; sent later, the device
    // itself would have kept it back.
    expect((await store.listByStatus('held')).map((e) => [e.id, e.lastError])).toEqual([
      [original!.id, 'number_conflict'],
      [ret.id, 'dependency_rejected'],
    ]);
    expect(await store.listPending()).toEqual([]);
    expect((await store.listByStatus('confirmed')).map((e) => e.id)).toEqual([later!.id]);
  });

  it('a busy server does not lose the batch', async () => {
    const { transport, pusher, store } = await setup(2);
    transport.faults.push('busy');
    expect(await pusher.pushOnce()).toEqual({ kind: 'failed', reason: 'busy', retryAfterMs: 1000 });
    expect(await store.countPending()).toBe(2);
  });

  it('after a restore (new epoch) sends again every confirmed document of the last 30 days', async () => {
    const { store, server, pusher, save } = await setup(5);
    const backup = server.snapshot(); // backup taken before anything arrived
    await pusher.drain();
    await save(2);
    server.restore(backup);
    expect(server.state.inbox.size).toBe(0);

    const run = await pusher.pushOnce();
    expect(run).toEqual({ kind: 'restarted', requeued: 5 });
    await pusher.drain();
    expect(server.state.inbox.size).toBe(7);
    expect(await store.countPending()).toBe(0);
    expect((await store.getMeta()).serverEpoch).toBe(2);
  });

  it('resends what the server says it does not hold, even without a new epoch', async () => {
    const { store, server, pusher } = await setup(4);
    await pusher.drain();
    // The server lost the last two (e.g. a restore whose epoch bump was forgotten).
    for (const [id, row] of server.state.inbox) if (row.seq > 2) server.state.inbox.delete(id);
    await store.createDocument(sale(), { now: Date.now(), newId: createUuidV7() });
    await pusher.drain();
    await pusher.drain();
    expect(server.state.inbox.size).toBe(5);
    expect(await store.countPending()).toBe(0);
  });
});

describe('pull loop', () => {
  it('downloads changes page by page, keeps cursors on the device, and applies deletions', async () => {
    const { store, server, puller } = await setup();
    await store.putDevice(linkedDevice({ sets: ['users', 'branches'] }));
    for (let i = 1; i <= 7; i++) server.write('users', { id: `u${i}`, name: `user ${i}` });
    server.write('branches', { id: 'b1', code: '001' });

    const limited = new Puller({ store, transport: puller['transport'], limit: 3 });
    const first = await limited.pullOnce();
    expect(first).toEqual({ kind: 'pulled', hasMore: true, rows: 4 });
    expect(await limited.drain()).toMatchObject({ kind: 'pulled', hasMore: false });
    expect((await store.readSet('users')).map((u) => u.id).sort()).toEqual([
      'u1',
      'u2',
      'u3',
      'u4',
      'u5',
      'u6',
      'u7',
    ]);

    server.remove('users', 'u3');
    server.write('users', { id: 'u1', name: 'renamed' });
    await puller.drain();
    const users = await store.readSet('users');
    expect(users.map((u) => u.id).sort()).toEqual(['u1', 'u2', 'u4', 'u5', 'u6', 'u7']);
    expect(users.find((u) => u.id === 'u1')?.name).toBe('renamed');
    expect(await store.getCursors()).toEqual({
      users: String(server.state.xid),
      branches: String(server.state.xid),
    });
  });

  it('a lost pull changes nothing; the next one carries on from the same cursors', async () => {
    const { store, server, puller, transport } = await setup();
    await store.putDevice(linkedDevice({ sets: ['users'] }));
    server.write('users', { id: 'u1' });
    transport.faults.push('lose_response');
    expect((await puller.pullOnce()).kind).toBe('failed');
    expect(await store.getCursors()).toEqual({});
    await puller.drain();
    expect(await store.readSet('users')).toEqual([{ id: 'u1' }]);
  });

  it('downloads a set again on a resync command, and everything again after an epoch change', async () => {
    const { store, server, transport, puller, pusher } = await setup(2);
    await store.putDevice(linkedDevice({ sets: ['users'] }));
    server.write('users', { id: 'u1' });
    await pusher.drain();
    await puller.drain();
    expect(await store.readSet('users')).toHaveLength(1);

    // A damaged local copy: the resync snapshot replaces the set as the server holds it.
    await store.applyPullPage({ users: { upserts: [{ id: 'stale' }], deletes: [], cursor: '1' } }, 0);
    expect(await puller.resync(['users'])).toEqual({ kind: 'resync', sets: ['users'] });
    expect(await store.readSet('users')).toEqual([{ id: 'u1' }]);
    expect(await store.getCursors()).toMatchObject({ users: String(server.state.xid) });
    server.write('users', { id: 'u2' });
    await puller.drain();
    expect(await store.readSet('users')).toHaveLength(2);

    // No snapshot to download (it expired): the set starts again from cursor 0.
    transport.downloadFaults.push('not_found');
    expect(await puller.resync(['users'])).toEqual({ kind: 'resync', sets: ['users'] });
    expect(await store.readSet('users')).toEqual([]);
    await puller.drain();
    expect(await store.readSet('users')).toHaveLength(2);

    server.restore(server.snapshot());
    expect(await puller.pullOnce()).toEqual({ kind: 'restarted', requeued: 2 });
    expect(await store.readSet('users')).toEqual([]);
    expect(await store.countPending()).toBe(2);
  });
});

describe('sync engine', () => {
  function fakeTimers() {
    const queue: Array<{ fn: () => void; ms: number }> = [];
    const timers: Timers = {
      set: (fn, ms) => {
        const t = { fn, ms };
        queue.push(t);
        return t;
      },
      clear: (h) => {
        const i = queue.indexOf(h as (typeof queue)[number]);
        if (i >= 0) queue.splice(i, 1);
      },
    };
    return { queue, timers };
  }

  it('backs off from 2 seconds to 5 minutes while the server cannot be reached', () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(1, () => 0.5)).toBe(2_000);
    expect(backoffDelay(2, () => 0.5)).toBe(4_000);
    expect(backoffDelay(9, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(50, () => 1)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(1, () => 0)).toBe(1_600);
  });

  it('sends soon after a save, retries with backoff when offline from the server, then pulls every 30 s', async () => {
    const { store, server, transport } = await setup();
    const { queue, timers } = fakeTimers();
    const states: number[] = [];
    const engine = new SyncEngine({
      store,
      transport,
      appVersion: '1.0.0',
      timers,
      random: () => 0.5,
      onState: (s) => states.push(s.pending),
    });
    engine.start();
    expect(queue.map((t) => t.ms)).toEqual([0]);
    await engine.save(sale());
    expect(queue.map((t) => t.ms)).toEqual([1_000]);

    transport.faults.push('lose_request');
    await engine.syncNow();
    expect(engine.current.failures).toBe(1);
    expect(queue.map((t) => t.ms)).toEqual([2_000]);
    transport.faults.push('lose_request');
    await engine.syncNow();
    expect(queue.map((t) => t.ms)).toEqual([4_000]);

    await engine.syncNow();
    expect(engine.current).toMatchObject({ failures: 0, pending: 0, lastPush: 'idle', stopped: null });
    expect(queue.map((t) => t.ms)).toEqual([30_000]);
    expect(server.state.inbox.size).toBe(1);
    expect(states.at(-1)).toBe(0);
    engine.stop();
    expect(queue).toEqual([]);
  });

  it('makes no request while the device is offline', async () => {
    const { store, transport } = await setup(1);
    const push = vi.spyOn(transport, 'push');
    const engine = new SyncEngine({ store, transport, appVersion: '1', isOnline: () => false });
    await engine.syncNow();
    expect(push).not.toHaveBeenCalled();
    expect(engine.current).toMatchObject({ online: false, pending: 1 });
  });

  it('stops when the device is revoked or its token refused', async () => {
    const { store, transport } = await setup(1);
    vi.spyOn(transport, 'push').mockResolvedValue({ ok: false, kind: 'revoked' });
    const { queue, timers } = fakeTimers();
    const engine = new SyncEngine({ store, transport, appVersion: '1', timers });
    engine.start();
    queue.length = 0;
    await engine.syncNow();
    expect(engine.current.stopped).toBe('revoked');
    expect(queue).toEqual([]);
  });
});
