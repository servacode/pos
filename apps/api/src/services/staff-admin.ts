import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { assertWithinPlanLimit } from './subscription-gate';
import {
  ALL_PERMISSIONS,
  requiredPinLength,
  type Permission,
  type StaffCreateData,
  type StaffListResponse,
  type StaffMember,
  type StaffPinData,
  type StaffRoleOption,
  type StaffUpdateData,
} from '@serva/core';
import {
  branches,
  pinAttempts,
  roles,
  sessions,
  userRoles,
  users,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { forbidden, requirePermission } from '../auth/permissions';
import type { PasswordHasher } from '../auth/passwords';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

/**
 * Staff «الموظفون» (packages/core › contracts/staff-admin.ts): the store's people, each with one
 * role over every branch or a few. Needs `users.manage`. A person's roles are read live on every
 * request and on the till's sign-in, and the till learns of changes through the users, roles and
 * user_roles pull sets, so nothing here has to tell a device.
 */

const notFound = () => new AppError(404, 'not_found', 'هذا الموظف غير موجود.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

interface RoleRow {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}

interface Grant {
  permissions: readonly string[];
  branchId: string | null;
}

/** What a person holds, per role row and branch (null = every branch). */
async function grantsOf(tx: Transaction, userId: string): Promise<Grant[]> {
  return tx
    .select({ permissions: roles.permissions, branchId: userRoles.branchId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
}

/**
 * True when `grants` give every permission in `wanted` in every one of `branchIds` (null: in every
 * branch, so only role rows given for every branch count). Nobody gives more than they hold.
 */
function covers(grants: readonly Grant[], wanted: readonly string[], branchIds: readonly string[] | null) {
  const heldIn = (branchId: string | null) =>
    new Set(
      grants.filter((g) => g.branchId === null || g.branchId === branchId).flatMap((g) => g.permissions),
    );
  const targets: (string | null)[] = branchIds === null ? [null] : [...branchIds];
  return targets.every((b) => {
    const held = heldIn(b);
    return wanted.every((p) => held.has(p));
  });
}

const pinLengthOf = (role: { key: string; permissions: readonly string[] }) =>
  requiredPinLength([role.key], role.permissions);

async function loadRoles(tx: Transaction): Promise<RoleRow[]> {
  return tx
    .select({ id: roles.id, key: roles.key, name: roles.name, permissions: roles.permissions })
    .from(roles)
    .orderBy(roles.createdAt);
}

async function loadMembers(tx: Transaction, onlyId?: string): Promise<StaffMember[]> {
  const people = await tx
    .select()
    .from(users)
    .where(onlyId ? eq(users.id, onlyId) : undefined)
    .orderBy(users.createdAt);
  const held = await tx
    .select({ userId: userRoles.userId, key: roles.key, name: roles.name, branchId: userRoles.branchId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));
  return people.map((u): StaffMember => {
    const mine = held.filter((h) => h.userId === u.id);
    const owner = mine.find((h) => h.key === 'owner');
    const main = owner ?? mine[0];
    return {
      id: u.id,
      fullName: u.fullName,
      phone: u.phone,
      status: u.status,
      isOwner: owner !== undefined,
      roleKey: main?.key ?? '',
      roleName: main?.name ?? '',
      branchIds: mine.some((h) => h.branchId === null)
        ? null
        : mine.flatMap((h) => (h.branchId ? [h.branchId] : [])),
      hasPin: u.pinHash !== null,
      pinLength: u.pinLength === 4 || u.pinLength === 6 ? u.pinLength : null,
      hasLogin: u.passwordHash !== null && u.phone !== null,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
    };
  });
}

export async function listStaff(db: Database, auth: AccessClaims): Promise<StaffListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'users.manage');
    const mine = await grantsOf(tx, auth.userId);
    const roleRows = await loadRoles(tx);
    const branchRows = await tx
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(branches.code);
    return {
      staff: await loadMembers(tx),
      roles: roleRows.map((r): StaffRoleOption => ({
        key: r.key,
        name: r.name,
        permissions: ALL_PERMISSIONS.filter((p): p is Permission => r.permissions.includes(p)),
        pinLength: pinLengthOf(r),
        assignable: r.key !== 'owner' && covers(mine, r.permissions, null),
      })),
      branches: branchRows,
    };
  });
}

/** The role to give, refused when it is the owner's or holds more than the caller (in these branches). */
async function roleToGive(
  tx: Transaction,
  auth: AccessClaims,
  key: string,
  branchIds: readonly string[] | null,
): Promise<RoleRow> {
  const role = (await loadRoles(tx)).find((r) => r.key === key);
  if (!role) throw invalid({ roleKey: 'هذا الدور غير موجود' });
  if (role.key === 'owner') throw forbidden();
  if (!covers(await grantsOf(tx, auth.userId), role.permissions, branchIds)) throw forbidden();
  return role;
}

