import { sql } from 'drizzle-orm';
import type { BranchInput, BranchAdminRow } from '@serva/core';
import { branches, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { assertWithinPlanLimit } from './subscription-gate';

/** The store's branches: list, add (within the plan), rename, stop and restart (packages/core › contracts/branches.ts). */

type Db = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  devices: number;
  staff: number;
};

const toRow = (r: Db): BranchAdminRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  address: r.address,
  phone: r.phone,
  isActive: r.is_active,
  deviceCount: r.devices,
  staffCount: r.staff,
});

const select = sql`
  select b.id, b.code, b.name, b.address, b.phone, b.is_active,
         (select count(*)::int from devices d where d.branch_id = b.id and d.status = 'active' and d.revoked_at is null) as devices,
         (select count(distinct ur.user_id)::int from user_roles ur join users u on u.id = ur.user_id
            where ur.branch_id = b.id and u.status = 'active') as staff
  from branches b`;

const notFound = () => new AppError(404, 'not_found', 'هذا الفرع غير موجود.');

async function readOne(tx: Transaction, id: string): Promise<BranchAdminRow> {
  const [row] = await tx.execute<Db>(sql`${select} where b.id = ${id}`);
  if (!row) throw notFound();
  return toRow(row);
}

export async function listBranches(db: Database, auth: AccessClaims): Promise<BranchAdminRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const rows = await tx.execute<Db>(sql`${select} order by b.code`);
    return rows.map(toRow);
  });
}

export async function createBranch(
  db: Database,
  auth: AccessClaims,
  input: BranchInput,
  meta: RequestMeta,
): Promise<BranchAdminRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    await assertWithinPlanLimit(tx, 'branches');
    // The next code, 001, 002, … after the highest in use: a stopped branch keeps its code
    const [last] = await tx.execute<{ n: number }>(
      sql`select coalesce(max(code::int), 0)::int as n from branches where code ~ '^[0-9]+$'`,
    );
    const code = String((last?.n ?? 0) + 1).padStart(3, '0');
    const [made] = await tx
      .insert(branches)
      .values({
        tenantId: auth.tenantId,
        code,
        name: input.name,
        address: input.address ?? null,
        phone: input.phone ?? null,
      })
      .returning({ id: branches.id });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'branch.create',
        entity: 'branch',
        entityId: made!.id,
        changes: { name: [null, input.name], code: [null, code] },
      },
      meta,
    );
    return readOne(tx, made!.id);
  });
}

export async function updateBranch(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: BranchInput,
  meta: RequestMeta,
): Promise<BranchAdminRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await readOne(tx, id);
    const address = input.address === undefined ? before.address : input.address;
    const phone = input.phone === undefined ? before.phone : input.phone;
    await tx.execute(sql`
      update branches set name = ${input.name}, address = ${address}, phone = ${phone},
        version = version + 1, updated_at = now()
      where id = ${id}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'branch.update',
        entity: 'branch',
        entityId: id,
        changes: { name: [before.name, input.name] },
      },
      meta,
    );
    return readOne(tx, id);
  });
}

/** Stops or restarts a branch. The last active one cannot be stopped, and one with live devices is emptied first. */
export async function setBranchActive(
  db: Database,
  auth: AccessClaims,
  id: string,
  active: boolean,
  meta: RequestMeta,
): Promise<BranchAdminRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await readOne(tx, id);
    if (before.isActive === active) return before;
    if (active) {
      await assertWithinPlanLimit(tx, 'branches');
    } else {
      const [others] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from branches where is_active and id <> ${id}`,
      );
      if ((others?.n ?? 0) === 0) {
        throw new AppError(409, 'conflict', 'لا يمكن إيقاف آخر فرع فعّال.');
      }
      if (before.deviceCount > 0) {
        throw new AppError(409, 'conflict', 'أوقف أجهزة الفرع أولاً من صفحة الأجهزة، ثم أوقفه.');
      }
    }
    await tx.execute(
      sql`update branches set is_active = ${active}, version = version + 1, updated_at = now() where id = ${id}`,
    );
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: active ? 'branch.start' : 'branch.stop',
        entity: 'branch',
        entityId: id,
        changes: { isActive: [before.isActive, active] },
      },
      meta,
    );
    return readOne(tx, id);
  });
}
