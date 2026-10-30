import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { createDb, type DbHandle } from '@serva/db';
import type { RegisterStoreInput } from '@serva/core';
import { buildApp } from '../src/app';
import { ManualClock, type Clock } from '../src/clock';
import { loadEnv } from '../src/env';
import { REFRESH_COOKIE } from '../src/routes/auth';
import { TEST_APP_URL, TEST_OWNER_URL } from './urls';

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_APP_URL,
    JWT_SECRET: 'test-secret-that-is-definitely-long-enough-123',
    LOG_LEVEL: 'silent',
    // Every test request comes from 127.0.0.1; limits get their own tests.
    RATE_LIMIT_PER_MINUTE: '100000',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    LOGIN_PHONE_LIMIT_PER_HOUR: '1000',
    SESSION_RATE_LIMIT_PER_MINUTE: '100000',
    STORE_RATE_LIMIT_PER_MINUTE: '100000',
    ...overrides,
  });
}

let handle: DbHandle | undefined;
/** Connection as the restricted runtime role (row-level security applies). */
export function appDb(): DbHandle {
  handle ??= createDb(TEST_APP_URL, { max: 4 });
  return handle;
}

export async function closeAppDb(): Promise<void> {
  await handle?.client.end();
  handle = undefined;
}

/**
 * Builds the app against the test database. Time is a ManualClock fixed at a known instant
 * unless a clock is passed, so expiry and trial rules are deterministic.
 */
export function makeApp(
  overrides: Record<string, string> = {},
  options: { clock?: Clock } = {},
): Promise<FastifyInstance> {
  return buildApp({ env: testEnv(overrides), database: appDb(), clock: options.clock ?? new ManualClock() });
}

/** Reference tables filled by migrations; every other table is emptied between tests. */
const SEEDED_TABLES = new Set(['plans']);

let owner: postgres.Sql | undefined;
/** Connection as the owner role (not subject to row-level security). Closed by closeOwnerDb(). */
export function ownerDb(): postgres.Sql {
  owner ??= postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  return owner;
}

export async function closeOwnerDb(): Promise<void> {
  await owner?.end();
  owner = undefined;
}

/**
 * Empties every table in the public schema except seeded reference tables. The list comes from
 * the catalog, so a new table can never leak state between tests by being forgotten here.
 */
export async function resetDatabase(): Promise<void> {
  const sql = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  try {
    const tables = await sql<{ name: string }[]>`
      select c.relname as name
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p')
        and not c.relispartition`;
    const names = tables.map((t) => t.name).filter((name) => !SEEDED_TABLES.has(name));
    if (names.length > 0) {
      await sql.unsafe(`truncate table ${names.map((n) => `"${n}"`).join(', ')} restart identity cascade`);
    }
  } finally {
    await sql.end();
  }
}

export function storeInput(overrides: Partial<RegisterStoreInput> = {}): RegisterStoreInput {
  return {
    storeName: 'متجر الأمل',
    ownerName: 'أحمد الخطيب',
    phone: '0912345678',
    password: 'secret-pass-1',
    sectors: ['clothing'],
    baseCurrency: 'SYP',
    ...overrides,
  };
}

export function refreshCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;
}

export async function registerStore(app: FastifyInstance, overrides: Partial<RegisterStoreInput> = {}) {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: storeInput(overrides) });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { res, body: res.json(), cookie: refreshCookie(res)! };
}