async function checkBranches(tx: Transaction, branchIds: readonly string[] | null): Promise<void> {
  if (branchIds === null) return;
  const found = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(inArray(branches.id, [...branchIds]), eq(branches.isActive, true)));
  if (found.length !== new Set(branchIds).size) throw invalid({ branchIds: 'فرع غير موجود' });
}

/** Replaces a person's role rows with one role over the given branches. */
async function giveRole(
  tx: Transaction,
  tenantId: string,
  userId: string,
  roleId: string,
  branchIds: readonly string[] | null,
): Promise<void> {
  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  const targets = branchIds === null ? [null] : [...new Set(branchIds)];
  await tx.insert(userRoles).values(targets.map((branchId) => ({ tenantId, userId, roleId, branchId })));
}

/** A target the caller may manage: not themselves, not the owner, nobody holding more than the caller. */
async function manageable(tx: Transaction, auth: AccessClaims, id: string): Promise<StaffMember> {
  const [member] = await loadMembers(tx, id);
  if (!member) throw notFound();
  if (member.isOwner || member.id === auth.userId) throw forbidden();
  const theirs = await grantsOf(tx, id);
  const mine = await grantsOf(tx, auth.userId);
  if (
    !covers(
      mine,
      theirs.flatMap((g) => g.permissions),
      member.branchIds,
    )
  )
    throw forbidden();
  return member;
}

const phoneTaken = () =>
  new AppError(409, 'phone_taken', 'هذا الرقم مسجّل لحساب آخر.', { phone: 'هذا الرقم مسجّل لحساب آخر' });

export async function createStaff(
  db: Database,
  passwords: PasswordHasher,
  auth: AccessClaims,
  input: StaffCreateData,
  meta: RequestMeta,
): Promise<StaffMember> {
  const [pinHash, passwordHash] = await Promise.all([
    passwords.hash(input.pin),
    input.password ? passwords.hash(input.password) : Promise.resolve(null),
  ]);
  try {
    return await withTenant(db, auth.tenantId, async (tx) => {
      await requirePermission(tx, auth.userId, 'users.manage');
      await assertWithinPlanLimit(tx, 'users');
      await checkBranches(tx, input.branchIds);
      const role = await roleToGive(tx, auth, input.roleKey, input.branchIds);
      if (input.pin.length < pinLengthOf(role)) throw invalid({ pin: 'رمز هذا الدور 6 أرقام' });
      const [created] = await tx
        .insert(users)
        .values({
          tenantId: auth.tenantId,
          fullName: input.fullName,
          phone: input.phone ?? null,
          passwordHash,
          pinHash,
          pinLength: input.pin.length,
          pinVersion: 1,
        })
        .returning({ id: users.id });
      await giveRole(tx, auth.tenantId, created!.id, role.id, input.branchIds);
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'staff.create',
          entity: 'user',
          entityId: created!.id,
          data: { role: role.key, branchIds: input.branchIds, login: passwordHash !== null },
        },
        meta,
      );
      const [member] = await loadMembers(tx, created!.id);
      return member!;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_phone_unique')) throw phoneTaken();
    throw error;
  }
}

