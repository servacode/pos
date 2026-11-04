import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ForgotPasswordResponse, ResetPasswordData } from '@serva/core';
import { sessions, users, uuidv7, withTenant } from '@serva/db';
import type { FastifyInstance } from 'fastify';
import { hashOtp, isTestMode, newOtpCode, OtpDeliveryError } from '../auth/otp';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;

const codeUnavailable = () =>
  new AppError(503, 'unavailable', 'لا يمكن إرسال رمز التحقق الآن. حاول بعد قليل أو تواصل مع الدعم.');

/**
 * «نسيت كلمة السر», step 1: sends a code to the phone of an account. Answers the same way whether
 * or not the number has an account (sign-up does the same), so it reveals nobody.
 */
export async function startPasswordReset(
  app: FastifyInstance,
  phone: string,
  meta: RequestMeta,
): Promise<ForgotPasswordResponse> {
  const { db, clock, env, otpSender } = app;
  if (!otpSender) throw codeUnavailable();

  const resetId = uuidv7();
  const answer: ForgotPasswordResponse = { resetId, expiresIn: CODE_TTL_SECONDS };
  const onScreen = isTestMode(env);
  const code = newOtpCode();
  const found = await db.execute(sql`select 1 from auth_find_login(${phone})`);
  if (found.length === 0) {
    // Same answer, nothing stored: the code shown in test mode is refused at step 2.
    return onScreen ? { ...answer, testCode: code } : answer;
  }

  const now = clock.now();
  await db.execute(sql`select otp_create(
    ${resetId}::uuid, 'password_reset', ${phone}, ${hashOtp(env.JWT_SECRET, resetId, code)},
    '{}'::jsonb, ${new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString()}::timestamptz,
    ${meta.ip}, ${now.toISOString()}::timestamptz)`);
  try {
    await otpSender.send({ phone, code, purpose: 'password_reset' });
  } catch (error) {
    if (error instanceof OtpDeliveryError) throw codeUnavailable();
    throw error;
  }
  return onScreen ? { ...answer, testCode: code } : answer;
}

/**
 * Step 2: the code proves the phone; the password is replaced and every session of the account is
 * ended, so whoever knew the old password is signed out everywhere. Returns the ended session
 * (family) ids, for the session gate.
 */
export async function completePasswordReset(
  app: FastifyInstance,
  data: ResetPasswordData,
  meta: RequestMeta,
): Promise<string[]> {
  const { db, clock, env, passwords } = app;
  const now = clock.now();
  const [result] = await db.execute<{ status: string; phone: string | null }>(
    sql`select status, phone from otp_consume(${data.resetId}::uuid, 'password_reset',
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
  const invalid = () =>
    new AppError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.', {
      code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
    });
  if (result?.status !== 'ok' || !result.phone) throw invalid();

  const [account] = await db.execute<{ user_id: string; tenant_id: string }>(
    sql`select user_id, tenant_id from auth_find_login(${result.phone})`,
  );
  if (!account) throw invalid();

  const passwordHash = await passwords.hash(data.password);
  return withTenant(db, account.tenant_id, async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, account.user_id));
    const ended = await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, account.user_id), isNull(sessions.revokedAt)))
      .returning({ familyId: sessions.familyId });
    await audit(
      tx,
      {
        tenantId: account.tenant_id,
        userId: account.user_id,
        action: 'user.password_reset',
        data: { sessionsEnded: new Set(ended.map((s) => s.familyId)).size },
      },
      meta,
    );
    return [...new Set(ended.map((s) => s.familyId))];
  });
}
