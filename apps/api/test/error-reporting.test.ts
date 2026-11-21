import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { ManualClock } from '../src/clock';
import { AppError } from '../src/errors';
import { buildEvent, createReporter, scrubText } from '../src/http/error-reporting';
import { appDb, closeAppDb, resetDatabase, testEnv } from './helpers';

/**
 * Optional Sentry-protocol reporting (SENTRY_DSN). What matters is what can leave the server: the
 * event is checked against a real HTTP endpoint standing in for GlitchTip, with SQL, parameters,
 * phone numbers, tokens and headers planted in the failing request.
 */

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2VjcmV0c2FsdA$c2VjcmV0aGFzaHZhbHVl';
const PHONE = '+963955555555';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';

let tracker: Server;
let dsn: string;
const received: { path: string | undefined; auth: unknown; body: string }[] = [];
const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

let app: FastifyInstance;

beforeAll(async () => {
  tracker = createServer(async (req, res) => {
    received.push({ path: req.url, auth: req.headers['x-sentry-auth'], body: await readBody(req) });
    res.writeHead(200).end('{}');
  });
  await new Promise<void>((resolve) => tracker.listen(0, '127.0.0.1', resolve));
  dsn = `http://publickey123@127.0.0.1:${(tracker.address() as AddressInfo).port}/7`;

  app = await buildApp({
    env: testEnv({ SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'test-env', SENTRY_RELEASE: 'abc123' }),
    database: appDb(),
    clock: new ManualClock(),
  });
  app.get('/__probe/query-error/:id', async () => {
    await app.db.execute(sql`select ${FAKE_HASH}::int, ${PHONE}::uuid`);
  });
  app.get('/__probe/app-error', async () => {
    throw new AppError(500, 'internal', `could not reach ${PHONE}`);
  });
  app.get('/__probe/client-error', async () => {
    throw new AppError(409, 'conflict', 'nope');
  });
  app.get('/__probe/message', async () => {
    throw new Error(
      `failed for ${PHONE} user a@b.sy token ${TOKEN} select * from users where phone = '${PHONE}'`,
    );
  });
});
afterAll(async () => {
  await app.close();
  await new Promise((resolve) => tracker.close(resolve));
  await closeAppDb();
});
beforeEach(async () => {
  received.length = 0;
  await resetDatabase();
});

interface ReportedEvent {
  environment: string;
  release: string;
  tags: Record<string, string>;
  exception: { values: { stacktrace: { frames: unknown[] } }[] };
}
const events = () =>
  received.map((r) => {
    const lines = r.body.split('\n');
    return JSON.parse(lines[2]!) as ReportedEvent;
  });
const flush = () => app.reporter.flush(3_000);

describe('server errors reach the tracker', () => {
  it('sends an envelope to the project with the key, and tags the request ref and route pattern', async () => {
    const res = await app.inject({ method: 'GET', url: '/__probe/app-error' });
    expect(res.statusCode).toBe(500);
    await flush();
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe('/api/7/envelope/');
    expect(String(received[0]!.auth)).toContain('sentry_key=publickey123');
    const [event] = events();
    expect(event!.environment).toBe('test-env');
    expect(event!.release).toBe('abc123');
    expect(event!.tags.ref).toBe(res.json().error.ref);
    expect(event!.tags.route).toBe('/__probe/app-error');
    expect(event!.tags.status).toBe('500');
    expect(event!.exception.values[0]!.stacktrace.frames.length).toBeGreaterThan(0);
  });

  it('does not report client errors (4xx) nor 404s', async () => {
    await app.inject({ method: 'GET', url: '/__probe/client-error' });
    await app.inject({ method: 'GET', url: '/nothing-here' });
    await flush();
    expect(received).toHaveLength(0);
  });

  it('reports the route pattern, not the URL with its ids', async () => {
    await app.inject({ method: 'GET', url: '/__probe/query-error/secret-id-12345?phone=0933000000' });
    await flush();
    const body = received[0]!.body;
    expect(events()[0]!.tags.route).toBe('/__probe/query-error/:id');
    expect(body).not.toContain('secret-id-12345');
    expect(body).not.toContain('0933000000');
  });
});

