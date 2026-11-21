import type { Permission } from '@serva/core';
import type { Transaction } from '@serva/db';
import { permissionScope } from '../../auth/permissions';

/** Whether the user holds the permission anywhere (the import answers a row, it does not throw 403 for it). */
export async function holds(tx: Transaction, userId: string, permission: Permission): Promise<boolean> {
  const scope = await permissionScope(tx, userId, permission);
  return scope.all || scope.branchIds.size > 0;
}
