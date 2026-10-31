import { z } from 'zod';
import { normalizePhone } from '../phone';
import type { SectorKey } from '../sectors';
import type { CurrencyCode } from '../currencies';
import { toLatinDigits } from '../text';
import type { Permission, SystemRoleKey } from '../permissions';

export const phoneSchema = z
  .string('رقم الجوال مطلوب')
  .trim()
  .min(1, 'رقم الجوال مطلوب')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'رقم الجوال غير صحيح. مثال: 0912345678' });
      return z.NEVER;
    }
    return normalized;
  });

export const passwordSchema = z
  .string('كلمة السر مطلوبة')
  .min(8, 'كلمة السر 8 أحرف على الأقل')
  .max(128, 'كلمة السر طويلة جداً');

/** Version of the terms of use shown on the sign-up screen; sent with the sign-up and recorded. */
export const TERMS_VERSION = '2026-10-30';

export const agentCodeSchema = z
  .string('كود الوكيل غير صحيح')
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,32}$/, 'كود الوكيل غير صحيح. تأكد منه أو اتركه فارغاً.');

/**
 * Opening an account (04, 12, 17): three fields, an optional agent code and the accepted terms
 * version. Business type and currency are asked by the setup wizard afterwards. The server answers
 * with a code challenge; the store is created only when the code is confirmed (register/verify).
 */
export const registerStoreInput = z.object({
  phone: phoneSchema,
  fullName: z.string('اسمك مطلوب').trim().min(2, 'الاسم حرفان على الأقل').max(80, 'الاسم طويل جداً'),
  password: passwordSchema,
  /** Optional referral code of the agent who brought the store */
  agentCode: agentCodeSchema.optional(),
  termsVersion: z
    .string('الموافقة على الشروط مطلوبة')
    .trim()
    .min(1, 'الموافقة على الشروط مطلوبة')
    .max(32, 'نسخة الشروط غير صحيحة'),
});

export type RegisterStoreInput = z.input<typeof registerStoreInput>;
export type RegisterStoreData = z.output<typeof registerStoreInput>;

/** Answer to POST /v1/auth/register: the same for a new number and a registered one. */
export interface RegisterResponse {
  registrationId: string;
  /** Seconds the code stays valid */
  expiresIn: number;
  /**
   * The local server's test mode only (no SMS there): the code, shown on screen. For a number that
   * already has an account it is a code-shaped decoy that verification rejects.
   */
  testCode?: string;
}

/** Answer to GET /v1/meta: public facts about this server. */
export interface MetaResponse {
  /** The local server's test mode: sign-up codes are shown on screen */
  testMode: boolean;
}

export const registrationCodeSchema = z
  .string('اكتب الرمز الذي وصلك')
  .transform((value) => toLatinDigits(value).replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'الرمز 6 أرقام. اكتبه كما وصلك.'));

/** The code form on its own, for the client's second sign-up screen. */
export const registrationCodeInput = z.object({ code: registrationCodeSchema });

/**
 * Confirming the code creates the account and the store. The password travels again here, so it
 * is hashed only for a verified phone and never stored for an unconfirmed sign-up.
 */
export const verifyRegistrationInput = z.object({
  registrationId: z.uuid('اطلب رمزاً جديداً'),
  code: registrationCodeSchema,
  password: passwordSchema,
});

export type VerifyRegistrationInput = z.input<typeof verifyRegistrationInput>;
export type VerifyRegistrationData = z.output<typeof verifyRegistrationInput>;

export const loginInput = z.object({
  phone: phoneSchema,
  password: z.string('كلمة السر مطلوبة').min(1, 'كلمة السر مطلوبة').max(128),
});

export type LoginInput = z.input<typeof loginInput>;
export type LoginData = z.output<typeof loginInput>;

export interface AuthResponse {
  accessToken: string;
  /** Access token lifetime in seconds */
  expiresIn: number;
  user: { id: string; fullName: string; phone: string | null };
  tenant: { id: string; name: string };
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';

export interface MeResponse {
  user: {
    id: string;
    fullName: string;
    phone: string | null;
    roles: { key: string; name: string; branchId: string | null }[];
    permissions: Permission[];
  };
  tenant: {
    id: string;
    name: string;
    sectors: SectorKey[];
    country: string;
    timezone: string;
  };
  settings: {
    baseCurrency: CurrencyCode;
    enabledCurrencies: CurrencyCode[];
    taxInclusive: boolean;
    numberFormat: 'latn' | 'arab';
  };
  subscription: {
    status: SubscriptionStatus;
    planName: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    /** Whole days left in the trial or paid period; null when unlimited */
    daysLeft: number | null;
  };
  branches: { id: string; code: string; name: string }[];
}

export type { SystemRoleKey };
