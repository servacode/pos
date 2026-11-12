import { sql } from 'drizzle-orm';
import type {
  PlatformEnrolDone,
  PlatformEnrolStart,
  PlatformLoginResponse,
  PlatformLoginResult,
  PlatformTwoFactorStatus,
} from '@serva/core';
import type { FastifyInstance } from 'fastify';
import { signLoginTicket, verifyLoginTicket, type LoginTicket } from '../auth/platform-ticket';
import {
  groupKey,
  hashRecoveryCode,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  SecretBox,
} from '../auth/totp';
import { PLATFORM_TOKEN_TTL_SECONDS, signPlatformToken, type PlatformClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';

/**
 * Two-factor sign-in of the platform team. A password alone opens the panel only for a member who
 * has not enrolled and while PLATFORM_REQUIRE_2FA is off; otherwise sign-in goes through steps, each
 * proven by a short-lived ticket (auth/platform-ticket.ts): the authenticator (or recovery) code,
 * a new password when the bootstrap one is still in use, and enrolment when it is required.
 */

const ISSUER = 'Serva Platform';

type Security = {
  id: string;
  full_name: string;
  password_hash: string;
  role: PlatformClaims['role'];
  status: 'active' | 'disabled';
  totp_secret_enc: string | null;
  totp_enabled: boolean;
  recovery_left: number;
  must_change_password: boolean;
};

export const platformRequires2fa = (env: FastifyInstance['env']): boolean =>
  env.PLATFORM_REQUIRE_2FA ?? env.NODE_ENV === 'production';

const box = (app: FastifyInstance) => new SecretBox(app.env.JWT_SECRET, app.env.JWT_PREVIOUS_SECRETS);
const signInFailed = () => new AppError(401, 'invalid_credentials', 'البريد أو كلمة السر غير صحيحة.');
const wrongCode = () =>
  new AppError(400, 'otp_invalid', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.', {
    code: 'الرمز غير صحيح. تأكد منه وأعد المحاولة.',
  });

async function security(app: FastifyInstance, id: string): Promise<Security | undefined> {
  const [row] = await app.db.execute<Security>(sql`select * from platform_user_security(${id}::uuid)`);
  return row && row.status === 'active' ? row : undefined;
}

async function fullLogin(app: FastifyInstance, user: Security, now: Date): Promise<PlatformLoginResponse> {
  const token = await signPlatformToken({ platformUserId: user.id, role: user.role }, app.tokenKeys, now);
  return {
    token,
    expiresAt: new Date(now.getTime() + PLATFORM_TOKEN_TTL_SECONDS * 1000).toISOString(),
    user: { id: user.id, fullName: user.full_name, role: user.role },
  };
}

/** What is left to do after the password (and whatever was already done in this sign-in). */
async function nextStep(
  app: FastifyInstance,
  user: Security,
  codePassed: boolean,
  now: Date,
): Promise<PlatformLoginResult> {
  const step = (name: 'code' | 'password' | 'enrol') =>
    signLoginTicket({ platformUserId: user.id, step: name, codePassed }, app.tokenKeys, now).then(
      (ticket) => ({ step: name, ticket }) as const,
    );
  if (user.totp_enabled && !codePassed) return step('code');
  if (user.must_change_password) return step('password');
  if (!user.totp_enabled && platformRequires2fa(app.env)) return step('enrol');
  return fullLogin(app, user, now);
}

/** Step 0: email and password. */
export async function platformSignIn(
  app: FastifyInstance,
  input: { email: string; password: string },
  now: Date,
): Promise<PlatformLoginResult> {
  const { db, passwords } = app;
  const [found] = await db.execute<{ id: string; password_hash: string; status: 'active' | 'disabled' }>(
    sql`select id, password_hash, status from platform_user_for_login(${input.email})`,
  );
  if (!found || found.status !== 'active') {
    await passwords.verifyAgainstDummy(input.password);
    throw signInFailed();
  }
  if (!(await passwords.verify(found.password_hash, input.password))) throw signInFailed();
  const user = await security(app, found.id);
  if (!user) throw signInFailed();
  return nextStep(app, user, false, now);
}

/** A ticket for the given step, or 401. */
export async function ticketFor(
  app: FastifyInstance,
  token: string,
  step: LoginTicket['step'],
  now: Date,
): Promise<{ ticket: LoginTicket; user: Security }> {
  const ticket = await verifyLoginTicket(token, app.tokenKeys, now);
  if (!ticket || ticket.step !== step) throw unauthorized();
  const user = await security(app, ticket.platformUserId);
  if (!user) throw unauthorized();
  return { ticket, user };
}

/**
 * Checks an authenticator code (once per 30-second step, within one step either side) or a
 * recovery code (once ever). Callers rate-limit before calling.
 */
