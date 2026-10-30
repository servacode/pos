import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  db: Database;
  /** Raw postgres.js client, for closing the pool */
  client: postgres.Sql;
}

/**
 * Session limits for request-serving connections (09: 15s per statement, 5s waiting for a lock,
 * 30s idle inside a transaction). The roles carry the same defaults (scripts/db-bootstrap.sql);
 * setting them here too keeps them even on a database bootstrapped without them.
 */
export const REQUEST_TIMEOUTS: Partial<postgres.ConnectionParameters> = {
  statement_timeout: 15_000,
  lock_timeout: 5_000,
  idle_in_transaction_session_timeout: 30_000,
};

export function createDb(
  url: string,
  options: {
    max?: number;
    timeouts?: Partial<postgres.ConnectionParameters> | false;
    applicationName?: string;
  } = {},
): DbHandle {
  const timeouts = options.timeouts === undefined ? REQUEST_TIMEOUTS : options.timeouts || {};
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'serva-api', ...timeouts },
  });
  return { db: drizzle(client, { schema }), client };
}

/**
 * Runs `fn` in a transaction scoped to one store: row-level security then only
 * exposes and accepts rows whose tenant_id equals `tenantId`.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
