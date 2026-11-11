import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeAppDb, closeOwnerDb, makeApp, ownerDb, registerStore, resetDatabase } from './helpers';

/**
 * deploy/local/pg/cleanup.sql (pnpm local:cleanup): what it deletes and, as important, what it
 * keeps. Run here as the table owner with the psql meta-commands left out.
 */

const CLEANUP_SQL = readFileSync(resolve(__dirname, '../../../deploy/local/pg/cleanup.sql'), 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('\\'))
  .join('\n');

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
  await closeOwnerDb();
});
beforeEach(async () => {
  await resetDatabase();
});

const owner = () => ownerDb();

/** A copy of the store's first session with its own token and the given dates */
async function addSession(label: string, expires: string, absolute: string, revoked = false) {
  await owner().unsafe(
    `insert into sessions (id, tenant_id, user_id, family_id, token_hash, expires_at, absolute_expires_at, revoked_at)
     select gen_random_uuid(), tenant_id, user_id, family_id, $1, ${expires}, ${absolute}, ${revoked ? 'now()' : 'null'}
     from sessions limit 1`,
    [label],
  );
}
const remaining = async () =>
  (await owner()<{ token_hash: string }[]>`select token_hash from sessions order by token_hash`)
    .map((r) => r.token_hash)
    .filter((h) => h.startsWith('t-'));

describe('the cleanup job', () => {
  it('deletes sessions that can never be used again and keeps the rest', async () => {
    await registerStore(app);
    await addSession('t-live', "now() + interval '10 days'", "now() + interval '60 days'");
    await addSession('t-rotated-recent', "now() + interval '10 days'", "now() + interval '60 days'", true);
    await addSession('t-expired-yesterday', "now() - interval '1 day'", "now() + interval '60 days'");
    await addSession('t-expired-long-ago', "now() - interval '8 days'", "now() + interval '60 days'", true);
    await addSession('t-absolute-over-long-ago', "now() + interval '10 days'", "now() - interval '9 days'");
    await owner().unsafe(CLEANUP_SQL);
    expect(await remaining()).toEqual(['t-expired-yesterday', 't-live', 't-rotated-recent']);
    // The store's own live session from registration is untouched
    const [row] = await owner()<
      { n: number }[]
    >`select count(*)::int as n from sessions where token_hash not like 't-%'`;
    expect(row!.n).toBe(1);
  });

  it('removes old sign-up codes and stale counters, and leaves current ones', async () => {
    await owner()`insert into rate_limits (key, count, reset_at) values
      ('old', 1, now() - interval '2 hours'), ('fresh', 1, now() + interval '1 minute')`;
    await owner().unsafe(CLEANUP_SQL);
    const keys = (await owner()<{ key: string }[]>`select key from rate_limits`).map((r) => r.key);
    expect(keys).toEqual(['fresh']);
  });

  it('is safe to run twice', async () => {
    await registerStore(app);
    await owner().unsafe(CLEANUP_SQL);
    await owner().unsafe(CLEANUP_SQL);
    const [row] = await owner()<{ n: number }[]>`select count(*)::int as n from sessions`;
    expect(row!.n).toBe(1);
  });
});
