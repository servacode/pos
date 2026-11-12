import { z } from 'zod';
import { toLatinDigits } from '../text';
import type { PlatformLoginResponse } from './billing';
import { passwordSchema, phoneSchema, registrationCodeSchema } from './auth';

/**
 * Forgotten password for store users (phone + password sign-in).
 *   POST /v1/auth/forgot          forgotPasswordInput → 202 ForgotPasswordResponse (same for every number)
 *   POST /v1/auth/forgot/reset    resetPasswordInput  → AuthResponse (signed in; every other session ended)
 *
 * Two-factor sign-in of the platform team (TOTP, RFC 6238):
 *   POST /v1/platform/login              → PlatformLoginResponse, or PlatformLoginStep when a step is left
 *   POST /v1/platform/login/code         platformCodeInput   → PlatformLoginResult
 *   POST /v1/platform/login/password     platformNewPasswordInput → PlatformLoginResult
 *   POST /v1/platform/login/enrol        { ticket } → PlatformEnrolStart
 *   POST /v1/platform/login/enrol/confirm platformCodeInput  → PlatformEnrolDone
 *   GET  /v1/platform/2fa                → PlatformTwoFactorStatus
 *   POST /v1/platform/2fa/enrol          → PlatformEnrolStart
 *   POST /v1/platform/2fa/enrol/confirm  { code } → PlatformEnrolDone
 */

export const forgotPasswordInput = z.object({ phone: phoneSchema });
export type ForgotPasswordInput = z.input<typeof forgotPasswordInput>;

/** The same answer whether or not the number has an account. */
export interface ForgotPasswordResponse {
  resetId: string;
  /** Seconds the code stays valid */
  expiresIn: number;
  /** The local server's test mode only: the code, shown on screen (a decoy for unknown numbers) */
  testCode?: string;
}

export const resetPasswordInput = z.object({
  resetId: z.uuid('اطلب رمزاً جديداً'),
  code: registrationCodeSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.input<typeof resetPasswordInput>;

/** A six-digit authenticator code, or a recovery code (letters and digits, dashes ignored). */
export const platformCodeSchema = z
  .string('اكتب الرمز')
  .transform((v) => toLatinDigits(v).replace(/[\s-]/g, '').toLowerCase())
  .pipe(z.string().regex(/^([0-9]{6}|[a-z0-9]{10})$/, 'اكتب الرمز المكوّن من 6 أرقام، أو رمز استرداد.'));

export const platformCodeInput = z.object({ ticket: z.string().min(10).max(2000), code: platformCodeSchema });
export const platformNewPasswordInput = z.object({
  ticket: z.string().min(10).max(2000),
  password: z.string('اكتب كلمة السر الجديدة').min(12, 'كلمة السر 12 حرفاً على الأقل').max(200),
});
export const platformTicketInput = z.object({ ticket: z.string().min(10).max(2000) });
export const platformConfirmInput = z.object({ code: platformCodeSchema });

export type PlatformLoginStepName = 'code' | 'password' | 'enrol';

/** Sign-in is not finished: the ticket (valid ten minutes) proves the password was right. */
export interface PlatformLoginStep {
  step: PlatformLoginStepName;
  ticket: string;
}

export type PlatformLoginResult = (PlatformLoginResponse & { step?: undefined }) | PlatformLoginStep;

export interface PlatformEnrolStart {
  /** The key typed by hand into an authenticator app, base32 in groups of four */
  secret: string;
  /** otpauth:// address drawn as a QR code */
  uri: string;
}

export interface PlatformEnrolDone {
  /** Shown once; each works once. */
  recoveryCodes: string[];
  /** Set when the enrolment finished a sign-in */
  login?: PlatformLoginResponse;
}

export interface PlatformTwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
  /** The server insists on two-factor for the platform team */
  required: boolean;
}