export async function updateStaff(
  db: Database,
  passwords: PasswordHasher,
  auth: AccessClaims,
  id: string,
  input: StaffUpdateData,
  meta: RequestMeta,
  now: Date,
  forget: (sessionId: string) => void,
): Promise<StaffMember> {
  const [pinHash, passwordHash] = await Promise.all([
    input.pin ? passwords.hash(input.pin) : Promise.resolve(null),
    input.password ? passwords.hash(input.password) : Promise.resolve(null),
  ]);
  try {
    const { member, families } = await withTenant(db, auth.tenantId, async (tx) => {
      await requirePermission(tx, auth.userId, 'users.manage');
      const before = await manageable(tx, auth, id);
      const [row] = await tx.select().from(users).where(eq(users.id, id));

      const branchIds = input.branchIds === undefined ? before.branchIds : input.branchIds;
      const roleKey = input.roleKey ?? before.roleKey;
      const roleChanged = input.roleKey !== undefined || input.branchIds !== undefined;
      const patch: Partial<typeof users.$inferInsert> = {};
      let role: RoleRow | undefined;

      if (roleChanged) {
        await checkBranches(tx, branchIds);
        role = await roleToGive(tx, auth, roleKey, branchIds);
        const needed = pinLengthOf(role);
        if (input.pin) {
          if (input.pin.length < needed) throw invalid({ pin: 'رمز هذا الدور 6 أرقام' });
        } else if (row!.pinLength !== null && row!.pinLength < needed) {
          throw invalid({ pin: 'هذا الدور يحتاج رمزاً من 6 أرقام. اكتب رمزاً جديداً' });
        }
      } else if (input.pin) {
        const current = (await loadRoles(tx)).find((r) => r.key === before.roleKey);
        if (current && input.pin.length < pinLengthOf(current)) {
          throw invalid({ pin: 'رمز هذا الدور 6 أرقام' });
        }
      }
      if (input.pin) {
        patch.pinHash = pinHash;
        patch.pinLength = input.pin.length;
        patch.pinVersion = sql`${users.pinVersion} + 1` as unknown as number;
      }
      if (input.fullName !== undefined) patch.fullName = input.fullName;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (passwordHash) patch.passwordHash = passwordHash;
      const phoneAfter = input.phone === undefined ? row!.phone : input.phone;
      if ((passwordHash ?? row!.passwordHash) !== null && phoneAfter === null) {
        throw invalid({ phone: 'رقم الجوال مطلوب لدخول لوحة الإدارة' });
      }
      if (Object.keys(patch).length > 0) await tx.update(users).set(patch).where(eq(users.id, id));
      if (role) await giveRole(tx, auth.tenantId, id, role.id, branchIds);
      // A new password ends every session that signed in with the old one, as a reset does.
      let ended: { familyId: string }[] = [];
      if (passwordHash) {
        ended = await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)))
          .returning({ familyId: sessions.familyId });
      }
      if (input.pin) {
        await tx
          .update(pinAttempts)
          .set({ failures: 0, lockedUntil: null })
          .where(eq(pinAttempts.userId, id));
      }
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'staff.update',
          entity: 'user',
          entityId: id,
          changes: {
            ...(input.fullName !== undefined ? { fullName: [before.fullName, input.fullName] } : {}),
            ...(input.phone !== undefined ? { phone: [before.phone, input.phone] } : {}),
            ...(roleChanged
              ? { role: [before.roleKey, roleKey], branchIds: [before.branchIds, branchIds] }
              : {}),
          },
          data: { passwordChanged: passwordHash !== null, pinChanged: input.pin !== undefined },
        },
        meta,
      );
      const [member] = await loadMembers(tx, id);
      return { member: member!, families: ended.map((r) => r.familyId) };
    });
    for (const family of new Set(families)) forget(family);
    return member;
  } catch (error) {
    if (isUniqueViolation(error, 'users_phone_unique')) throw phoneTaken();
    throw error;
  }
}

/** A new till PIN. The version moves up, so every device forgets the old one. */
export async function resetStaffPin(
  db: Database,
  passwords: PasswordHasher,
  auth: AccessClaims,
  id: string,
  input: StaffPinData,
  meta: RequestMeta,
): Promise<void> {
  const pinHash = await passwords.hash(input.pin);
  await withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'users.manage');
    const member = await manageable(tx, auth, id);
    const role = (await loadRoles(tx)).find((r) => r.key === member.roleKey);
    if (role && input.pin.length < pinLengthOf(role)) throw invalid({ pin: 'رمز هذا الدور 6 أرقام' });
    await tx
      .update(users)
      .set({ pinHash, pinLength: input.pin.length, pinVersion: sql`${users.pinVersion} + 1` })
      .where(eq(users.id, id));
    await tx.update(pinAttempts).set({ failures: 0, lockedUntil: null }).where(eq(pinAttempts.userId, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'staff.pin_reset',
        entity: 'user',
        entityId: id,
      },
      meta,
    );
  });
}

/**
 * Stops a person (status disabled): their web sessions end now and the till refuses their PIN. A
 * reactivated person keeps their role and PIN. `forget` clears this server's cached session answers.
 */
export async function setStaffActive(
  db: Database,
  auth: AccessClaims,
  id: string,
  active: boolean,
  now: Date,
  meta: RequestMeta,
  forget: (sessionId: string) => void,
): Promise<StaffMember> {
  const { member, families } = await withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'users.manage');
    const before = await manageable(tx, auth, id);
    if (active && before.status !== 'active') await assertWithinPlanLimit(tx, 'users');
    await tx
      .update(users)
      .set({ status: active ? 'active' : 'disabled' })
      .where(eq(users.id, id));
    let ended: { familyId: string }[] = [];
    if (!active) {
      ended = await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)))
        .returning({ familyId: sessions.familyId });
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: active ? 'staff.reactivate' : 'staff.deactivate',
        entity: 'user',
        entityId: id,
        changes: { status: [before.status, active ? 'active' : 'disabled'] },
      },
      meta,
    );
    const [member] = await loadMembers(tx, id);
    return { member: member!, families: ended.map((s) => s.familyId) };
  });
  for (const family of new Set(families)) forget(family);
  return member;
}
