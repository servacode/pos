import { sql } from 'drizzle-orm';
import type { CustomerGroup, CustomerGroupInput } from '@serva/core';
import { customerGroups, withTenant, type Database } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { eq } from 'drizzle-orm';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

const newId = createUuidV7();

/** «مجموعات الزبائن»: a name and the discount its customers get (the owner sets it, customers join it on their page). */
export function listCustomerGroups(db: Database, auth: AccessClaims): Promise<CustomerGroup[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const rows = await tx.execute<{
      id: string;
      name: string;
      bps: number;
      archived: boolean;
      n: string;
    }>(sql`
      select g.id, g.name, g.discount_bps as bps, g.archived_at is not null as archived,
             (select count(*) from customers c where c.tenant_id = g.tenant_id and c.group_id = g.id)::text as n
      from customer_groups g order by g.archived_at is not null, g.name`);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      discountBps: r.bps,
      archived: r.archived,
      customers: Number(r.n),
    }));
  });
}

async function save(
  db: Database,
  auth: AccessClaims,
  id: string | null,
  input: CustomerGroupInput,
  meta: RequestMeta,
  now: Date,
): Promise<CustomerGroup> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.manage');
    const [same] = await tx.execute<{ id: string }>(
      sql`select id from customer_groups where lower(name) = lower(${input.name}) ${id ? sql`and id <> ${id}` : sql``}`,
    );
    if (same) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        name: 'لديك مجموعة بهذا الاسم',
      });
    }
    let groupId = id;
    if (id) {
      const [found] = await tx.execute<{ id: string }>(sql`select id from customer_groups where id = ${id}`);
      if (!found) throw new AppError(404, 'not_found', 'هذه المجموعة غير موجودة.');
      await tx
        .update(customerGroups)
        .set({
          name: input.name,
          discountBps: input.discountBps,
          ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
        })
        .where(eq(customerGroups.id, id));
    } else {
      groupId = newId();
      await tx
        .insert(customerGroups)
        .values({ tenantId: auth.tenantId, id: groupId, name: input.name, discountBps: input.discountBps });
    }
    // The tills carry each customer's group and its percent (sync-pull › customers): a change here touches them, so they are pulled again
    if (id) await tx.execute(sql`update customers set updated_at = now() where group_id = ${id}::uuid`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: id ? 'customer_group.update' : 'customer_group.create',
        entity: 'customer_group',
        entityId: groupId!,
        changes: { name: [null, input.name], discountBps: [null, input.discountBps] },
      },
      meta,
    );
    const [row] = await tx.execute<{ n: string; archived: boolean }>(sql`
      select (select count(*) from customers where group_id = ${groupId}::uuid)::text as n,
             archived_at is not null as archived
      from customer_groups where id = ${groupId}::uuid`);
    return {
      id: groupId!,
      name: input.name,
      discountBps: input.discountBps,
      archived: row?.archived ?? false,
      customers: Number(row?.n ?? 0),
    };
  });
}

export const createCustomerGroup = (
  db: Database,
  auth: AccessClaims,
  input: CustomerGroupInput,
  meta: RequestMeta,
  now: Date,
) => save(db, auth, null, input, meta, now);

export const updateCustomerGroup = (
  db: Database,
  auth: AccessClaims,
  id: string,
  input: CustomerGroupInput,
  meta: RequestMeta,
  now: Date,
) => save(db, auth, id, input, meta, now);
