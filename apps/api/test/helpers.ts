import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { createDb, type DbHandle } from '@serva/db';
import type { RegisterStoreInput } from '@serva/core';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/env';
import { REFRESH_COOKIE } from '../src/routes/auth';
import { TEST_APP_URL, TEST_OWNER_URL } from './urls';

export function testEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_APP_URL,
    JWT_SECRET: 'test-secret-that-is-definitely-long-enough-123',
    LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
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

export function makeApp(overrides: Record<string, string> = {}): Promise<FastifyInstance> {
  return buildApp({ env: testEnv(overrides), database: appDb() });
}

/** Empties every table except plans, as the owner role. */
export async function resetDatabase(): Promise<void> {
  const owner = postgres(TEST_OWNER_URL, { max: 1, onnotice: () => {} });
  try {
    await owner`truncate table sessions, audit_logs, user_roles, users, roles, registers, branches,
      subscriptions, tenant_settings, tenants, platform_users restart identity cascade`;
  } finally {
    await owner.end();
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
