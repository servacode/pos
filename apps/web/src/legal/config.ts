import { LEGAL_OPTIONAL_KEYS, LEGAL_TEXT_KEYS, TERMS_VERSION, type PublicLegal } from '@serva/core';

/**
 * The defaults and labels of the legal texts' blanks (docs/specs/24-legal.md).
 *
 * The company and contact details are NOT edited here: the platform panel stores them
 * (platform_settings.legal) and the pages read them from GET /v1/legal (see `useLegal.ts`). This
 * object is what a page shows before they load, or when the server cannot be reached: `null` is an
 * unknown, shown as a highlighted «[يُحدَّد لاحقاً]», and `legalReady` is false. Numbers are the
 * draft's own figures: the lawyer confirms or changes them here.
 *
 * The texts themselves are in `terms.ts` and `privacy.ts`; they hold `{name}` markers that read
 * from the values.
 */
export const LEGAL = {
  /** What «أوافق» records: the same value the API receives at registration (packages/core). */
  version: TERMS_VERSION,
  /** The day this version was published (ISO). */
  updatedAt: '2026-10-30',
  /** Set to true only after the Syrian lawyer has reviewed both texts and every blank is filled. */
  reviewedByLawyer: false,

  // ── The company (blanks: the lawyer / the owner)
  companyName: null as string | null,
  /** The project owner («صاحب المشروع») the company is named with */
  ownerName: null as string | null,
  /** Optional: the sentence that names it reads naturally without it */
  commercialRegister: null as string | null,
  address: null as string | null,
  email: null as string | null,
  /** The support WhatsApp number, apart from the notifications number */
  supportWhatsapp: null as string | null,
  /** Optional: a phone number, when it differs from the support WhatsApp */
  phone: null as string | null,
  /** The city whose courts decide a dispute */
  governingCity: 'دمشق' as string | null,

  // ── Retention (blanks: the lawyer)
  /** How long financial documents and their attachments stay (the legal period) */
  financialRetention: 'عشر سنوات' as string | null,
  /** The tolerated difference in a pound payment against the invoice, as a share */
  paymentTolerance: '1%' as string | null,

  // ── Providers (blanks: named when contracted)
  hostingProvider: null as string | null,
  hostingCountry: null as string | null,
  backupProvider: null as string | null,
  smsProvider: null as string | null,
  aiProvider: 'يُسمّى هنا قبل تفعيل المساعد الذكي' as string | null,

  // ── The draft's figures (confirm with the lawyer)
  trialDays: 30,
  openShiftGraceHours: 24,
  priceChangeNoticeDays: 30,
  founderPriceMonths: 24,
  provisionalActivationHours: 72,
  rateValidityDays: 7,
  refundDays: 14,
  supportAccessHours: 72,
  liabilityMonths: 12,
  dormantMonths: 12,
  shutdownNoticeMonths: 6,
  termsNoticeDays: 30,
  securityLogMonths: 12,
  errorReportDays: 90,
  assistantLogDays: 90,
  whatsappLogDays: 90,
  locationDays: 90,
  supportChatMonths: 12,
  usageMetricsMonths: 24,
};

export type LegalKey = keyof typeof LEGAL;

/** What every unknown value shows on the page, highlighted. */
export const PLACEHOLDER = '[يُحدَّد لاحقاً]';

/** Plain-language name of each blank, for the owner (the placeholder list and the draft notice). */
export const BLANK_LABELS: Partial<Record<LegalKey, string>> = {
  companyName: 'الاسم القانوني للشركة',
  ownerName: 'اسم صاحب المشروع',
  commercialRegister: 'رقم السجل التجاري',
  address: 'العنوان',
  email: 'البريد الإلكتروني',
  supportWhatsapp: 'رقم واتساب الدعم',
  phone: 'رقم الهاتف',
  governingCity: 'مدينة المحاكم المختصة',
  financialRetention: 'مدة حفظ المستندات المالية',
  paymentTolerance: 'نسبة فرق الصرف المقبول',
  hostingProvider: 'مزوّد الاستضافة',
  hostingCountry: 'بلد الاستضافة',
  backupProvider: 'مزوّد النسخ الاحتياطي',
  smsProvider: 'مزوّد رسائل SMS',
  aiProvider: 'مزوّد الذكاء الاصطناعي',
};

/** What the pages read: the defaults above, overlaid with what the platform panel saved. */
export type LegalValues = { [K in keyof typeof LEGAL]: (typeof LEGAL)[K] };

/** Blanks that may stay empty: they never hold the texts back from being final. */
export const OPTIONAL_KEYS: readonly string[] = LEGAL_OPTIONAL_KEYS;

/** The keys whose value is still unknown, in the order the config lists them. */
export function remainingBlanks(values: Record<string, unknown> = LEGAL): string[] {
  return Object.keys(values).filter(
    (key) => !OPTIONAL_KEYS.includes(key) && (values[key] === null || values[key] === ''),
  );
}

/** False while any blank remains or the lawyer's review is not recorded: the texts are a draft. */
export function legalReady(values: LegalValues = LEGAL): boolean {
  return remainingBlanks(values).length === 0 && values.reviewedByLawyer;
}

/**
 * The values to show: the defaults, overlaid with the saved details. An empty saved text is a
 * blank again (null), so clearing a default in the panel marks it on the page.
 */
export function mergeLegal(saved: PublicLegal | null): LegalValues {
  if (!saved) return LEGAL;
  const merged: Record<string, unknown> = { ...LEGAL };
  for (const key of LEGAL_TEXT_KEYS) merged[key] = saved[key] === '' ? null : saved[key];
  merged.reviewedByLawyer = saved.reviewedByLawyer;
  merged.updatedAt = saved.updatedAt;
  return merged as LegalValues;
}
