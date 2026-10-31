import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql, type SQL } from 'drizzle-orm';
import { branches, withTenant } from '@serva/db';
import { createDevice } from './devices';
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

describe('audit history', () => {
  it('is partitioned by month, and partitions are reachable only through the protected parent', async () => {
    const partitions = await ownerDb()<{ name: string; app_access: boolean }[]>`
      select c.relname as name,
             has_table_privilege('serva_app', c.oid, 'select') or has_table_privilege('serva_app', c.oid, 'insert') as app_access
      from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'audit_logs'::regclass order by 1`;
    expect(partitions.map((p) => p.name)).toContain('audit_logs_default');
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    expect(partitions.map((p) => p.name)).toContain(`audit_logs_${month}`);
    expect(partitions.filter((p) => p.app_access)).toEqual([]);

    const anyPartitionGranted = await ownerDb()<{ table: string }[]>`
      select c.relname as table from pg_class c
      where c.relispartition and c.relnamespace = 'public'::regnamespace
        and (has_table_privilege('serva_app', c.oid, 'select') or has_table_privilege('serva_app', c.oid, 'insert'))`;
    expect(anyPartitionGranted).toEqual([]);
  });

  it('cannot be changed or deleted, even by the owner role', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    await expect(ownerDb()`update audit_logs set action = 'x' where tenant_id = ${tenantId}`).rejects.toThrow(
      /append-only/,
    );
    await expect(ownerDb()`delete from audit_logs where tenant_id = ${tenantId}`).rejects.toThrow(
      /append-only/,
    );
    await expect(ownerDb()`delete from legal_acceptances where tenant_id = ${tenantId}`).rejects.toThrow(
      /append-only/,
    );
  });

  it('records who acted and how', async () => {
    const { body } = await registerStore(app);
    const [row] = await ownerDb()<{ actor_type: string; action: string; user_id: string }[]>`
      select actor_type, action, user_id from audit_logs where tenant_id = ${body.tenant.id}`;
    expect(row).toEqual({ actor_type: 'user', action: 'store.registered', user_id: body.user.id });
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

describe('sync tables', () => {
  it('every pulled table keeps change_xid by trigger, leaves tombstones, and is indexed for the pull', async () => {
    const tables = await ownerDb()<{ table: string; touch: boolean; tombstone: boolean; indexed: boolean }[]>`
      select c.relname as table,
             exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                     where t.tgrelid = c.oid and p.proname = 'sync_touch_change_xid') as touch,
             exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                     where t.tgrelid = c.oid and p.proname = 'sync_record_tombstone') as tombstone,
             exists (select 1 from pg_index i
                     join pg_attribute k0 on k0.attrelid = c.oid and k0.attnum = i.indkey[0]
                     join pg_attribute k1 on k1.attrelid = c.oid and k1.attnum = i.indkey[1]
                     where i.indrelid = c.oid and k0.attname = 'tenant_id' and k1.attname = 'change_xid') as indexed
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'change_xid' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
        and c.relname <> 'sync_tombstones'
      order by 1`;
    expect(tables.map((t) => t.table)).toEqual([
      'barcodes',
      'branches',
      'categories',
      'exchange_rates',
      'prices',
      'products',
      'roles',
      'stock_levels',
      'tax_rates',
      'tenant_settings',
      'units',
      'user_roles',
      'users',
      'variants',
    ]);
    expect(tables.filter((t) => !t.touch || !t.tombstone || !t.indexed)).toEqual([]);
  });

  it('change_xid is the writing transaction’s id whatever the caller sends, and a delete leaves a tombstone', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    const [row] = await ownerDb()<{ xid: string; current: string }[]>`
      update branches set name = 'x', change_xid = '1'::xid8 where tenant_id = ${tenantId}
      returning change_xid::text as xid, pg_current_xact_id()::text as current`;
    expect(row!.xid).toBe(row!.current);
    expect(row!.xid).not.toBe('1');

    await ownerDb()`delete from user_roles where tenant_id = ${tenantId}`;
    const tombstones = await ownerDb()<{ collection: string }[]>`
      select collection from sync_tombstones where tenant_id = ${tenantId}`;
    expect(tombstones).toEqual([{ collection: 'user_roles' }]);
  });

  it('sync_inbox and sync_tombstones are partitioned by month, with this month and a default', async () => {
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    for (const parent of ['sync_inbox', 'sync_tombstones']) {
      const partitions = await ownerDb()<{ name: string }[]>`
        select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
        where i.inhparent = ${parent}::regclass`;
      const names = partitions.map((p) => p.name);
      expect(names).toContain(`${parent}_default`);
      expect(names).toContain(`${parent}_${month}`);
    }
    // A new document id falls in this month's inbox partition, by its UUIDv7 time.
    const [bound] = await ownerDb()<{ inside: boolean }[]>`
      select uuid_generate_v7() >= uuid_v7_floor(date_trunc('month', now() at time zone 'utc') at time zone 'utc')
         and uuid_generate_v7() < uuid_v7_floor((date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc')
         as inside`;
    expect(bound!.inside).toBe(true);
  });

  it('the store role reads the server epoch but cannot change it, write tombstones, devices or arrived documents', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    const inStore = (statement: SQL) =>
      withTenant(appDb().db, tenantId, (tx) => tx.execute(statement)).then(
        () => 'ok',
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
      );
    const [state] = await withTenant(appDb().db, tenantId, (tx) =>
      tx.execute<{ server_epoch: number }>(sql`select server_epoch from server_state`),
    );
    expect(state!.server_epoch).toBe(1);
    expect(await inStore(sql`update server_state set server_epoch = 9`)).toBe('42501');
    expect(await inStore(sql`select server_epoch_bump()`)).toBe('42501');
    expect(
      await inStore(
        sql`insert into sync_tombstones (tenant_id, collection, record_id) values (${tenantId}, 'users', ${tenantId})`,
      ),
    ).toBe('42501');
    expect(await inStore(sql`update devices set public_key = 'x', kind = 'hub'`)).toBe('42501');
    expect(await inStore(sql`delete from devices`)).toBe('42501');
    expect(await inStore(sql`update sync_inbox set payload_hash = 'x'`)).toBe('42501');
    expect(await inStore(sql`delete from sync_inbox`)).toBe('42501');
  });

  it('a revoked device never comes back, and a code or a token once given never changes, for any role', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    const revoked = await createDevice(tenantId, { revoked: true });
    const active = await createDevice(tenantId);
    const inStore = (statement: SQL) =>
      withTenant(appDb().db, tenantId, (tx) => tx.execute(statement)).then(
        () => 'ok',
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
      );
    const checkViolation = '23514';
    expect(
      await inStore(
        sql`update devices set revoked_at = null, status = 'active' where id = ${revoked.deviceId}`,
      ),
    ).toBe(checkViolation);
    expect(
      await inStore(sql`update devices set status = 'pending_approval' where id = ${active.deviceId}`),
    ).toBe(checkViolation);
    expect(await inStore(sql`update devices set code = '999' where id = ${active.deviceId}`)).toBe(
      checkViolation,
    );
    expect(await inStore(sql`update devices set token_hash = 'x' where id = ${active.deviceId}`)).toBe(
      checkViolation,
    );
    // Not even the owner role, which bypasses row-level security.
    await expect(
      ownerDb()`update devices set status = 'active', revoked_at = null where id = ${revoked.deviceId}`,
    ).rejects.toThrow(/stays revoked|cannot go from revoked/);
    // A code exists exactly when the device was approved.
    await expect(
      ownerDb()`insert into devices (tenant_id, branch_id, name, status) values (${tenantId}, ${active.branchId}, 'x', 'active')`,
    ).rejects.toThrow(/devices_code_status_check/);
    // What a device itself reports is still writable.
    expect(
      await inStore(
        sql`update devices set unsent_count = 3, last_heartbeat_at = now() where id = ${active.deviceId}`,
      ),
    ).toBe('ok');
  });

  it('every store has a unique 6-digit store code, and the store role cannot change it', async () => {
    const a = (await registerStore(app, { phone: '0911111111' })).body;
    const b = (await registerStore(app, { phone: '0922222222' })).body;
    const codes = await ownerDb()<{ store_code: string }[]>`select store_code from tenants`;
    expect(codes).toHaveLength(2);
    for (const { store_code } of codes) expect(store_code).toMatch(/^[0-9]{6}$/);
    expect(codes[0]!.store_code).not.toBe(codes[1]!.store_code);
    const changed = await withTenant(appDb().db, a.tenant.id, (tx) =>
      tx.execute(sql`update tenants set store_code = '000000'`),
    ).then(
      () => 'ok',
      (e: { cause?: { code?: string } }) => e.cause?.code,
    );
    expect(changed).toBe('42501');
    await expect(
      ownerDb()`update tenants set store_code = '12345' where id = ${b.tenant.id}`,
    ).rejects.toThrow(/tenants_store_code_check/);
  });
});

