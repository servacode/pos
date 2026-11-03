import { z } from 'zod';
import { SECTOR_KEYS, type SectorKey } from '../sectors';
import { phoneSchema } from './auth';
import type { CurrencyCode } from '../currencies';

/**
 * The store's own settings (04 › معالج البداية، الإعدادات): what the receipt shows, the activity,
 * the currency and the dollar rate. Read by everyone signed in; changed with settings.manage.
 *
 *   GET /v1/store                StoreResponse
 *   PUT /v1/store/profile        storeProfileInput  → StoreResponse
 *   PUT /v1/store/currency       storeCurrencyInput → StoreResponse
 *   PUT /v1/store/onboarding     onboardingInput    → StoreResponse
 */

/** 0 النشاط · 1 معلومات المحل · 2 العملة · 3 ابدأ */
export const ONBOARDING_STEPS = 4;

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const storeProfileInput = z.object({
  name: z
    .string('اسم المحل مطلوب')
    .trim()
    .min(2, 'اكتب اسم المحل كما يظهر على الفاتورة')
    .max(80, 'الاسم طويل'),
  sectors: z
    .array(z.enum(SECTOR_KEYS, 'نشاط غير معروف'))
    .min(1, 'اختر نشاطاً واحداً على الأقل')
    .max(5, 'خمسة أنشطة على الأكثر'),
  legalName: optionalText(120, 'الاسم التجاري طويل'),
  taxNumber: optionalText(40, 'الرقم الضريبي طويل'),
  address: optionalText(200, 'العنوان طويل'),
  phone: z
    .union([z.literal(''), phoneSchema])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  receiptFooter: optionalText(200, 'سطر الفاتورة طويل'),
});
export type StoreProfileInput = z.input<typeof storeProfileInput>;
export type StoreProfileData = z.output<typeof storeProfileInput>;

/** «130» or «130.5»: pounds for one dollar */
export const rateSchema = z
  .string('سعر الصرف مطلوب')
  .trim()
  .regex(/^\d{1,7}(\.\d{1,4})?$/, 'اكتب سعر الدولار بالأرقام، مثل 130')
  .refine((v) => Number(v) > 0, 'سعر الصرف أكبر من صفر');

export const storeCurrencyInput = z
  .object({
    /** The pound is always the base; the dollar is optional */
    usdEnabled: z.boolean(),
    usdRate: rateSchema.nullable().optional(),
    taxInclusive: z.boolean().optional(),
  })
  .refine((v) => !v.usdEnabled || !!v.usdRate, { path: ['usdRate'], message: 'اكتب سعر الدولار اليوم' });
export type StoreCurrencyInput = z.input<typeof storeCurrencyInput>;
export type StoreCurrencyData = z.output<typeof storeCurrencyInput>;

export const onboardingInput = z.object({
  step: z.number().int().min(0).max(ONBOARDING_STEPS),
  /** Finished or skipped: the wizard does not show again */
  done: z.boolean().optional(),
});
export type OnboardingInput = z.input<typeof onboardingInput>;

export interface StoreResponse {
  name: string;
  legalName: string | null;
  taxNumber: string | null;
  sectors: SectorKey[];
  /** The main branch's address and phone, as the receipt prints them */
  address: string | null;
  phone: string | null;
  receiptFooter: string | null;
  baseCurrency: CurrencyCode;
  enabledCurrencies: CurrencyCode[];
  taxInclusive: boolean;
  /** Pounds for one dollar, the latest rate set; null when the dollar is off or never set */
  usdRate: string | null;
  onboarding: { step: number; done: boolean };
}
