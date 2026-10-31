import type { Permission } from '@serva/core';
import type { BranchRow, RoleRow, UserRoleRow, UserRow } from '@serva/core/contracts/catalog';
import { toLatinDigits } from '@serva/core/text';
import type { LocalStore } from '../../offline/local';
import { postStaffSession, type StaffSessionAnswer, type StaffSessionInput } from './staffApi';
import {
  checkPin,
  clearLockout,
  knownProfile,
  readLockout,
  recordFailure,
  recordServerLock,
  rememberPin,
  type StaffProfileSnapshot,
} from './verifier';

/** A person who can sign in on this device, from the `users`, `roles` and `user_roles` sets. */
export interface StaffMember {
  id: string;
  fullName: string;
  pinLength: 4 | 6;
  pinVersion: number;
  roleNames: string[];
  permissions: ReadonlySet<Permission>;
  /** The highest discount any of their roles allows without the manager (basis points) */
  maxDiscountBp: number;
}

/** Who is signed in on the device. Kept in memory only: a reload asks for the code again. */
export interface StaffSession {
  userId: string;
  fullName: string;
  roleNames: string[];
  permissions: ReadonlySet<Permission>;
  maxDiscountBp: number;
  /** Signed in with the device's own check, without the server */
  offline: boolean;
}

export interface StaffSets {
  users: UserRow[];
  roles: RoleRow[];
  user_roles: UserRoleRow[];
  branches: BranchRow[];
}

/**
 * The branch's staff (17 › السحب: موظفو الفرع): active users with a PIN who hold a role in this
 * branch or a store-wide role (branchId null). With no branch row to match yet, every role counts.
 */
export function staffRoster(sets: StaffSets, branchCode: string | null): StaffMember[] {
  const branchId = sets.branches.find((b) => b.code === branchCode)?.id ?? null;
  const roles = new Map(sets.roles.map((r) => [r.id, r]));
  const members: StaffMember[] = [];
  for (const user of sets.users) {
    if (user.status !== 'active' || user.pinLength === null) continue;
    const held = sets.user_roles
      .filter(
        (ur) => ur.userId === user.id && (ur.branchId === null || !branchId || ur.branchId === branchId),
      )
      .map((ur) => roles.get(ur.roleId))
      .filter((r): r is RoleRow => r !== undefined);
    if (held.length === 0) continue;
    members.push({
      id: user.id,
      fullName: user.fullName,
      pinLength: user.pinLength,
      pinVersion: user.pinVersion,
      roleNames: held.map((r) => r.name),
      permissions: new Set(held.flatMap((r) => r.permissions)),
      maxDiscountBp: Math.max(0, ...held.map((r) => r.maxDiscountBp)),
    });
  }
  return members.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
}

export type CodeCheck =
  | { ok: true; session: StaffSession }
  /** Wrong code; `lockedUntil` is set when this failure started a lock */
  | { ok: false; reason: 'wrong'; failures: number; lockedUntil: number }
  | { ok: false; reason: 'locked'; lockedUntil: number }
  /** Offline, and this person never signed in online on this device (with their current code) */
  | { ok: false; reason: 'never_online' }
  /** The server refused this person on this device (not this branch, disabled) */
  | { ok: false; reason: 'refused' };

export interface SignInDeps {
  local: LocalStore;
  /** The device token, null for a device that is only named */
  token: string | null;
  online: boolean;
  now: () => number;
  fetch?: typeof fetch;
}

function sessionFrom(member: StaffMember, snapshot: StaffProfileSnapshot, offline: boolean): StaffSession {
  // The server's answer names the permissions; the discount limit comes from the role rows.
  const permissions = new Set([...snapshot.permissions] as Permission[]);
  return {
    userId: member.id,
    fullName: snapshot.fullName || member.fullName,
    roleNames: snapshot.roles.length > 0 ? snapshot.roles.map((r) => r.name) : member.roleNames,
    permissions,
    maxDiscountBp: member.maxDiscountBp,
    offline,
  };
}

/**
 * Checks a person's code (16 › تخمين رمز PIN): online through POST /v1/device/staff-sessions, which
 * keeps the lockout on the server and teaches the device the code; without a connection (or when
 * the server does not answer) against the verifier the device kept, with the same lockout counted
 * locally. Used for the sign-in and for the manager's code.
 */
export async function checkCode(deps: SignInDeps, member: StaffMember, typed: string): Promise<CodeCheck> {
  const pin = toLatinDigits(typed);
  const lock = await readLockout(deps.local, member.id);
  if (lock.lockedUntil > deps.now()) return { ok: false, reason: 'locked', lockedUntil: lock.lockedUntil };

  const wrong = async (): Promise<CodeCheck> => {
    const next = await recordFailure(deps.local, member.id, deps.now());
    return { ok: false, reason: 'wrong', failures: next.failures, lockedUntil: next.lockedUntil };
  };

  if (deps.online && deps.token) {
    const input: StaffSessionInput = { userId: member.id, pin };
    const answer: StaffSessionAnswer = await postStaffSession(input, deps.token, deps.fetch);
    if (answer.kind === 'ok') {
      const snapshot: StaffProfileSnapshot = {
        fullName: answer.body.fullName,
        permissions: answer.body.permissions,
        roles: answer.body.roles,
        pinLength: answer.body.pinLength,
      };
      await rememberPin(deps.local, member.id, answer.body.pinVersion, pin, snapshot);
      await clearLockout(deps.local, member.id);
      return { ok: true, session: sessionFrom(member, snapshot, false) };
    }
    if (answer.kind === 'invalid') return wrong();
    if (answer.kind === 'locked') {
      const until = deps.now() + answer.retryAfterSeconds * 1000;
      await recordServerLock(deps.local, member.id, until);
      return { ok: false, reason: 'locked', lockedUntil: until };
    }
    if (answer.kind === 'refused') return { ok: false, reason: 'refused' };
    // No answer: check on the device, as when offline.
  }

  const result = await checkPin(deps.local, member.id, member.pinVersion, pin);
  if (result === 'unknown') return { ok: false, reason: 'never_online' };
  if (result === 'wrong') return wrong();
  await clearLockout(deps.local, member.id);
  const snapshot = await knownProfile(deps.local, member.id, member.pinVersion);
  return { ok: true, session: sessionFrom(member, snapshot!, true) };
}
