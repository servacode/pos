import { describe, expect, it } from 'vitest';
import {
  CANCELLABLE_AFTER_SEND,
  hallCommand,
  isPrepared,
  kitchenCommand,
  kitchenMayMove,
  LINE_STATUSES,
  LINE_STATUS_TEXT,
  type LineStatus,
} from './hall';

const ID = '0192a000-0000-7000-8000-000000000001';
const OTHER = '0192a000-0000-7000-8000-000000000002';

describe('the kitchen’s moves', () => {
  it('goes forward from sent, can undo a step, and never touches a new, served or cancelled line', () => {
    expect(kitchenMayMove('sent', 'preparing')).toBe(true);
    expect(kitchenMayMove('sent', 'ready')).toBe(true);
    expect(kitchenMayMove('preparing', 'ready')).toBe(true);
    expect(kitchenMayMove('preparing', 'sent')).toBe(true);
    expect(kitchenMayMove('ready', 'preparing')).toBe(true);
    expect(kitchenMayMove('ready', 'sent')).toBe(false);
    for (const from of ['new', 'served', 'cancelled'] as const) {
      for (const to of LINE_STATUSES) expect(kitchenMayMove(from, to)).toBe(false);
    }
  });

  it('knows a line the kitchen has started, and what can be cancelled after the send', () => {
    const prepared = LINE_STATUSES.filter(isPrepared);
    expect(prepared).toEqual(['preparing', 'ready']);
    expect(CANCELLABLE_AFTER_SEND).toEqual(['sent', 'preparing', 'ready']);
    expect(Object.keys(LINE_STATUS_TEXT).sort()).toEqual([...LINE_STATUSES].sort());
    expect(LINE_STATUS_TEXT['sent' satisfies LineStatus]).toBe('جديد');
  });
});

describe('hall commands', () => {
  it('reads each command, with defaults for choices', () => {
    expect(hallCommand.parse({ type: 'open', userId: ID, table: ' 5 ' })).toEqual({
      type: 'open',
      userId: ID,
      table: '5',
    });
    const add = hallCommand.parse({
      type: 'add',
      userId: ID,
      orderId: ID,
      lines: [{ productId: ID, variantId: OTHER, name: 'قهوة', qty: 2 }],
    });
    expect(add.type === 'add' && add.lines[0]!.choices).toEqual([]);
    for (const body of [
      { type: 'remove', userId: ID, orderId: ID, lineId: OTHER },
      { type: 'send', userId: ID, orderId: ID },
      { type: 'bill', userId: ID, orderId: ID },
      { type: 'serve', userId: ID, orderId: ID, lineIds: [OTHER] },
      { type: 'close', userId: ID, orderId: ID, reason: 'paid', ref: 'INV-1' },
      { type: 'close', userId: ID, orderId: ID, reason: 'empty' },
      {
        type: 'cancel',
        userId: ID,
        orderId: ID,
        lineId: OTHER,
        reason: 'غيّر رأيه',
        approverId: ID,
        approverPin: '285713',
      },
    ]) {
      expect(hallCommand.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it('refuses a missing reason, a bad PIN, an empty list, a bad quantity and an unknown type', () => {
    const cancel = { type: 'cancel', userId: ID, orderId: ID, lineId: OTHER, approverId: ID };
    expect(hallCommand.safeParse({ ...cancel, reason: '', approverPin: '285713' }).success).toBe(false);
    expect(hallCommand.safeParse({ ...cancel, reason: 'سبب', approverPin: '12' }).success).toBe(false);
    expect(hallCommand.safeParse({ type: 'add', userId: ID, orderId: ID, lines: [] }).success).toBe(false);
    expect(
      hallCommand.safeParse({
        type: 'add',
        userId: ID,
        orderId: ID,
        lines: [{ productId: ID, variantId: ID, name: 'x', qty: 0 }],
      }).success,
    ).toBe(false);
    expect(hallCommand.safeParse({ type: 'pay', userId: ID }).success).toBe(false);
  });

  it('reads moving, merging and the parts of a split bill', () => {
    const base = { userId: ID, orderId: ID };
    expect(hallCommand.safeParse({ ...base, type: 'move', table: 'VIP' }).success).toBe(true);
    expect(hallCommand.safeParse({ ...base, type: 'move', table: ' ' }).success).toBe(false);
    expect(hallCommand.safeParse({ ...base, type: 'merge', fromOrderId: OTHER }).success).toBe(true);
    expect(hallCommand.safeParse({ ...base, type: 'merge' }).success).toBe(false);
    expect(hallCommand.safeParse({ ...base, type: 'part', ref: 'INV-1', lineIds: [OTHER] }).success).toBe(
      true,
    );
    expect(hallCommand.safeParse({ ...base, type: 'part', ref: 'INV-1', equal: { parts: 3 } }).success).toBe(
      true,
    );
    expect(hallCommand.safeParse({ ...base, type: 'part', ref: '', lineIds: [OTHER] }).success).toBe(false);
    expect(hallCommand.safeParse({ ...base, type: 'part', ref: 'x', lineIds: [] }).success).toBe(false);
    expect(hallCommand.safeParse({ ...base, type: 'part', ref: 'x', equal: { parts: 1 } }).success).toBe(
      false,
    );
  });

  it('takes a cancellation with the manager’s code or with an offline approval', () => {
    const cancel = { type: 'cancel', userId: ID, orderId: ID, lineId: OTHER, approverId: ID, reason: 'سبب' };
    expect(hallCommand.safeParse({ ...cancel, approverPin: '285713' }).success).toBe(true);
    expect(
      hallCommand.safeParse({ ...cancel, offlineApproval: { at: '2026-11-12T10:00:00.000Z' } }).success,
    ).toBe(true);
    expect(hallCommand.safeParse({ ...cancel, offlineApproval: { at: 'yesterday' } }).success).toBe(false);
  });

  it('reads the kitchen’s commands', () => {
    expect(kitchenCommand.safeParse({ type: 'status', lineIds: [ID], status: 'ready' }).success).toBe(true);
    expect(kitchenCommand.safeParse({ type: 'ack', lineIds: [ID] }).success).toBe(true);
    // The kitchen never serves or cancels
    expect(kitchenCommand.safeParse({ type: 'status', lineIds: [ID], status: 'served' }).success).toBe(false);
  });
});
