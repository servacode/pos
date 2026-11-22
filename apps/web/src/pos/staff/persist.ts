import type { Permission } from '@serva/core';
import type { StaffMember, StaffSession } from './staff';

/** Minutes without a touch or a key before the device signs the cashier out (09 › tenant_settings). */
export const DEFAULT_IDLE_MINUTES = 5;

const KEY = 'serva.pos.staff-session';

/**
 * What is kept so a page reload does not ask for the code again: who signed in, on which device,
 * and when they last touched the till. No code is kept, and nothing outlives the tab
 * (sessionStorage), the explicit lock or the idle window the owner set.
 */
interface Kept {
  userId: string;
  device: string;
  pinVersion: number;
  permissions: string[];
  fullName: string;
  roleNames: string[];
  maxDiscountBp: number;
  offline: boolean;
  at: number;
}

function store(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function keepSession(
  session: StaffSession,
  member: StaffMember | undefined,
  device: string,
  now: number,
) {
  try {
    const kept: Kept = {
      userId: session.userId,
      device,
      pinVersion: member?.pinVersion ?? 0,
      permissions: [...session.permissions],
      fullName: session.fullName,
      roleNames: session.roleNames,
      maxDiscountBp: session.maxDiscountBp,
      offline: session.offline,
      at: now,
    };
    store()?.setItem(KEY, JSON.stringify(kept));
  } catch {
    // No storage here: the next reload asks for the code, as before
  }
}

/** The cashier touched the till: the idle window starts again */
export function touchSession(now: number) {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return;
    const kept = JSON.parse(raw) as Kept;
    store()?.setItem(KEY, JSON.stringify({ ...kept, at: now }));
  } catch {
    // Nothing kept or no storage
  }
}

export function forgetSession() {
  try {
    store()?.removeItem(KEY);
  } catch {
    // No storage
  }
}

/**
 * The session to bring back after a reload: the same person on the same device, still on the
 * branch roster with the code they signed in with, within the idle window. What they may do is
 * what their roles allow now, never more than they had.
 */
export function restoreSession(
  staff: readonly StaffMember[],
  device: string,
  now: number,
  idleMinutes: number,
): StaffSession | null {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const kept = JSON.parse(raw) as Kept;
    const member = staff.find((m) => m.id === kept.userId);
    const fresh = idleMinutes > 0 ? now - kept.at < idleMinutes * 60_000 && now >= kept.at - 60_000 : false;
    if (!member || kept.device !== device || member.pinVersion !== kept.pinVersion || !fresh) {
      forgetSession();
      return null;
    }
    const held = new Set(kept.permissions);
    return {
      userId: member.id,
      fullName: kept.fullName,
      roleNames: kept.roleNames,
      permissions: new Set([...member.permissions].filter((p) => held.has(p)) as Permission[]),
      maxDiscountBp: Math.min(kept.maxDiscountBp, member.maxDiscountBp),
      offline: kept.offline,
    };
  } catch {
    return null;
  }
}
