import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createDb, type DbHandle } from '@serva/db';
import type { ApiErrorBody } from '@serva/core';
import { PasswordHasher } from './auth/passwords';
import { SessionGate } from './auth/session-gate';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { AppError } from './errors';
import { clientAddressing, clientIp } from './http/client-ip';
import { postgresRateLimitStore, RATE_LIMITED_MESSAGE } from './http/rate-limit';
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
}

const errorBody = (code: ApiErrorBody['error']['code'], message: string): ApiErrorBody => ({
  error: { code, message },
});

export async function buildApp({
  env,
  database,
  clock = systemClock,
}: BuildAppOptions): Promise<FastifyInstance> {
  const addressing = clientAddressing(env.TRUST_PROXY);
  const app = Fastify({
    logger: env.LOG_LEVEL === 'silent' ? false : { level: env.LOG_LEVEL },
    trustProxy: addressing.trustProxy,
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

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send(error.toBody());
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send(errorBody('rate_limited', RATE_LIMITED_MESSAGE));
    }
    if (status >= 400 && status < 500) {
      return reply.status(400).send(errorBody('validation_failed', 'الطلب غير صالح.'));
    }
    request.log.error(error);
    return reply.status(500).send(errorBody('internal', 'حدث خطأ غير متوقع. حاول مجدداً بعد قليل.'));
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send(errorBody('not_found', 'غير موجود.')));

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  return app;
}
