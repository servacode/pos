import { z } from 'zod';
import { normalizePhone } from '../phone';
import { SECTOR_KEYS, type SectorKey } from '../sectors';
import { CURRENCY_CODES, type CurrencyCode } from '../currencies';
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
  .string('كلمة المرور مطلوبة')
  .min(8, 'كلمة المرور 8 أحرف على الأقل')
  .max(128, 'كلمة المرور طويلة جداً');

export const registerStoreInput = z.object({
  storeName: z
    .string('اسم المتجر مطلوب')
    .trim()
    .min(2, 'اسم المتجر حرفان على الأقل')
    .max(80, 'اسم المتجر طويل جداً'),
  ownerName: z.string('اسمك مطلوب').trim().min(2, 'الاسم حرفان على الأقل').max(80, 'الاسم طويل جداً'),
  phone: phoneSchema,
  password: passwordSchema,
  sectors: z.array(z.enum(SECTOR_KEYS), 'اختر نشاط المتجر').min(1, 'اختر نشاطاً واحداً على الأقل').max(12),
  baseCurrency: z.enum(CURRENCY_CODES, 'اختر العملة الأساسية'),
  /** Optional referral code of the agent who brought the store */
  agentCode: z.string().trim().max(32).optional(),
});

export type RegisterStoreInput = z.input<typeof registerStoreInput>;
export type RegisterStoreData = z.output<typeof registerStoreInput>;

export const loginInput = z.object({
  phone: phoneSchema,
  password: z.string('كلمة المرور مطلوبة').min(1, 'كلمة المرور مطلوبة').max(128),
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
