import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ForgotPasswordResponse } from '@serva/core';
import { sessions, tenants, users, uuidv7, withTenant } from '@serva/db';
import type { FastifyInstance } from 'fastify';
import { hashOtp, isTestMode, newOtpCode } from '../auth/otp';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { createSession, type IssuedSession, type SessionPolicy } from './sessions';

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;

const codeUnavailable = () =>
  new AppError(503, 'unavailable', 'لا يمكن إرسال رمز التحقق الآن. حاول بعد قليل أو تواصل مع الدعم.');
const invalidCode = () =>
  new AppError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.', {
    code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
  });

type Found = {
  user_id: string;
  tenant_id: string;
  status: 'active' | 'disabled';
  tenant_status: 'active' | 'suspended';
  full_name: string;
};

/** The account behind a phone that can sign in with a password (staff with only a PIN have none). */
const findLogin = (app: FastifyInstance, phone: string) =>
  app.db.execute<Found>(sql`select * from auth_find_login(${phone})`).then((rows) => rows[0]);

/**
 * Step 1 of «نسيت كلمة السر». The answer is the same for every number: a challenge id and, when the
 * phone belongs to an active account that signs in with a password, a code sent to it. For any other
 * number (unknown, paused, PIN-only) a decoy challenge is stored the same way, so neither the answer
 * nor the work done tells them apart; the decoy can never be completed.
 */
export async function startPasswordReset(
  app: FastifyInstance,
  data: { phone: string },
  meta: RequestMeta,
): Promise<ForgotPasswordResponse> {
  const { db, clock, env, otpSender, log } = app;
  if (!otpSender) throw codeUnavailable();

  const resetId = uuidv7();
  const code = newOtpCode();
  const account = await findLogin(app, data.phone);
  const real = account?.status === 'active';
  const now = clock.now();
  await db.execute(sql`select otp_create(
    ${resetId}::uuid, 'password_reset', ${data.phone}, ${hashOtp(env.JWT_SECRET, resetId, code)},
    ${JSON.stringify({ decoy: !real })}::jsonb,
    ${new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString()}::timestamptz,
    ${meta.ip}, ${now.toISOString()}::timestamptz)`);
  if (real) {
    // Not awaited: a slow or failing gateway must not make a real number answer differently.
    void otpSender.send({ phone: data.phone, code, purpose: 'password_reset' }).catch((error: unknown) => {
      log.warn({ err: (error as Error).name }, 'password reset code was not delivered');
    });
  }
  const answer: ForgotPasswordResponse = { resetId, expiresIn: CODE_TTL_SECONDS };
  return isTestMode(env) ? { ...answer, testCode: code } : answer;
}

export interface ResetResult {
  session: IssuedSession;
  user: { id: string; fullName: string; phone: string };
  tenant: { id: string; name: string };
}

/**
 * Step 2: the code (single use, five tries, ten minutes) proves the phone; the new password is
 * hashed, every session of that person ends (refresh tokens revoked, this server's cached answers
 * dropped) and a fresh session is opened on this device.
 */
export async function completePasswordReset(
  app: FastifyInstance,
  data: { resetId: string; code: string; password: string },
  sessionPolicy: SessionPolicy,
  meta: RequestMeta,
): Promise<ResetResult> {
  const { db, clock, env, passwords, sessionGate } = app;
  const now = clock.now();
  const [result] = await db.execute<{
    status: string;
    phone: string | null;
    payload: { decoy?: boolean } | null;
  }>(
    sql`select * from otp_consume(${data.resetId}::uuid, 'password_reset',
      ${hashOtp(env.JWT_SECRET, data.resetId, data.code)}, ${MAX_CODE_ATTEMPTS}, ${now.toISOString()}::timestamptz)`,
  );
  if (result?.status === 'locked') {
    throw new AppError(429, 'locked', 'محاولات خاطئة كثيرة. اطلب رمزاً جديداً.');
  }
  if (result?.status === 'expired') {
    throw new AppError(400, 'otp_invalid', 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.', {
      code: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.',
    });
  }
  if (result?.status !== 'ok' || !result.phone || result.payload?.decoy) throw invalidCode();

  // The account is looked up again: it may have been paused since the code was sent.
  const account = await findLogin(app, result.phone);
  if (!account || account.status !== 'active') throw invalidCode();

  const passwordHash = await passwords.hash(data.password);
  const done = await withTenant(db, account.tenant_id, async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, account.user_id));
    const ended = await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, account.user_id), isNull(sessions.revokedAt)))
      .returning({ familyId: sessions.familyId });
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).limit(1);
    await audit(
      tx,
      { tenantId: account.tenant_id, userId: account.user_id, action: 'user.password_reset' },
      meta,
    );
    // A suspended store is told so (as at sign-in) and opens no session.
    const session =
      account.tenant_status === 'active'
        ? await createSession(
            tx,
            { tenantId: account.tenant_id, userId: account.user_id, now, policy: sessionPolicy },
            meta,
          )
        : null;
    return { ended: ended.map((s) => s.familyId), session, tenantName: tenant?.name ?? '' };
  });
  for (const family of new Set(done.ended)) sessionGate.forget(family);
  if (!done.session)
    throw new AppError(403, 'forbidden', 'تم تغيير كلمة السر، لكن هذا المتجر موقوف. تواصل مع الدعم.');
  return {
    session: done.session,
    user: { id: account.user_id, fullName: account.full_name, phone: result.phone },
    tenant: { id: account.tenant_id, name: done.tenantName },
  };
}
