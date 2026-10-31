import { and, eq } from 'drizzle-orm';
import type { Permission } from '@serva/core';
import { roles, userRoles, users, type Transaction } from '@serva/db';
import { AppError } from '../errors';

export const forbidden = () => new AppError(403, 'forbidden', 'لا تملك صلاحية هذا الإجراء.');

/** Where a user holds a permission: every branch, or only some (a role given for one branch). */
export interface PermissionScope {
  all: boolean;
  branchIds: ReadonlySet<string>;
}

/**
 * The branches where this user holds `permission`, from their roles (16 › رفع الصلاحية: one
 * check on the server, the UI only hides buttons). Runs inside the store's transaction.
 */
export async function permissionScope(
  tx: Transaction,
  userId: string,
  permission: Permission,
): Promise<PermissionScope> {
  const rows = await tx
    .select({ permissions: roles.permissions, branchId: userRoles.branchId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.status, 'active')))
    .where(eq(userRoles.userId, userId));
  const granted = rows.filter((r) => r.permissions.includes(permission));
  return {
    all: granted.some((r) => r.branchId === null),
    branchIds: new Set(granted.flatMap((r) => (r.branchId ? [r.branchId] : []))),
  };
}

export const inScope = (scope: PermissionScope, branchId: string) =>
  scope.all || scope.branchIds.has(branchId);

/** Throws 403 unless the user holds `permission` somewhere (or in `branchId` when given). */
export async function requirePermission(
  tx: Transaction,
  userId: string,
  permission: Permission,
  branchId?: string,
): Promise<PermissionScope> {
  const scope = await permissionScope(tx, userId, permission);
  const allowed = branchId ? inScope(scope, branchId) : scope.all || scope.branchIds.size > 0;
  if (!allowed) throw forbidden();
  return scope;
}