export async function checkSecondFactor(
  app: FastifyInstance,
  user: Security,
  code: string,
  now: Date,
): Promise<boolean> {
  if (!user.totp_enabled || !user.totp_secret_enc) return false;
  if (/^\d{6}$/.test(code)) {
    const secret = box(app).open(user.totp_secret_enc);
    if (!secret) return false;
    const step = matchTotp(secret, code, now);
    if (step === null) return false;
    const [spent] = await app.db.execute<{ ok: boolean }>(
      sql`select platform_totp_spend(${user.id}::uuid, ${step}::bigint) as ok`,
    );
    return spent?.ok === true;
  }
  const [used] = await app.db.execute<{ ok: boolean }>(
    sql`select platform_recovery_spend(${user.id}::uuid, ${hashRecoveryCode(code)}) as ok`,
  );
  return used?.ok === true;
}

export async function loginWithCode(
  app: FastifyInstance,
  ticketToken: string,
  code: string,
  now: Date,
): Promise<PlatformLoginResult> {
  const { user } = await ticketFor(app, ticketToken, 'code', now);
  if (!(await checkSecondFactor(app, user, code, now))) throw wrongCode();
  return nextStep(app, (await security(app, user.id)) ?? user, true, now);
}

export async function loginWithNewPassword(
  app: FastifyInstance,
  ticketToken: string,
  password: string,
  now: Date,
): Promise<PlatformLoginResult> {
  const { ticket, user } = await ticketFor(app, ticketToken, 'password', now);
  // Never "change" to the same password: the flag exists because that one is known.
  if (await app.passwords.verify(user.password_hash, password)) {
    throw new AppError(400, 'validation_failed', 'اختر كلمة سر مختلفة عن الحالية.', {
      password: 'اختر كلمة سر مختلفة عن الحالية.',
    });
  }
  const hash = await app.passwords.hash(password);
  await app.db.execute(sql`select platform_password_set(${user.id}::uuid, ${hash})`);
  return nextStep(app, (await security(app, user.id)) ?? user, ticket.codePassed, now);
}

// ─── Enrolment ───────────────────────────────────────────────────────────────

export async function beginEnrolment(app: FastifyInstance, userId: string): Promise<PlatformEnrolStart> {
  const user = await security(app, userId);
  if (!user) throw unauthorized();
  if (user.totp_enabled) {
    throw new AppError(409, 'conflict', 'التحقق بخطوتين مفعّل لهذا الحساب أصلاً.');
  }
  const secret = newTotpSecret();
  const [saved] = await app.db.execute<{ ok: boolean }>(
    sql`select platform_totp_begin(${userId}::uuid, ${box(app).seal(secret)}) as ok`,
  );
  if (!saved?.ok) throw unauthorized();
  return { secret: groupKey(secret), uri: otpauthUri(secret, user.full_name, ISSUER) };
}

/** The code from the authenticator confirms the secret; recovery codes are made and returned once. */
export async function confirmEnrolment(
  app: FastifyInstance,
  userId: string,
  code: string,
  now: Date,
): Promise<{ done: PlatformEnrolDone; user: Security }> {
  const user = await security(app, userId);
  if (!user) throw unauthorized();
  const [pending] = await app.db.execute<{ sealed: string | null }>(
    sql`select platform_totp_pending(${userId}::uuid) as sealed`,
  );
  const secret = pending?.sealed ? box(app).open(pending.sealed) : null;
  if (!secret || !/^\d{6}$/.test(code)) throw wrongCode();
  const step = matchTotp(secret, code, now);
  if (step === null) throw wrongCode();
  const recovery = newRecoveryCodes();
  const [active] = await app.db.execute<{ ok: boolean }>(
    sql`select platform_totp_activate(${userId}::uuid, ${step}::bigint, ${JSON.stringify(recovery.hashes)}::jsonb,
      ${now.toISOString()}::timestamptz) as ok`,
  );
  if (!active?.ok) throw wrongCode();
  return { done: { recoveryCodes: recovery.codes }, user: { ...user, totp_enabled: true } };
}

/** Enrolment inside a sign-in: afterwards the rest of the steps decide whether the panel opens. */
export async function enrolDuringLogin(
  app: FastifyInstance,
  ticketToken: string,
  code: string,
  now: Date,
): Promise<PlatformEnrolDone> {
  const { user } = await ticketFor(app, ticketToken, 'enrol', now);
  const { done, user: enrolled } = await confirmEnrolment(app, user.id, code, now);
  const next = await nextStep(app, (await security(app, user.id)) ?? enrolled, true, now);
  return next.step ? done : { ...done, login: next };
}

export async function twoFactorStatus(
  app: FastifyInstance,
  userId: string,
): Promise<PlatformTwoFactorStatus> {
  const user = await security(app, userId);
  if (!user) throw unauthorized();
  return {
    enabled: user.totp_enabled,
    recoveryCodesLeft: user.recovery_left,
    required: platformRequires2fa(app.env),
  };
}
