import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { loginInput, registerStoreInput, type AuthResponse, type RefreshResponse } from '@serva/core';
import { tenants, users, withTenant } from '@serva/db';
import { hashSecret, verifyAgainstDummy, verifySecret } from '../auth/passwords';
import { signAccessToken } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import { audit } from '../services/audit';
import { createSession, revokeSession, rotateSession, type IssuedSession } from '../services/sessions';
import { registerStore } from '../services/stores';
import type { RequestMeta } from '../types';
import { parseBody } from './validation';

export const REFRESH_COOKIE = 'serva_rt';
const COOKIE_PATH = '/v1/auth';

const metaOf = (request: FastifyRequest): RequestMeta => ({
  ip: request.ip,
  userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { env, db, clock } = app;
  const authLimit = { rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } };

  const setRefreshCookie = (reply: FastifyReply, session: IssuedSession) =>
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: session.expiresAt,
    });
  const clearRefreshCookie = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
    });
  const accessTokenFor = (session: IssuedSession) =>
    signAccessToken(
      { userId: session.userId, tenantId: session.tenantId, sessionId: session.sessionId },
      env.JWT_SECRET,
      env.ACCESS_TOKEN_TTL_SECONDS,
      clock.now(),
    );

  app.post('/v1/auth/register', { config: authLimit }, async (request, reply) => {
    const data = parseBody(registerStoreInput, request.body);
    const passwordHash = await hashSecret(data.password);
    const result = await registerStore(
      db,
      data,
      passwordHash,
      { refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS, now: clock.now() },
      metaOf(request),
    );
    setRefreshCookie(reply, result.session);
    const body: AuthResponse = {
      accessToken: await accessTokenFor(result.session),
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      user: result.user,
      tenant: result.tenant,
    };
    return reply.status(201).send(body);
  });

  app.post('/v1/auth/login', { config: authLimit }, async (request, reply) => {
    const data = parseBody(loginInput, request.body);
    const invalid = new AppError(401, 'invalid_credentials', 'رقم الجوال أو كلمة المرور غير صحيحة.');

    const rows = await db.execute<{
      user_id: string;
      tenant_id: string;
      password_hash: string;
      status: 'active' | 'disabled';
      full_name: string;
    }>(sql`select * from auth_find_login(${data.phone})`);
    const account = rows[0];
    if (!account) {
      await verifyAgainstDummy(data.password);
      throw invalid;
    }
    const passwordOk = await verifySecret(account.password_hash, data.password);
    if (!passwordOk || account.status !== 'active') throw invalid;

    const meta = metaOf(request);
    const now = clock.now();
    const { session, tenantName } = await withTenant(db, account.tenant_id, async (tx) => {
      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, account.user_id));
      const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
      const session = await createSession(
        tx,
        { tenantId: account.tenant_id, userId: account.user_id, ttlDays: env.REFRESH_TOKEN_TTL_DAYS, now },
        meta,
      );
      await audit(tx, { tenantId: account.tenant_id, userId: account.user_id, action: 'user.login' }, meta);
      return { session, tenantName: tenant?.name ?? '' };
    });

    setRefreshCookie(reply, session);
    const body: AuthResponse = {
      accessToken: await accessTokenFor(session),
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      user: { id: account.user_id, fullName: account.full_name, phone: data.phone },
      tenant: { id: account.tenant_id, name: tenantName },
    };
    return reply.send(body);
  });

  app.post(
    '/v1/auth/refresh',
    { config: { rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MINUTE * 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw unauthorized();
      const session = await rotateSession(
        db,
        token,
        env.REFRESH_TOKEN_TTL_DAYS,
        clock.now(),
        metaOf(request),
      );
      if (!session) {
        clearRefreshCookie(reply);
        throw unauthorized();
      }
      setRefreshCookie(reply, session);
      const body: RefreshResponse = {
        accessToken: await accessTokenFor(session),
        expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
      };
      return reply.send(body);
    },
  );

  app.post('/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) await revokeSession(db, token, clock.now());
    clearRefreshCookie(reply);
    return reply.status(204).send();
  });
}
