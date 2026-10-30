import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { ManualClock } from '../src/clock';
import { serializeError } from '../src/http/logging';
import { appDb, closeAppDb, resetDatabase, testEnv } from './helpers';

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2VjcmV0c2FsdA$c2VjcmV0aGFzaHZhbHVl';
const PHONE = '+963955555555';

let app: FastifyInstance;
const lines: string[] = [];

beforeAll(async () => {
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  app = await buildApp({
    env: testEnv({ LOG_LEVEL: 'info' }),
    database: appDb(),
    clock: new ManualClock(),
    logStream: stream,
  });
  // Probe routes, registered only in this test app.
  app.get('/__probe/query-error', async () => {
    await app.db.execute(sql`select ${FAKE_HASH}::int, ${PHONE}::uuid`);
  });
  app.get('/__probe/headers', async (request) => {
    request.log.info(
      { headers: request.headers, body: { password: 'secret-pass-1', token: 'tok' } },
      'probe',
    );
    return { ok: true };
  });
  app.get('/__probe/method', async () => {
    throw Object.assign(new Error('no'), { statusCode: 405 });
  });
});
afterAll(async () => {
  await app.close();
  await closeAppDb();
});
beforeEach(async () => {
  lines.length = 0;
  await resetDatabase();
});

describe('logs never carry secrets or personal data', () => {
  it('a failing query logs its SQLSTATE but not its parameters', async () => {
    const res = await app.inject({ method: 'GET', url: '/__probe/query-error' });
    expect(res.statusCode).toBe(500);

    const log = lines.join('\n');
    expect(log).toContain('22P02'); // invalid_text_representation, from the database error
    expect(log).not.toContain(FAKE_HASH);
    expect(log).not.toContain('c2VjcmV0');
    expect(log).not.toContain(PHONE);
  });

  it('redacts authorization, cookies, passwords and tokens', async () => {
    await app.inject({
      method: 'GET',
      url: '/__probe/headers',
      headers: { authorization: 'Bearer eyJ.secret.token', cookie: 'serva_rt=refresh-secret' },
    });
    const log = lines.join('\n');
    expect(log).toContain('probe');
    expect(log).not.toContain('eyJ.secret.token');
    expect(log).not.toContain('refresh-secret');
    expect(log).not.toContain('secret-pass-1');
    expect(log).toContain('[redacted]');
  });

  it('serializeError drops query text, parameters and database detail', () => {
    const cause = Object.assign(
      new Error('duplicate key value violates unique constraint "users_phone_unique"'),
      {
        code: '23505',
        constraint_name: 'users_phone_unique',
        detail: `Key (phone)=(${PHONE}) already exists.`,
      },
    );
    const error = Object.assign(
      new Error(`Failed query: insert into users values ($1)\nparams: ${PHONE},${FAKE_HASH}`),
      {
        params: [PHONE, FAKE_HASH],
        cause,
      },
    );
    const out = JSON.stringify(serializeError(error));
    expect(out).not.toContain(PHONE);
    expect(out).not.toContain(FAKE_HASH);
    expect(out).not.toContain('insert into users');
    expect(out).toContain('23505');
    expect(out).toContain('users_phone_unique');
  });
});

describe('error answers', () => {
  it('carry ref, the same id as the request in the logs and the x-request-id header', async () => {
    const res = await app.inject({ method: 'GET', url: '/__probe/query-error' });
    const { ref, code } = res.json().error;
    expect(code).toBe('internal');
    expect(ref).toMatch(/^[0-9A-Z]{10}$/);
    expect(res.headers['x-request-id']).toBe(ref);
    expect(lines.some((l) => l.includes(`"reqId":"${ref}"`))).toBe(true);
  });

  it('ignore a request id sent by the client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/nowhere',
      headers: { 'request-id': 'chosen-by-client' },
    });
    expect(res.json().error.ref).not.toBe('chosen-by-client');
  });

  it('keep 413 for a body over the limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ phone: '0912345678', password: 'x'.repeat(1_100_000) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('payload_too_large');
  });

  it('keep 415 for a content type the API does not accept', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'phone=0912345678',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('unsupported_media_type');
  });

  it('keep 405 and 404, and 400 for malformed JSON', async () => {
    expect((await app.inject({ method: 'GET', url: '/__probe/method' })).json().error.code).toBe(
      'method_not_allowed',
    );
    const missing = await app.inject({ method: 'GET', url: '/nowhere' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('not_found');

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"phone":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('validation_failed');
  });
});
