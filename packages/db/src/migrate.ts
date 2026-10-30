import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** A migration whose first line is this marker runs statement by statement, outside a transaction. */
export const NO_TRANSACTION_MARKER = '-- no-transaction';
const BREAKPOINT = '--> statement-breakpoint';

export interface Migration {
  idx: number;
  tag: string;
  /** Journal timestamp (ms). Stored as created_at, the same way drizzle's migrator records it. */
  when: number;
  /** sha256 of the file, as drizzle computes it; detects a migration edited after being applied. */
  hash: string;
  statements: string[];
  transactional: boolean;
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Reads the drizzle journal and SQL files. Fails when the journal is not strictly ordered by
 * time, because the database records migrations by that timestamp.
 */
export function readMigrations(folder: string = migrationsFolder): Migration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  const migrations: Migration[] = [];
  let previous: JournalEntry | undefined;
  for (const entry of journal.entries) {
    if (previous && !(entry.when > previous.when)) {
      throw new Error(
        `Migration ${entry.tag} is dated ${entry.when}, not after ${previous.tag} (${previous.when}). ` +
          'Regenerate it, or give it a later "when" in meta/_journal.json.',
      );
    }
    const file = readFileSync(join(folder, `${entry.tag}.sql`), 'utf8');
    migrations.push({
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: createHash('sha256').update(file).digest('hex'),
      statements: file.split(BREAKPOINT).filter((s) => s.trim() !== ''),
      transactional: !file.trimStart().startsWith(NO_TRANSACTION_MARKER),
    });
    previous = entry;
  }
  return migrations;
}

export interface MigrateOptions {
  migrationsFolder?: string;
  /** Where applied migrations are recorded; defaults match drizzle-kit, so existing databases carry on. */
  migrationsSchema?: string;
  migrationsTable?: string;
  /** How long a DDL statement may wait for a lock before failing, instead of blocking live traffic. */
  lockTimeout?: string;
}

/**
 * Applies pending migrations. Must run as the owner role (DATABASE_MIGRATION_URL).
 *
 * Unlike drizzle's built-in migrator:
 * - each migration runs in its own transaction, or none when marked `-- no-transaction`
 *   (needed for CREATE INDEX CONCURRENTLY);
 * - a pending migration dated before the latest applied one is an error, not silently skipped;
 * - an applied migration whose file changed is an error;
 * - statements wait at most `lockTimeout` for locks, and concurrent runs are serialized.
 */
export async function runMigrations(url: string, options: MigrateOptions = {}): Promise<string[]> {
  const {
    migrationsFolder: folder = migrationsFolder,
    migrationsSchema = 'drizzle',
    migrationsTable = '__drizzle_migrations',
    lockTimeout = '5s',
  } = options;
  const migrations = readMigrations(folder);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const table = sql`${sql(migrationsSchema)}.${sql(migrationsTable)}`;
  const applied: string[] = [];
  try {
    await sql`select set_config('lock_timeout', ${lockTimeout}, false)`;
    await sql`select pg_advisory_lock(hashtext('serva:migrations'))`;
    await sql`create schema if not exists ${sql(migrationsSchema)}`;
    await sql`create table if not exists ${table} (id serial primary key, hash text not null, created_at bigint)`;

    const rows = await sql<{ hash: string; created_at: string }[]>`select hash, created_at from ${table}`;
    const done = new Map(rows.map((r) => [Number(r.created_at), r.hash]));
    const latest = Math.max(0, ...done.keys());

    for (const migration of migrations) {
      const recordedHash = done.get(migration.when);
      if (recordedHash !== undefined) {
        if (recordedHash !== migration.hash) {
          throw new Error(
            `Migration ${migration.tag} was changed after it was applied. Add a new migration instead.`,
          );
        }
        continue;
      }
      if (migration.when < latest) {
        throw new Error(
          `Migration ${migration.tag} is dated before the latest applied migration, so it would be skipped. ` +
            'Give it a later "when" in meta/_journal.json.',
        );
      }
      if (migration.transactional) {
        await sql.begin(async (tx) => {
          for (const statement of migration.statements) await tx.unsafe(statement).simple();
          await tx`insert into ${table} (hash, created_at) values (${migration.hash}, ${migration.when})`;
        });
      } else {
        for (const statement of migration.statements) await sql.unsafe(statement).simple();
        await sql`insert into ${table} (hash, created_at) values (${migration.hash}, ${migration.when})`;
      }
      applied.push(migration.tag);
    }
  } finally {
    await sql`select pg_advisory_unlock(hashtext('serva:migrations'))`.catch(() => undefined);
    await sql.end();
  }
  return applied;
}
