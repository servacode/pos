import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HallApi, HallAnswer } from '../../hall/api';
import { memoryLocal } from '../../offline/local';
import { CANCEL_QUEUE_KEY, cancelSentLines, flushPendingCancels, type PendingCancel } from './cancelSent';

const approve = vi.hoisted(() => vi.fn());
vi.mock('../staff/approve', () => ({ approveWithCode: approve }));

const boss = { id: 'boss', fullName: 'مريم' } as never;
const deps = { local: memoryLocal(), token: 't', online: true, now: () => 1_000 };
const ok: HallAnswer<{ order: null }> = { kind: 'ok', body: { order: null } };

function apiOf(answer: (command: Record<string, unknown>) => HallAnswer<{ order: null }>) {
  const sent: Record<string, unknown>[] = [];
  const api = {
    command: vi.fn(async (c: Record<string, unknown>) => {
      sent.push(c);
      return answer(c);
    }),
  } as unknown as HallApi;
  return { api, sent };
}

const base = {
  staff: [boss],
  orderId: 'o1',
  lineIds: ['l1', 'l2'],
  userId: 'cashier',
  reason: 'خطأ',
  approverId: 'boss',
  pin: '147258',
};

beforeEach(() => {
  approve.mockReset();
});

describe('cancelling sent lines from the till', () => {
  it('sends the server’s cancel with the code for every line when it can be reached', async () => {
    const { api, sent } = apiOf(() => ok);
    const local = memoryLocal();
    const answer = await cancelSentLines({ ...base, api, reachable: true, local, deps: { ...deps, local } });
    expect(answer).toEqual({ kind: 'ok', queued: false });
    expect(sent.map((c) => [c.type, c.lineId, c.approverPin])).toEqual([
      ['cancel', 'l1', '147258'],
      ['cancel', 'l2', '147258'],
    ]);
  });

  it('turns the server’s refusals into what the pad shows: a wrong code, a lock, or the message', async () => {
    const local = memoryLocal();
    const run = (refusal: HallAnswer<{ order: null }>) =>
      cancelSentLines({
        ...base,
        api: apiOf(() => refusal).api,
        reachable: true,
        local,
        deps: { ...deps, local },
      });
    const refused = (code: string, message = 'م') =>
      ({ kind: 'refused', code, message, status: 400 }) as HallAnswer<{ order: null }>;
    expect(await run(refused('pin_invalid'))).toMatchObject({ kind: 'status', status: { kind: 'wrong' } });
    expect(await run({ ...refused('locked'), retryAfterSeconds: 30 } as never)).toMatchObject({
      kind: 'status',
      status: { kind: 'locked', until: 31_000 },
    });
    expect(await run(refused('conflict', 'قُدِّم هذا البند للزبون.'))).toEqual({
      kind: 'error',
      message: 'قُدِّم هذا البند للزبون.',
    });
  });

  it('checks the manager’s code on the device and queues the cancel when there is no connection', async () => {
    approve.mockResolvedValue({ ok: true, approval: { at: '2026-11-12T10:00:00.000Z' } });
    const local = memoryLocal();
    for (const api of [null, apiOf(() => ({ kind: 'network' })).api]) {
      const answer = await cancelSentLines({
        ...base,
        api,
        reachable: api !== null,
        local,
        deps: { ...deps, local },
      });
      expect(answer).toEqual({ kind: 'ok', queued: true });
    }
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ online: false }), boss, '147258');
    expect((await local.get<PendingCancel[]>(CANCEL_QUEUE_KEY))!.map((p) => p.at)).toEqual([
      '2026-11-12T10:00:00.000Z',
      '2026-11-12T10:00:00.000Z',
    ]);
  });

  it('queues nothing when the local code is wrong or the manager is unknown', async () => {
    approve.mockResolvedValue({ ok: false, reason: 'wrong', failures: 1, lockedUntil: 0 });
    const local = memoryLocal();
    const wrong = await cancelSentLines({
      ...base,
      api: null,
      reachable: false,
      local,
      deps: { ...deps, local },
    });
    expect(wrong).toMatchObject({ kind: 'status', status: { kind: 'wrong' } });
    const unknown = await cancelSentLines({
      ...base,
      staff: [],
      api: null,
      reachable: false,
      local,
      deps: { ...deps, local },
    });
    expect(unknown.kind).toBe('error');
    expect(await local.get(CANCEL_QUEUE_KEY)).toBeNull();
  });

  it('sends the waiting cancels with the offline approval once online, keeping only those with no answer', async () => {
    const local = memoryLocal();
    const item: PendingCancel = {
      orderId: 'o1',
      lineIds: ['l1', 'l2'],
      userId: 'cashier',
      reason: 'خطأ',
      approverId: 'boss',
      at: '2026-11-12T10:00:00.000Z',
    };
    // Nothing waiting: nothing is sent
    const idle = apiOf(() => ok);
    await flushPendingCancels(idle.api, local);
    expect(idle.sent).toEqual([]);
    await local.set(CANCEL_QUEUE_KEY, [item]);
    const { api, sent } = apiOf((c) =>
      c.lineId === 'l2'
        ? { kind: 'network' }
        : { kind: 'refused', code: 'conflict', message: 'م', status: 409 },
    );
    await flushPendingCancels(api, local);
    expect(sent[0]).toMatchObject({ type: 'cancel', offlineApproval: { at: item.at } });
    expect(sent[0]).not.toHaveProperty('approverPin');
    // A refusal for good is dropped; the line with no answer waits
    expect(await local.get(CANCEL_QUEUE_KEY)).toEqual([{ ...item, lineIds: ['l2'] }]);
  });
});