describe('nothing private reaches the event', () => {
  it('a failing query is sent with its SQLSTATE but without statement, parameters or values', async () => {
    await app.inject({
      method: 'GET',
      url: '/__probe/query-error/1',
      headers: { authorization: TOKEN, cookie: 'serva_rt=refresh-secret', 'x-forwarded-for': '10.9.8.7' },
    });
    await flush();
    const body = received[0]!.body;
    expect(body).toContain('22P02');
    for (const secret of [FAKE_HASH, 'c2VjcmV0', PHONE, 'select', 'refresh-secret', 'eyJhbGci', '10.9.8.7']) {
      expect(body.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('personal data inside an error message is masked', async () => {
    await app.inject({ method: 'GET', url: '/__probe/message' });
    await flush();
    const body = received[0]!.body;
    expect(body).not.toContain(PHONE);
    expect(body).not.toContain('963955555555');
    expect(body).not.toContain('a@b.sy');
    expect(body).not.toContain('eyJhbGci');
    expect(body).toContain('[sql withheld]');
  });

  it('the event holds no request headers, body, query, cookies, user or breadcrumbs', async () => {
    await app.inject({
      method: 'POST',
      url: '/__probe/none',
      headers: { cookie: 'a=b', authorization: TOKEN },
      payload: { password: 'secret-pass-1' },
    });
    const event = buildEvent(
      new Error('x'),
      { route: '/v1/a/:id', method: 'POST', status: 500, ref: 'R1' },
      {},
    );
    expect(Object.keys(event).sort()).toEqual(
      ['event_id', 'exception', 'level', 'logger', 'platform', 'request', 'tags', 'timestamp'].sort(),
    );
    expect(Object.keys(event.request as object).sort()).toEqual(['method', 'url']);
  });

  it('scrubText masks emails, numbers, tokens, long secrets and SQL', () => {
    expect(scrubText('mail a@b.sy phone +963 933 123 456 key abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'mail [email] phone [number] key [secret]',
    );
    expect(scrubText('UPDATE users SET password = 1')).toBe('[sql withheld]');
    expect(scrubText('connect ECONNREFUSED db:5432')).toBe('connect ECONNREFUSED db:5432');
  });
});

describe('the reporter is safe to leave on', () => {
  it('is off without SENTRY_DSN', async () => {
    const plain = await buildApp({ env: testEnv(), database: appDb(), clock: new ManualClock() });
    plain.get('/__probe/boom', async () => {
      throw new Error('boom');
    });
    expect((await plain.inject({ method: 'GET', url: '/__probe/boom' })).statusCode).toBe(500);
    await plain.reporter.flush();
    await plain.close();
    expect(received).toHaveLength(0);
  });

  it('a tracker that is down never changes the response', async () => {
    const down = await buildApp({
      env: testEnv({ SENTRY_DSN: 'http://k@127.0.0.1:9/1' }),
      database: appDb(),
      clock: new ManualClock(),
    });
    down.get('/__probe/boom', async () => {
      throw new Error('boom');
    });
    const res = await down.inject({ method: 'GET', url: '/__probe/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('internal');
    await down.close();
  });

  it('sends at most 30 reports a minute', async () => {
    let now = 1_000_000;
    let sent = 0;
    const reporter = createReporter(
      { dsn },
      { warn() {} } as never,
      (async () => {
        sent++;
        return new Response('{}');
      }) as typeof fetch,
      () => now,
    );
    for (let i = 0; i < 100; i++) reporter.captureException(new Error('x'));
    await reporter.flush();
    expect(sent).toBe(30);
    now += 61_000;
    reporter.captureException(new Error('x'));
    await reporter.flush();
    expect(sent).toBe(31);
  });

  it('rejects a DSN without a key or a project', () => {
    const log = { warn() {} } as never;
    expect(() => createReporter({ dsn: 'http://127.0.0.1/1' }, log)).toThrow(/public key/);
    expect(() => createReporter({ dsn: 'http://k@127.0.0.1/' }, log)).toThrow(/project/);
  });

  it('must be https from the cloud in production', () => {
    const production = (extra: Record<string, string>) =>
      testEnv({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        DATABASE_URL: 'postgres://serva_app:Kq8vX2mPz7Lw4Rt9@db:5432/serva',
        JWT_SECRET: 'Zr4x9Qw2Lp8Vt6Nb3Hc7Jd1Kf5Gm0Sa-Yq7u2Pe9Ko4Ri1Tw6',
        ...extra,
      });
    expect(() => production({ SENTRY_DSN: 'http://k@glitch.example/1' })).toThrow(/must be https/);
    expect(production({ SENTRY_DSN: 'https://k@glitch.example/1' }).SENTRY_DSN).toBeDefined();
    expect(
      production({ SENTRY_DSN: 'http://k@192.168.1.5/1', DEPLOYMENT: 'local' }).SENTRY_DSN,
    ).toBeDefined();
    expect(production({ SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
  });
});
