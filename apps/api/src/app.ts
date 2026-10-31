import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createDb, type DbHandle } from '@serva/db';
import { otpSenderFor, type OtpSender } from './auth/otp';
import { PasswordHasher } from './auth/passwords';
import { SessionGate } from './auth/session-gate';
import { TokenKeys } from './auth/tokens';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { clientAddressing, clientIp } from './http/client-ip';
import { installErrorHandling } from './http/error-handler';
import { loggerOptions, newRequestRef } from './http/logging';
import { postgresRateLimitStore } from './http/rate-limit';
import { installSecurityHeaders } from './http/security-headers';
import { installTestMode } from './http/test-mode';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { deviceRoutes } from './routes/devices';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { reportRoutes } from './routes/reports';
import { staffRoutes } from './routes/staff';
import { syncRoutes } from './routes/sync';
import { DOCUMENT_PROCESSORS } from './services/processors';
import type { SyncProcessors } from './services/sync-push';
import './types';

export interface BuildAppOptions {
  env: Env;
  /** Pass an existing connection (tests); otherwise one is created from DATABASE_URL and closed with the app */
  database?: DbHandle;
  /** Source of time; tests pass a ManualClock */
  clock?: Clock;
  /** Where logs go (tests capture them); stdout by default */
  logStream?: NodeJS.WritableStream;
  /** Delivers sign-up codes; by default from OTP_DELIVERY */
  otpSender?: OtpSender | null;
  /** What the server does with each synced document type; the phase-1 processors by default */
  syncProcessors?: SyncProcessors;
}

export async function buildApp({
  env,
  database,
  clock = systemClock,
  logStream,
  otpSender,
  syncProcessors = DOCUMENT_PROCESSORS,
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
  app.decorate('tokenKeys', new TokenKeys(env.JWT_SECRET, env.JWT_PREVIOUS_SECRETS));
  app.decorate('otpSender', otpSender !== undefined ? otpSender : otpSenderFor(env, app.log));
  app.decorate('sessionGate', new SessionGate(handle.db, clock, env.AUTH_CHECK_CACHE_SECONDS));
  app.decorateRequest('auth', null);
  app.decorateRequest('device', null);
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

  // "METHOD /url" of every route, for the route registry test (IDOR probes, auth classification).
  const routeList: string[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat())
      if (method !== 'HEAD') routeList.push(`${method} ${route.url}`);
  });
  app.decorate('routeList', routeList);

  installSecurityHeaders(app, { https: env.COOKIE_SECURE });
  installTestMode(app);
  installErrorHandling(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(syncRoutes(syncProcessors));
  await app.register(deviceRoutes);
  await app.register(catalogRoutes);
  await app.register(staffRoutes);
  await app.register(reportRoutes);
  return app;
}
