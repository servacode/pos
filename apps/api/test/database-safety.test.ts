import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { appDb, closeAppDb } from './helpers';

const root = fileURLToPath(new URL('../../..', import.meta.url));
afterAll(closeAppDb);

describe('database timeouts', () => {
  it('API connections cap statements, lock waits and idle transactions', async () => {
    const show = async (name: string) => {
      const [row] = await appDb().db.execute<Record<string, string>>(
        sql`select current_setting(${name}) as v`,
      );
      return row?.v;
    };
    expect(await show('statement_timeout')).toBe('15s');
    expect(await show('lock_timeout')).toBe('5s');
    expect(await show('idle_in_transaction_session_timeout')).toBe('30s');
  });

  it('the bootstrap gives the roles the same limits', () => {
    const bootstrap = readFileSync(`${root}/scripts/db-bootstrap.sql`, 'utf8');
    expect(bootstrap).toContain("ALTER ROLE serva_app SET statement_timeout = '15s'");
    expect(bootstrap).toContain("ALTER ROLE serva_app SET idle_in_transaction_session_timeout = '30s'");
    expect(bootstrap).toContain("ALTER ROLE serva_app SET lock_timeout = '5s'");
  });
});

describe('development defaults stay in development', () => {
  const bootstrap = (env: Record<string, string>) =>
    spawnSync('bash', [`${root}/scripts/db-bootstrap.sh`], {
      env: { PATH: process.env.PATH ?? '', SUPERUSER_URL: 'postgres://nobody@127.0.0.1:1/none', ...env },
      encoding: 'utf8',
    });

  it('the bootstrap refuses missing or default passwords in production, before connecting', () => {
    const cases: Record<string, string>[] = [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', SERVA_OWNER_PASSWORD: 'serva_owner', SERVA_APP_PASSWORD: 'Kq8vX2mPz7Lw4Rt9' },
      { SERVA_ENV: 'production', SERVA_OWNER_PASSWORD: 'Kq8vX2mPz7Lw4Rt9', SERVA_APP_PASSWORD: 'short' },
    ];
    for (const env of cases) {
      const run = bootstrap(env);
      expect(run.status, JSON.stringify(env)).toBe(1);
      expect(run.stderr).toMatch(/Refusing to bootstrap/);
    }
  });

  it('docker compose publishes the database on localhost only', () => {
    const compose = readFileSync(`${root}/docker-compose.yml`, 'utf8');
    expect(compose).toContain("'127.0.0.1:5432:5432'");
    expect(compose).not.toMatch(/-\s*'?5432:5432/);
  });
});
