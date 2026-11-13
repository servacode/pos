import type { LocalStore } from '../../offline/local';
import type { HallApi } from '../../hall/api';
import type { PinStatus } from '../PinScreen';
import { approveWithCode } from '../staff/approve';
import type { SignInDeps, StaffMember } from '../staff/staff';
import { statusOf } from '../staff/StaffSignIn';

/**
 * Removing a line that already went to the kitchen from the till (03 › الإلغاء بعد المطبخ): the
 * server's own cancel command, with a reason and a manager's code, so the kitchen screen sees it
 * and the owner's report lists it. With no connection the manager's code is checked on the device
 * and the cancellation waits in a list, sent when the till can reach the server again.
 */

export const CANCEL_QUEUE_KEY = 'hallPendingCancels';

/** A cancellation approved on this till while offline, waiting to reach the server */
export interface PendingCancel {
  orderId: string;
  lineIds: string[];
  userId: string;
  reason: string;
  approverId: string;
  /** When the manager typed the code on the device */
  at: string;
}

export type CancelAnswer =
  | { kind: 'ok'; queued: boolean }
  | { kind: 'status'; status: PinStatus }
  | { kind: 'error'; message: string };

export async function cancelSentLines(args: {
  api: HallApi | null;
  /** The last read of the hall got an answer */
  reachable: boolean;
  local: LocalStore;
  deps: SignInDeps;
  staff: readonly StaffMember[];
  orderId: string;
  lineIds: string[];
  userId: string;
  reason: string;
  approverId: string;
  pin: string;
}): Promise<CancelAnswer> {
  const { api, local, orderId, lineIds, userId, reason, approverId, pin } = args;
  if (api && args.reachable) {
    for (const lineId of lineIds) {
      const answer = await api.command({
        type: 'cancel',
        userId,
        orderId,
        lineId,
        reason,
        approverId,
        approverPin: pin,
      });
      if (answer.kind === 'ok') continue;
      if (answer.kind === 'network') return queue();
      if (answer.code === 'pin_invalid') return { kind: 'status', status: { kind: 'wrong', failures: 1 } };
      if (answer.code === 'locked') {
        return {
          kind: 'status',
          status: { kind: 'locked', until: args.deps.now() + (answer.retryAfterSeconds ?? 60) * 1000 },
        };
      }
      return { kind: 'error', message: answer.message };
    }
    return { kind: 'ok', queued: false };
  }
  return queue();

  /** No answer from the server: the manager's code is checked here, then the cancel waits */
  async function queue(): Promise<CancelAnswer> {
    const approver = args.staff.find((m) => m.id === approverId);
    if (!approver) return { kind: 'error', message: 'هذا المدير غير معروف على هذا الجهاز.' };
    const checked = await approveWithCode({ ...args.deps, online: false }, approver, pin);
    if (!checked.ok) return { kind: 'status', status: statusOf(checked) };
    const list = (await local.get<PendingCancel[]>(CANCEL_QUEUE_KEY)) ?? [];
    await local.set(CANCEL_QUEUE_KEY, [
      ...list,
      { orderId, lineIds, userId, reason, approverId, at: checked.approval.at },
    ]);
    return { kind: 'ok', queued: true };
  }
}

/** Sends the waiting cancellations; one the server refuses for good (already served, closed) is dropped */
export async function flushPendingCancels(api: HallApi, local: LocalStore): Promise<void> {
  const list = await local.get<PendingCancel[]>(CANCEL_QUEUE_KEY);
  if (!list || list.length === 0) return;
  const left: PendingCancel[] = [];
  for (const item of list) {
    const rest: string[] = [];
    for (const lineId of item.lineIds) {
      const answer = await api.command({
        type: 'cancel',
        userId: item.userId,
        orderId: item.orderId,
        lineId,
        reason: item.reason,
        approverId: item.approverId,
        offlineApproval: { at: item.at },
      });
      if (answer.kind === 'network') rest.push(lineId);
    }
    if (rest.length > 0) left.push({ ...item, lineIds: rest });
  }
  await local.set(CANCEL_QUEUE_KEY, left);
}
