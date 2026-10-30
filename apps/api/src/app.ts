import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createDb, type DbHandle } from '@serva/db';
import { PasswordHasher } from './auth/passwords';
import { SessionGate } from './auth/session-gate';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { clientAddressing, clientIp } from './http/client-ip';
import { installErrorHandling } from './http/error-handler';
import { loggerOptions, newRequestRef } from './http/logging';
import { postgresRateLimitStore } from './http/rate-limit';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import './types';

export interface BuildAppOptions {
  env: Env;
  /** Pass an existing connection (tests); otherwise one is created from DATABASE_URL and closed with the app */
  database?: DbHandle;
  /** Source of time; tests pass a ManualClock */
  clock?: Clock;
  /** Where logs go (tests capture them); stdout by default */
  logStream?: NodeJS.WritableStream;
}

export async function buildApp({
  env,
  database,
  clock = systemClock,
  logStream,
}: BuildAppOptions): Promise<FastifyInstance> {
  const addressing = clientAddressing(env.TRUST_PROXY);
  const app = Fastify({
    logger: loggerOptions(env.LOG_LEVEL, logStream),
    trustProxy: addressing.trustProxy,
    // Our own short id (the `ref` users see); a client-sent request id is never trusted.
    genReqId: newRequestRef,
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
  });

  const handle = database ?? createDb(env.DATABASE_URL);
  app.decorate('db', handle.db);
  app.decorate('env', env);
  app.decorate('clock', clock);
  app.decorate('addressing', addressing);
  app.decorate(
    'passwords',
    new PasswordHasher({ concurrency: env.PASSWORD_HASH_CONCURRENCY, queue: env.PASSWORD_HASH_QUEUE }),
  );
  app.decorate('sessionGate', new SessionGate(handle.db, clock, env.AUTH_CHECK_CACHE_SECONDS));
  app.decorateRequest('auth', null);
  if (!database) app.addHook('onClose', async () => handle.client.end());

  // JSON only. Fastify also parses text/plain by default, which browsers send cross-site without a
  // CORS preflight; refusing it (415) closes that route to cookie-carrying requests.
  app.removeContentTypeParser('text/plain');

  await app.register(cookie);
  // Every route is limited per client address; routes can set stricter limits (sign-in) or opt out
  // (health). Counters live in Postgres, shared by all instances and kept across restarts.
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: 60_000,
    keyGenerator: clientIp,
    store: postgresRateLimitStore(handle.db, clock),
    errorResponseBuilder: () => ({ statusCode: 429, code: 'rate_limited' }),
  });

  installErrorHandling(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  return app;
}
