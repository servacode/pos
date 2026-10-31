import { and, eq, inArray } from 'drizzle-orm';
import { roles, userRoles, users, type Transaction } from '@serva/db';
import { forbidden, requirePermission } from '../../auth/permissions';
import type { AccessClaims } from '../../auth/tokens';
import { AppError } from '../../errors';
import type { RequestMeta } from '../../types';

/** Every catalog write: who, when, from where. */
export interface CatalogContext {
  auth: AccessClaims;
  now: Date;
  meta: RequestMeta;
}

export const notFound = (message: string) => new AppError(404, 'not_found', message);

/** 409 stale_version (17 › التعديل المتزامن): the screen reloads the record and shows what changed. */
export const staleVersion = () =>
  new AppError(409, 'stale_version', 'عدّل شخص آخر هذا السجل للتو. حدّثنا البيانات، راجعها ثم احفظ من جديد.');

/** validation_failed on one field; `path` is dotted («variants.0.barcodes.1.code»). */
export function fieldError(path: string, message: string): AppError {
  const top = path.split('.')[0]!;
  return new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
    [top]: message,
    ...(top === path ? {} : { [path]: message }),
  });
}

/** The system role keys of a signed-in user (active users only). */
async function roleKeys(tx: Transaction, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.status, 'active')))
    .where(and(eq(userRoles.userId, userId), inArray(roles.key, ['owner', 'manager'])));
  return rows.map((r) => r.key);
}

/** Reading the catalog in the admin (17: «owner, manager»): those roles, or catalog.manage. */
export async function requireCatalogReader(tx: Transaction, userId: string): Promise<void> {
  if ((await roleKeys(tx, userId)).length > 0) return;
  await requirePermission(tx, userId, 'catalog.manage');
}

/** Writing products, categories and units. */
export async function requireCatalogManager(tx: Transaction, userId: string): Promise<void> {
  await requirePermission(tx, userId, 'catalog.manage');
}

/** Tax rates are the owner's alone (17 › المنتجات: tax-rates «owner»). */
export async function requireOwner(tx: Transaction, userId: string): Promise<void> {
  if (!(await roleKeys(tx, userId)).includes('owner')) throw forbidden();
}

export const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Field-by-field changes for the audit log: only what really changed. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const old = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    const now = value instanceof Date ? value.toISOString() : value;
    if (JSON.stringify(old) !== JSON.stringify(now)) changes[key] = [old ?? null, now ?? null];
  }
  return changes;
}
