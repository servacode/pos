import { and, eq, sql } from 'drizzle-orm';
import {
  ALL_PERMISSIONS,
  pinLockSeconds,
  requiredPinLength,
  type PinLength,
  type SetPinData,
  type StaffSessionData,
  type StaffSessionResponse,
} from '@serva/core';
import { pinAttempts, roles, userRoles, users, withTenant, type Database, type Transaction } from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import type { PasswordHasher } from '../auth/passwords';
import type { AccessClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

/**
 * PIN «رمز الدخول» (16 › تخمين رمز PIN; packages/core › contracts/staff.ts). The server keeps only an
 * argon2id hash and never sends it to a device. A device signs a person in online once; it then
 * keeps its own HMAC of the PIN for offline sign-ins (the cashier screens' part).
 */

export const pinInvalid = () => new AppError(401, 'pin_invalid', 'رمز الدخول غير صحيح. حاول مرة أخرى.');

export const pinLocked = (retryAfter: number) =>
  new AppError(
    429,
    'locked',
    `محاولات خاطئة كثيرة. انتظر ${retryAfter} ثانية ثم حاول مرة أخرى.`,
    undefined,
    retryAfter,
  );

/** Every role of a user with its key, name, permissions and branch. */
async function rolesOf(tx: Transaction, userId: string) {
  return tx
    .select({
      key: roles.key,
      name: roles.name,
      permissions: roles.permissions,
      branchId: userRoles.branchId,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
}

/**
 * PUT /v1/me/pin: my PIN, confirmed with my password. 6 digits for owners, managers and approvers.
 * A wrong password answers 400 invalid_credentials on `password` (not 401: the web client reads
 * 401 as an ended sign-in). The new PIN gets a new pinVersion, so devices forget the old one.
 */
export async function setMyPin(
  db: Database,
  passwords: PasswordHasher,
  auth: AccessClaims,
  input: SetPinData,
  meta: RequestMeta,
): Promise<void> {
  const [user] = await withTenant(db, auth.tenantId, (tx) =>
    tx
      .select({ passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.id, auth.userId)),
  );
  if (!user || user.status !== 'active') throw unauthorized();
  const passwordOk = user.passwordHash
    ? await passwords.verify(user.passwordHash, input.password)
    : await passwords.verifyAgainstDummy(input.password);
  if (!passwordOk) {
    await withTenant(db, auth.tenantId, (tx) =>
      audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'user.pin_refused',
          entity: 'user',
          entityId: auth.userId,
          reason: 'wrong_password',
        },
        meta,
      ),
    );
    throw new AppError(400, 'invalid_credentials', 'كلمة السر غير صحيحة.', {
      password: 'كلمة السر غير صحيحة',
    });
  }
  const pinHash = await passwords.hash(input.pin);
  await withTenant(db, auth.tenantId, async (tx) => {
    const held = await rolesOf(tx, auth.userId);
    const required = requiredPinLength(
      held.map((r) => r.key),
      held.flatMap((r) => r.permissions),
    );
    if (input.pin.length < required) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        pin: 'رمز المدير والمالك 6 أرقام',
      });
    }
    const [updated] = await tx
      .update(users)
      .set({ pinHash, pinLength: input.pin.length, pinVersion: sql`${users.pinVersion} + 1` })
      .where(eq(users.id, auth.userId))
      .returning({ pinVersion: users.pinVersion });
    // A new PIN starts with a clean slate on every device.
    await tx
      .update(pinAttempts)
      .set({ failures: 0, lockedUntil: null })
      .where(eq(pinAttempts.userId, auth.userId));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'user.pin_set',
        entity: 'user',
        entityId: auth.userId,
        data: { pinLength: input.pin.length, pinVersion: updated!.pinVersion },
      },
      meta,
    );
  });
}

type Outcome =
  | { kind: 'ok'; session: StaffSessionResponse }
  | { kind: 'invalid' }
  | { kind: 'locked'; retryAfter: number };

