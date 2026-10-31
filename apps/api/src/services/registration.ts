import { sql } from 'drizzle-orm';
import type { RegisterResponse, RegisterStoreData, VerifyRegistrationData } from '@serva/core';
import { uuidv7 } from '@serva/db';
import type { FastifyInstance } from 'fastify';
import { hashOtp, isTestMode, newOtpCode } from '../auth/otp';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { registerStore, type RegisteredStore } from './stores';
import type { SessionPolicy } from './sessions';

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;

interface PendingSignUp {
  fullName: string;
  agentId: string | null;
  termsVersion: string;
}

const codeUnavailable = () =>
  new AppError(503, 'unavailable', 'لا يمكن إرسال رمز التحقق الآن. حاول بعد قليل أو تواصل مع الدعم.');

/**
 * Step 1 of opening an account. Sends a code to the phone and answers the same way whether or not
 * the number already has an account, so sign-up cannot be used to find out who is registered, and
 * an unconfirmed sign-up reserves nothing. No password hashing happens before the phone is proven.
 */
export async function startRegistration(
  app: FastifyInstance,
  data: RegisterStoreData,
  meta: RequestMeta,
): Promise<RegisterResponse> {
  const { db, clock, env, otpSender } = app;
  if (!otpSender) throw codeUnavailable();

  let agentId: string | null = null;
  if (data.agentCode) {
    const [agent] = await db.execute<{ id: string | null }>(
      sql`select agent_find_by_code(${data.agentCode}) as id`,
    );
    agentId = agent?.id ?? null;
    if (!agentId) {
      throw new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', {
        agentCode: 'كود الوكيل غير صحيح. تأكد منه أو اتركه فارغاً.',
      });
    }
  }

  const registrationId = uuidv7();
  const answer: RegisterResponse = { registrationId, expiresIn: CODE_TTL_SECONDS };
  const onScreen = isTestMode(env);
  const code = newOtpCode();
  const existing = await db.execute(sql`select 1 from auth_find_login(${data.phone})`);
  if (existing.length > 0) {
    // Same answer, no code. (Later: tell that phone it already has an account, through the same channel.)
    // In test mode the answer still shows a code, never stored, so verification rejects it.
    return onScreen ? { ...answer, testCode: code } : answer;
  }

  const now = clock.now();
  const payload: PendingSignUp = { fullName: data.fullName, agentId, termsVersion: data.termsVersion };
  await db.execute(sql`select otp_create(
    ${registrationId}::uuid, 'registration', ${data.phone}, ${hashOtp(env.JWT_SECRET, registrationId, code)},
    ${JSON.stringify(payload)}::jsonb, ${new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString()}::timestamptz,
    ${meta.ip}, ${now.toISOString()}::timestamptz)`);
  await otpSender.send({ phone: data.phone, code, purpose: 'registration' });
  return onScreen ? { ...answer, testCode: code } : answer;
}

/**
 * Step 2: the code proves the phone, then the password is hashed and the store created. A wrong
 * code counts an attempt; after five the code is locked and a new one must be requested.
 */
export async function completeRegistration(
  app: FastifyInstance,
  data: VerifyRegistrationData,
  sessionPolicy: SessionPolicy,
  meta: RequestMeta,
): Promise<RegisteredStore> {
  const { db, clock, env, passwords } = app;
  const now = clock.now();
  const [result] = await db.execute<{ status: string; phone: string | null; payload: PendingSignUp | null }>(
    sql`select * from otp_consume(${data.registrationId}::uuid, 'registration',
      ${hashOtp(env.JWT_SECRET, data.registrationId, data.code)}, ${MAX_CODE_ATTEMPTS}, ${now.toISOString()}::timestamptz)`,
  );

  if (result?.status === 'locked') {
    throw new AppError(429, 'locked', 'محاولات خاطئة كثيرة. اطلب رمزاً جديداً.');
  }
  if (result?.status === 'expired') {
    throw new AppError(400, 'otp_invalid', 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.', {
      code: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.',
    });
  }
  if (result?.status !== 'ok' || !result.phone || !result.payload) {
    throw new AppError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.', {
      code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
    });
  }

  const passwordHash = await passwords.hash(data.password);
  return registerStore(
    db,
    { phone: result.phone, ...result.payload },
    passwordHash,
    { sessionPolicy, now },
    meta,
  );
}
