import { TERMS_VERSION } from '@serva/core';

/**
 * The one place the owner fills in the legal texts' blanks (docs/specs/24-legal.md).
 *
 * `null` is an unknown: the page shows a highlighted «[يُحدَّد لاحقاً]» in its place, and
 * `LEGAL_READY` stays false. Numbers are the draft's own figures (the ones the spec wrote between
 * brackets): the lawyer confirms or changes them here, nowhere else.
 *
 * The texts themselves are in `terms.ts` and `privacy.ts`; they hold `{name}` markers that read
 * from this object.
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
  commercialRegister: null as string | null,
  address: null as string | null,
  email: null as string | null,
  /** The support WhatsApp number, apart from the notifications number */
  supportWhatsapp: null as string | null,
  /** The city whose courts decide a dispute */
  governingCity: null as string | null,

  // ── Retention (blanks: the lawyer)
  /** How long financial documents and their attachments stay (the legal period) */
  financialRetention: null as string | null,
  /** The tolerated difference in a pound payment against the invoice, as a share */
  paymentTolerance: null as string | null,

  // ── Providers (blanks: named when contracted)
  hostingProvider: null as string | null,
  hostingCountry: null as string | null,
  backupProvider: null as string | null,
  smsProvider: null as string | null,
  aiProvider: null as string | null,

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
  commercialRegister: 'رقم السجل التجاري',
  address: 'العنوان',
  email: 'البريد الإلكتروني',
  supportWhatsapp: 'رقم واتساب الدعم',
  governingCity: 'مدينة المحاكم المختصة',
  financialRetention: 'مدة حفظ المستندات المالية',
  paymentTolerance: 'نسبة فرق الصرف المقبول',
  hostingProvider: 'مزوّد الاستضافة',
  hostingCountry: 'بلد الاستضافة',
  backupProvider: 'مزوّد النسخ الاحتياطي',
  smsProvider: 'مزوّد رسائل SMS',
  aiProvider: 'مزوّد الذكاء الاصطناعي',
};

/** The keys whose value is still unknown, in the order the config lists them. */
export function remainingBlanks(values: Record<string, unknown> = LEGAL): string[] {
  return Object.keys(values).filter((key) => values[key] === null || values[key] === '');
}

/** False while any blank remains or the lawyer's review is not recorded: the texts are a draft. */
export const LEGAL_READY: boolean = remainingBlanks().length === 0 && LEGAL.reviewedByLawyer;