/**
 * POST /v1/device/staff-sessions: a person picked on a device of the store types their PIN. The
 * user must hold a role for every branch or for the device's branch. After 5 wrong PINs for one
 * user on one device it is locked for a minute, doubling with each failure after; the count lives
 * here, on the server. Every attempt is in the audit log. Unknown, disabled or PIN-less users get
 * the same answer as a wrong PIN, after the same work.
 */
export async function startStaffSession(
  db: Database,
  passwords: PasswordHasher,
  device: DeviceClaims,
  input: StaffSessionData,
  now: Date,
  meta: RequestMeta,
): Promise<StaffSessionResponse> {
  const outcome = await withTenant(db, device.tenantId, async (tx): Promise<Outcome> => {
    const record = (action: string, data: Record<string, unknown> = {}) =>
      audit(
        tx,
        {
          tenantId: device.tenantId,
          userId: user ? input.userId : null,
          actorType: 'device',
          action,
          entity: 'user',
          entityId: input.userId,
          deviceId: device.deviceId,
          data,
        },
        meta,
      );
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
    if (!user) {
      await passwords.verifyAgainstDummy(input.pin);
      await record('staff_session.failed', { reason: 'unknown_user' });
      return { kind: 'invalid' };
    }

    // One row per user and device, locked for the whole attempt: two tries at once count twice.
    await tx
      .insert(pinAttempts)
      .values({ tenantId: device.tenantId, userId: user.id, deviceId: device.deviceId })
      .onConflictDoNothing();
    const [attempts] = await tx
      .select()
      .from(pinAttempts)
      .where(and(eq(pinAttempts.userId, user.id), eq(pinAttempts.deviceId, device.deviceId)))
      .for('update');
    if (attempts!.lockedUntil && attempts!.lockedUntil.getTime() > now.getTime()) {
      const retryAfter = Math.ceil((attempts!.lockedUntil.getTime() - now.getTime()) / 1000);
      await record('staff_session.locked', { retryAfter });
      return { kind: 'locked', retryAfter };
    }

    const held = (await rolesOf(tx, user.id)).filter(
      (r) => r.branchId === null || r.branchId === device.branchId,
    );
    const ok =
      user.status === 'active' && user.pinHash !== null && held.length > 0
        ? await passwords.verify(user.pinHash, input.pin)
        : await passwords.verifyAgainstDummy(input.pin);

    if (!ok) {
      const failures = attempts!.failures + 1;
      const lockSeconds = pinLockSeconds(failures);
      await tx
        .update(pinAttempts)
        .set({
          failures,
          lastFailedAt: now,
          lockedUntil: lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000) : null,
        })
        .where(eq(pinAttempts.id, attempts!.id));
      const reason =
        user.status !== 'active'
          ? 'disabled'
          : user.pinHash === null
            ? 'no_pin'
            : held.length === 0
              ? 'other_branch'
              : 'wrong_pin';
      await record('staff_session.failed', { reason, failures, lockSeconds });
      return lockSeconds > 0 ? { kind: 'locked', retryAfter: lockSeconds } : { kind: 'invalid' };
    }

    await tx
      .update(pinAttempts)
      .set({ failures: 0, lockedUntil: null })
      .where(eq(pinAttempts.id, attempts!.id));
    await record('staff_session.signed_in', { pinVersion: user.pinVersion });
    const granted = new Set(held.flatMap((r) => r.permissions));
    return {
      kind: 'ok',
      session: {
        userId: user.id,
        fullName: user.fullName,
        roles: held.map((r) => ({ key: r.key, name: r.name, branchId: r.branchId })),
        permissions: ALL_PERMISSIONS.filter((p) => granted.has(p)),
        pinVersion: user.pinVersion,
        pinLength: user.pinLength as PinLength,
      },
    };
  });
  // Thrown after the transaction, so the failure count and the audit entry are kept.
  if (outcome.kind === 'locked') throw pinLocked(outcome.retryAfter);
  if (outcome.kind === 'invalid') throw pinInvalid();
  return outcome.session;
}
