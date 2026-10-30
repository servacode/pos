import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createDb, type DbHandle } from '@serva/db';
import type { ApiErrorBody } from '@serva/core';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { AppError } from './errors';
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
  const app = Fastify({
    logger: env.LOG_LEVEL === 'silent' ? false : { level: env.LOG_LEVEL },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  const handle = database ?? createDb(env.DATABASE_URL);
  app.decorate('db', handle.db);
  app.decorate('env', env);
  app.decorate('clock', clock);
  app.decorateRequest('auth', null);
  if (!database) app.addHook('onClose', async () => handle.client.end());

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ statusCode: 429, code: 'rate_limited' }),
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send(error.toBody());
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send(errorBody('rate_limited', 'محاولات كثيرة. انتظر دقيقة ثم حاول مجدداً.'));
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
