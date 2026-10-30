import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, readMigrations, runMigrations } from '../src/migrate';

/** Test databases only: the name must end with _test. */
const OWNER_URL =
  process.env.TEST_DATABASE_MIGRATION_URL ?? 'postgres://serva_owner:serva_owner@localhost:5432/serva_test';
if (!new URL(OWNER_URL).pathname.endsWith('_test')) throw new Error('Refusing to run on a non-test database');

const SCHEMA = 'migrator_probe';
const sql = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
let folder: string;

interface Entry {
  tag: string;
  when: number;
  sql: string;
}

function writeMigrations(entries: Entry[]): void {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: entries.map((e, idx) => ({ idx, version: '7', when: e.when, tag: e.tag, breakpoints: true })),
  };
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const e of entries) writeFileSync(join(folder, `${e.tag}.sql`), e.sql);
}

const migrate = () =>
  runMigrations(OWNER_URL, {
    migrationsFolder: folder,
    migrationsSchema: SCHEMA,
    migrationsTable: 'applied',
  });

const createTable: Entry = {
  tag: '0000_table',
  when: 1_000,
  sql: `CREATE TABLE ${SCHEMA}.items (id int primary key, name text);--> statement-breakpoint
INSERT INTO ${SCHEMA}.items VALUES (1, 'a');`,
};
const concurrentIndex: Entry = {
  tag: '0001_index',
  when: 2_000,
  sql: `-- no-transaction
CREATE INDEX CONCURRENTLY items_name_idx ON ${SCHEMA}.items (name);`,
};

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'serva-migrations-'));
  await sql`drop schema if exists ${sql(SCHEMA)} cascade`;
  await sql`create schema ${sql(SCHEMA)}`;
});
afterEach(async () => {
  rmSync(folder, { recursive: true, force: true });
  await sql`drop schema if exists ${sql(SCHEMA)} cascade`;
});
afterAll(() => sql.end());

describe('runMigrations', () => {
  it('applies pending migrations once, in order', async () => {
    writeMigrations([createTable]);
    expect(await migrate()).toEqual(['0000_table']);
    expect(await migrate()).toEqual([]);

    const rows = await sql`select created_at from ${sql(SCHEMA)}.applied`;
    expect(rows.map((r) => Number(r.created_at))).toEqual([1_000]);
  });

  it('runs a migration marked -- no-transaction outside a transaction (CREATE INDEX CONCURRENTLY)', async () => {
    writeMigrations([createTable, concurrentIndex]);
    expect(await migrate()).toEqual(['0000_table', '0001_index']);

    const [index] =
      await sql`select indexname from pg_indexes where schemaname = ${SCHEMA} and indexname = 'items_name_idx'`;
    expect(index).toBeDefined();
  });

  it('refuses a pending migration dated before the latest applied one instead of skipping it', async () => {
    writeMigrations([{ ...createTable, when: 5_000 }]);
    await migrate();

    writeMigrations([
      { tag: '0000_late_branch', when: 4_000, sql: `CREATE TABLE ${SCHEMA}.late (id int);` },
      { ...createTable, when: 5_000 },
    ]);
    await expect(migrate()).rejects.toThrow(/dated before the latest applied migration/);
    const [late] = await sql`select to_regclass(${`${SCHEMA}.late`}) as t`;
    expect(late?.t).toBeNull();
  });

  it('refuses to continue when an applied migration was edited', async () => {
    writeMigrations([createTable]);
    await migrate();

    writeMigrations([{ ...createTable, sql: `${createTable.sql}\n-- edited` }]);
    await expect(migrate()).rejects.toThrow(/changed after it was applied/);
  });

  it('rolls back a failing migration completely and records nothing', async () => {
    writeMigrations([
      {
        tag: '0000_broken',
        when: 1_000,
        sql: `CREATE TABLE ${SCHEMA}.half (id int);--> statement-breakpoint
SELECT 1 / 0;`,
      },
    ]);
    await expect(migrate()).rejects.toThrow(/division by zero/);

    const [half] = await sql`select to_regclass(${`${SCHEMA}.half`}) as t`;
    expect(half?.t).toBeNull();
    const rows = await sql`select 1 from ${sql(SCHEMA)}.applied`;
    expect(rows).toHaveLength(0);
  });
});

describe('readMigrations', () => {
  it('rejects a journal whose timestamps are not strictly increasing', () => {
    writeMigrations([
      { ...createTable, when: 2_000 },
      { ...concurrentIndex, when: 2_000 },
    ]);
    expect(() => readMigrations(folder)).toThrow(/not after 0000_table/);
  });

  it("reads the project's migrations in order", () => {
    const migrations = readMigrations(migrationsFolder);
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    expect(migrations.map((m) => m.idx)).toEqual(migrations.map((_, i) => i));
    expect(migrations.every((m) => m.transactional)).toBe(true);
  });
});
