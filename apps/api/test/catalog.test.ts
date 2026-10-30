import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { branches, withTenant } from '@serva/db';
import { appDb, closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * Rules every table must follow, read from the database catalog. A new table that breaks one
 * fails here, so the rules cannot be forgotten as the schema grows to hundreds of tables.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(resetDatabase);

describe('row-level security in the catalog', () => {
  it('every table with tenant_id (and tenants itself) has RLS enabled and at least one policy', async () => {
    const offenders = await ownerDb()<{ table: string; rls: boolean; policies: number }[]>`
      select c.relname as table, c.relrowsecurity as rls,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
        and (c.relname = 'tenants' or exists (
          select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
        and (not c.relrowsecurity
             or not exists (select 1 from pg_policy p where p.polrelid = c.oid))
      order by 1`;
    expect(offenders).toEqual([]);
  });

  it('every tenant policy filters on the store set by withTenant()', async () => {
    const policies = await ownerDb()<{ table: string; using: string; check: string }[]>`
      select tablename as table, qual as using, with_check as check
      from pg_policies where schemaname = 'public' order by 1`;
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p.using, p.table).toMatch(/app_current_tenant\(\)/);
      expect(p.check ?? p.using, p.table).toMatch(/app_current_tenant\(\)/);
    }
  });

  it('SECURITY DEFINER functions pin their search_path and are not executable by everyone', async () => {
    const offenders = await ownerDb()<{ fn: string }[]>`
      select p.proname as fn
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and (not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)
             or has_function_privilege('public', p.oid, 'execute'))
      order by 1`;
    expect(offenders).toEqual([]);
  });
});

describe('schema conventions', () => {
  it('every table with updated_at also has version and the trigger that maintains both', async () => {
    const offenders = await ownerDb()<{ table: string }[]>`
      select c.relname as table
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
        and (
          not exists (select 1 from pg_attribute v where v.attrelid = c.oid and v.attname = 'version' and not v.attisdropped)
          or not exists (
            select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where t.tgrelid = c.oid and p.proname = 'bump_row_version' and not t.tgisinternal)
        )
      order by 1`;
    expect(offenders).toEqual([]);
  });

  it('every store table is keyed by (tenant_id, …) and ids default to UUIDv7', async () => {
    const badKeys = await ownerDb()<{ table: string }[]>`
      select c.relname as table
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      left join pg_index i on i.indrelid = c.oid and i.indisprimary
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
        and (i.indkey is null or i.indkey[0] <> a.attnum)
      order by 1`;
    expect(badKeys).toEqual([]);

    const badDefaults = await ownerDb()<{ table: string }[]>`
      select c.relname as table
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
        and a.atttypid = 'uuid'::regtype
        and coalesce(pg_get_expr(d.adbin, d.adrelid), '') <> 'uuid_generate_v7()'
      order by 1`;
    expect(badDefaults).toEqual([]);
  });

  it('uuid_generate_v7 gives version-7 ids that sort by creation time', async () => {
    const [earlier] = await ownerDb()<{ id: string }[]>`select uuid_generate_v7()::text as id`;
    const first = earlier!.id;
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await new Promise((resolve) => setTimeout(resolve, 3));
    const [later] = await ownerDb()<{ id: string }[]>`select uuid_generate_v7()::text as id`;
    expect(later!.id > first).toBe(true);
    const msFromId = parseInt(later!.id.replace(/-/g, '').slice(0, 12), 16);
    expect(Math.abs(msFromId - Date.now())).toBeLessThan(60_000);
  });

  it('an update bumps version and updated_at, whatever the caller sends', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    const before = await withTenant(appDb().db, tenantId, (tx) => tx.select().from(branches));
    const branch = before[0]!;
    expect(branch.version).toBe(1);

    const [after] = await withTenant(appDb().db, tenantId, (tx) =>
      tx
        .update(branches)
        .set({ name: 'الفرع الأول', version: 99, updatedAt: new Date('2000-01-01T00:00:00Z') })
        .where(eq(branches.id, branch.id))
        .returning(),
    );
    expect(after!.version).toBe(2);
    expect(after!.updatedAt.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
  });
});
