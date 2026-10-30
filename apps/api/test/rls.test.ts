import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql, type SQL } from 'drizzle-orm';
import { branches, plans, registers, tenants, users, withTenant } from '@serva/db';
import { appDb, closeAppDb, makeApp, registerStore, resetDatabase } from './helpers';

let app: FastifyInstance;
let storeA: { tenantId: string; userId: string };
let storeB: { tenantId: string; userId: string; branchId: string };

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
});
beforeEach(async () => {
  await resetDatabase();
  const a = await registerStore(app, { phone: '0911111111', storeName: 'متجر أ' });
  const b = await registerStore(app, { phone: '0922222222', storeName: 'متجر ب' });
  storeA = { tenantId: a.body.tenant.id, userId: a.body.user.id };
  const [branchB] = await withTenant(appDb().db, b.body.tenant.id, (tx) => tx.select().from(branches));
  storeB = { tenantId: b.body.tenant.id, userId: b.body.user.id, branchId: branchB!.id };
});

/** Errors from postgres.js arrive wrapped by drizzle; this finds the database error code. */
async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    throw error;
  }
}

describe('row-level security between stores', () => {
  it('shows nothing when no store is selected', async () => {
    const { db } = appDb();
    expect(await db.select().from(tenants)).toEqual([]);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('shows a store only its own rows', async () => {
    const rows = await withTenant(appDb().db, storeA.tenantId, async (tx) => ({
      tenants: await tx.select({ id: tenants.id }).from(tenants),
      users: await tx.select({ id: users.id }).from(users),
      branches: await tx.select({ tenantId: branches.tenantId }).from(branches),
    }));

    expect(rows.tenants).toEqual([{ id: storeA.tenantId }]);
    expect(rows.users).toEqual([{ id: storeA.userId }]);
    expect(rows.branches).toEqual([{ tenantId: storeA.tenantId }]);
  });

  it('cannot write rows that belong to another store', async () => {
    const code = await pgErrorCode(
      withTenant(appDb().db, storeA.tenantId, (tx) =>
        tx.insert(branches).values({ tenantId: storeB.tenantId, code: '99', name: 'فرع مزروع' }),
      ),
    );
    expect(code).toBe('42501'); // row-level security violation
  });

  it("cannot change another store's users", async () => {
    const updated = await withTenant(appDb().db, storeA.tenantId, (tx) =>
      tx
        .update(users)
        .set({ fullName: 'مخترق' })
        .where(eq(users.id, storeB.userId))
        .returning({ id: users.id }),
    );
    expect(updated).toEqual([]);
  });

  it("cannot link its records to another store's records, even knowing their ids", async () => {
    const code = await pgErrorCode(
      withTenant(appDb().db, storeA.tenantId, (tx) =>
        tx
          .insert(registers)
          .values({ tenantId: storeA.tenantId, branchId: storeB.branchId, code: '09', name: 'x' }),
      ),
    );
    expect(code).toBe('23503'); // composite foreign key (tenant_id, branch_id)
  });

  it('cannot read platform admin accounts', async () => {
    const code = await pgErrorCode(appDb().db.execute(sql`select * from platform_users`));
    expect(code).toBe('42501'); // permission denied
  });
});

describe('billing and store status are not writable by the store role', () => {
  const inStoreA = (statement: SQL) =>
    pgErrorCode(withTenant(appDb().db, storeA.tenantId, (tx) => tx.execute(statement)));

  it('cannot change its own subscription', async () => {
    expect(
      await inStoreA(
        sql`update subscriptions set status = 'active', current_period_end = now() + interval '10 years'`,
      ),
    ).toBe('42501');
    expect(await inStoreA(sql`delete from subscriptions`)).toBe('42501');
  });

  it('cannot create a second subscription or start another trial', async () => {
    const [plan] = await withTenant(appDb().db, storeA.tenantId, (tx) => tx.select().from(plans).limit(1));
    expect(
      await inStoreA(
        sql`insert into subscriptions (tenant_id, plan_id, status) values (${storeA.tenantId}, ${plan!.id}, 'active')`,
      ),
    ).toBe('42501');
    expect(await inStoreA(sql`select subscription_start_trial(now())`)).toBe('23505');
  });

  it('cannot start a trial dated in the future, or without a store', async () => {
    const fresh = '0193e5b4-0000-7000-8000-000000000001';
    const future = withTenant(appDb().db, fresh, async (tx) => {
      await tx.insert(tenants).values({ id: fresh, name: 'x', sectors: [] });
      await tx.execute(sql`select subscription_start_trial(now() + interval '30 days')`);
    });
    expect(await pgErrorCode(future)).toBe('22023');
    expect(await pgErrorCode(appDb().db.execute(sql`select subscription_start_trial(now())`))).toBe('42501');
  });

  it("cannot change its store's status or agent attribution, but can rename it", async () => {
    expect(await inStoreA(sql`update tenants set status = 'active'`)).toBe('42501');
    expect(await inStoreA(sql`update tenants set referral_code = 'AG-1'`)).toBe('42501');

    const renamed = await withTenant(appDb().db, storeA.tenantId, (tx) =>
      tx.update(tenants).set({ name: 'متجر أ الجديد' }).returning({ name: tenants.name }),
    );
    expect(renamed).toEqual([{ name: 'متجر أ الجديد' }]);
  });

  it('cannot change or delete audit history', async () => {
    expect(await inStoreA(sql`update audit_logs set action = 'nothing'`)).toBe('42501');
    expect(await inStoreA(sql`delete from audit_logs`)).toBe('42501');
  });
});