describe('catalog and sale tables (0011)', () => {
  const inStoreOf = (tenantId: string) => (statement: SQL) =>
    withTenant(appDb().db, tenantId, (tx) => tx.execute(statement)).then(
      () => 'ok',
      (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code,
    );

  it('a new store has the two system units and no tax rate', async () => {
    const { body } = await registerStore(app);
    const rows = await ownerDb()<
      { name: string; symbol: string; allows_fraction: boolean; system_key: string }[]
    >`
      select name, symbol, allows_fraction, system_key from units where tenant_id = ${body.tenant.id} order by system_key desc`;
    expect(rows).toEqual([
      { name: 'قطعة', symbol: 'قطعة', allows_fraction: false, system_key: 'piece' },
      { name: 'كيلو', symbol: 'كغ', allows_fraction: true, system_key: 'kg' },
    ]);
    const [taxes] = await ownerDb()<{ n: number }[]>`
      select count(*)::int as n from tax_rates where tenant_id = ${body.tenant.id}`;
    expect(taxes!.n).toBe(0);
  });

  it('the store role cannot delete catalog rows, nor change stock movements or stored sale lines', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    const inStore = inStoreOf(tenantId);
    const denied = '42501';
    expect(await inStore(sql`delete from units`)).toBe(denied);
    expect(await inStore(sql`delete from products`)).toBe(denied);
    expect(await inStore(sql`delete from variants`)).toBe(denied);
    expect(await inStore(sql`delete from prices`)).toBe(denied);
    expect(await inStore(sql`delete from stock_levels`)).toBe(denied);
    expect(await inStore(sql`update stock_movements set qty = 0`)).toBe(denied);
    expect(await inStore(sql`delete from stock_movements`)).toBe(denied);
    expect(await inStore(sql`update invoice_lines set qty = 0`)).toBe(denied);
    expect(await inStore(sql`update invoice_payments set amount_minor = 0`)).toBe(denied);
    expect(await inStore(sql`update invoices set total_minor = 0`)).toBe(denied);
    expect(await inStore(sql`delete from invoices`)).toBe(denied);
    expect(await inStore(sql`update cash_movements set amount_minor = 1`)).toBe(denied);
    // A barcode taken off a variant is deleted, and devices get its tombstone.
    expect(await inStore(sql`delete from barcodes`)).toBe('ok');
  });

  it('a PIN hash always comes with its length, 4 or 6', async () => {
    const { body } = await registerStore(app);
    const userId: string = body.user.id;
    await expect(ownerDb()`update users set pin_length = 6 where id = ${userId}`).rejects.toThrow(
      /users_pin_check/,
    );
    await expect(
      ownerDb()`update users set pin_hash = 'x', pin_length = 5 where id = ${userId}`,
    ).rejects.toThrow(/users_pin_check/);
    await ownerDb()`update users set pin_hash = 'x', pin_length = 4 where id = ${userId}`;
  });

  it('renaming the store touches the settings row, so devices pull it again', async () => {
    const { body } = await registerStore(app);
    const tenantId: string = body.tenant.id;
    const [before] = await ownerDb()<{ version: number }[]>`
      select version from tenant_settings where tenant_id = ${tenantId}`;
    await ownerDb()`update tenants set name = 'سوبرماركت الفرات' where id = ${tenantId}`;
    await ownerDb()`update tenants set status = 'active' where id = ${tenantId}`;
    const [after] = await ownerDb()<{ version: number }[]>`
      select version from tenant_settings where tenant_id = ${tenantId}`;
    expect(after!.version).toBe(before!.version + 1);
  });
});
