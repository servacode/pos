import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { createDb, type DbHandle } from '@serva/db';
import { buildSalePayload, TERMS_VERSION, type RegisterStoreInput } from '@serva/core';
import { buildApp } from '../src/app';
import type { OtpMessage, OtpSender } from '../src/auth/otp';
import { ManualClock, type Clock } from '../src/clock';
import { loadEnv } from '../src/env';
import { REFRESH_COOKIE } from '../src/routes/auth';
import type { SyncProcessors } from '../src/services/sync-push';
import { TEST_APP_URL, TEST_OWNER_URL } from './urls';

/** Snapshot files of this test run, apart from any real server's */
export const snapshotDir = mkdtempSync(join(tmpdir(), 'serva-snapshots-test-'));

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
    DEVICE_RATE_LIMIT_PER_MINUTE: '100000',
    SYNC_PUSH_RATE_LIMIT_PER_MINUTE: '100000',
    ACTIVATE_RATE_LIMIT_PER_MINUTE: '100000',
    ACTIVATE_STORE_LIMIT_PER_HOUR: '100000',
    SNAPSHOT_DIR: snapshotDir,
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

/** Collects the codes the app would send by SMS, so tests can type them. */
export class CapturedCodes implements OtpSender {
  readonly sent: OtpMessage[] = [];

  async send(message: OtpMessage): Promise<void> {
    this.sent.push(message);
  }

  /** The latest code sent to this phone (E.164) */
  last(phone: string): string | undefined {
    return this.sent.filter((m) => m.phone === phone).at(-1)?.code;
  }
}

/** Codes sent by every app built with makeApp() unless a test passes its own sender. */
export const codes = new CapturedCodes();

/**
 * Builds the app against the test database. Time is a ManualClock fixed at a known instant
 * unless a clock is passed, so expiry and trial rules are deterministic.
 */
export function makeApp(
  overrides: Record<string, string> = {},
  options: { clock?: Clock; otpSender?: OtpSender | null; syncProcessors?: SyncProcessors } = {},
): Promise<FastifyInstance> {
  return buildApp({
    env: testEnv(overrides),
    database: appDb(),
    clock: options.clock ?? new ManualClock(),
    otpSender: options.otpSender === undefined ? codes : options.otpSender,
    syncProcessors: options.syncProcessors,
  });
}

/** Reference tables filled by migrations; every other table is emptied between tests. */
const SEEDED_TABLES = new Set(['plans', 'server_state']);

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
    // The one row about the server goes back to a fresh install.
    await sql`update server_state set server_epoch = 1, tombstone_horizon = '0'::xid8`;
  } finally {
    await sql.end();
  }
}

export function storeInput(overrides: Partial<RegisterStoreInput> = {}): RegisterStoreInput {
  return {
    phone: '0912345678',
    fullName: 'أحمد الخطيب',
    password: 'secret-pass-1',
    termsVersion: TERMS_VERSION,
    ...overrides,
  };
}

export function refreshCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE)?.value;
}

/** Opens an account the way a person does: sign-up, then the code that reached the phone. */
export async function registerStore(app: FastifyInstance, overrides: Partial<RegisterStoreInput> = {}) {
  const input = storeInput(overrides);
  const start = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: input });
  if (start.statusCode !== 202) throw new Error(`register failed: ${start.statusCode} ${start.body}`);
  const code = codes.sent.at(-1)?.code;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/register/verify',
    payload: { registrationId: start.json().registrationId, code, password: input.password },
  });
  if (res.statusCode !== 201) throw new Error(`register/verify failed: ${res.statusCode} ${res.body}`);
  return { res, body: res.json(), cookie: refreshCookie(res)! };
}

/**
 * A valid `sale` payload (packages/core › contracts/documents.ts) of `totalMinor` pounds paid in
 * cash, with `extra` fields beside it (unknown keys are kept and ignored by validation).
 */
export function salePayload(totalMinor = 1500, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...buildSalePayload({
      currency: 'SYP',
      taxInclusive: true,
      exchangeRates: [],
      lines: [
        {
          lineNo: 1,
          productId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01',
          variantId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a02',
          name: 'شاي',
          qty: 1000,
          priceCurrency: 'SYP',
          priceMinor: totalMinor,
          taxRateBp: 0,
        },
      ],
      shiftId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a03',
      cashierId: '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a04',
      payments: totalMinor > 0 ? [{ method: 'cash', currency: 'SYP', amountMinor: totalMinor }] : [],
      cashSteps: {},
    }),
    ...extra,
  };
}
