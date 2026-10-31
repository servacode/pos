import { z } from 'zod';
import type { PlatformPermission, PlatformRole } from '../permissions';
import { SECTOR_KEYS, type SectorKey } from '../sectors';
import {
  latinDigits,
  isoTimeSchema,
  listPageQuery,
  shortTextSchema,
  uuidSchema,
  versionSchema,
  type ListResponse,
} from './common';
import { agentCodeSchema, phoneSchema, type SubscriptionStatus } from './auth';
import {
  SUBSCRIPTION_PAYMENT_METHOD_KEYS,
  PAYMENT_STATUS_KEYS,
  PLAN_FEATURE_KEYS,
  SUBSCRIPTION_STATE_KEYS,
  planLimitsSchema,
  type BillingCycle,
  type InvoiceStatus,
  type SubscriptionPaymentMethod,
  type PaymentStatus,
  type PlanFeature,
  type PlanLimits,
  type PublicPaymentAccount,
  type StoreAccess,
  type SubscriptionState,
  type UsageLine,
} from './billing';
import { GOVERNORATE_KEYS, usdRateSchema, type Governorate, type OnboardingStep } from './onboarding';

/**
 * The platform panel «لوحة المنصة»: the owner of Serva and his team (07 › لوحة مدير المنصة; 12 ›
 * لوحة المنصة; 13; 16 › سرقة حساب مدير المنصة; 17 › لوحة المنصة; 23 › المرحلة 1 › 6 و7).
 *
 * A separate gate: platform users are not store users. Platform token in `Authorization: Bearer`
 * with its own audience PLATFORM_TOKEN_AUDIENCE and signing key (a store token never opens these
 * routes, nor a platform token a store route); refresh token in the cookie PLATFORM_REFRESH_COOKIE
 * on the path PLATFORM_COOKIE_PATH only. The server also accepts these routes only from the
 * team's network (PLATFORM_ALLOWED_CIDRS, the VPN; 07, 16). Each route checks one permission of
 * permissions.ts › PLATFORM_ROLE_PERMISSIONS:
 *
 *   POST  /v1/platform/auth/login               public     platformLoginInput → PlatformLoginChallenge
 *   POST  /v1/platform/auth/totp                public     platformTotpInput → PlatformAuthResponse (+ cookie)
 *   POST  /v1/platform/auth/refresh             cookie     → PlatformRefreshResponse (rotates the cookie)
 *   POST  /v1/platform/auth/logout              cookie     → 204
 *   GET   /v1/platform/me                       any        → PlatformMe
 *
 *   GET   /v1/platform/stores                   stores.view      platformStoreListQuery → ListResponse<PlatformStoreListItem>
 *   GET   /v1/platform/stores/{id}              stores.view      → PlatformStoreDetail
 *   POST  /v1/platform/stores/{id}/extend       stores.extend    extendStoreInput → PlatformStoreDetail
 *   POST  /v1/platform/stores/{id}/suspend      stores.suspend   storeReasonInput → PlatformStoreDetail
 *   POST  /v1/platform/stores/{id}/resume       stores.suspend   storeReasonInput → PlatformStoreDetail
 *   POST  /v1/platform/stores/{id}/notes        stores.notes     storeNoteInput → PlatformStoreNote (201)
 *
 *   GET   /v1/platform/payments                 payments.view     platformPaymentListQuery → ListResponse<PlatformPayment>
 *   GET   /v1/platform/payments/{id}            payments.view     → PlatformPaymentDetail
 *   GET   /v1/platform/payments/{id}/receipt    payments.view     → the receipt image bytes
 *   POST  /v1/platform/payments/{id}/confirm    payments.decide   confirmPaymentInput → PlatformPaymentDetail
 *   POST  /v1/platform/payments/{id}/reject     payments.decide   rejectPaymentInput → PlatformPaymentDetail
 *   POST  /v1/platform/payments/{id}/unconfirm  payments.unconfirm unconfirmPaymentInput → PlatformPaymentDetail
 *
 *   GET   /v1/platform/plans                    plans.manage      → { items: PlatformPlan[] }
 *   POST  /v1/platform/plans                    plans.manage      createPlanInput → PlatformPlan (201)
 *   PATCH /v1/platform/plans/{id}               plans.manage      updatePlanInput → PlatformPlan
 *   GET   /v1/platform/billing-rate             plans.manage      → BillingRate
 *   PUT   /v1/platform/billing-rate             plans.manage      setBillingRateInput → BillingRate
 *
 *   GET   /v1/platform/payment-methods          payment_accounts.manage  → { items: PlatformPaymentAccount[] }
 *   POST  /v1/platform/payment-methods          payment_accounts.manage  createPaymentAccountInput → 202 PendingApprovalResponse
 *   PATCH /v1/platform/payment-methods/{id}     payment_accounts.manage  updatePaymentAccountInput → PlatformPaymentAccount | 202 PendingApprovalResponse
 *   GET   /v1/platform/approvals                approvals.decide  approvalListQuery → ListResponse<PlatformApproval>
 *   POST  /v1/platform/approvals/{id}/approve   approvals.decide  approveInput → PlatformApproval
 *   POST  /v1/platform/approvals/{id}/cancel    approvals.decide  cancelApprovalInput → PlatformApproval
 *
 *   GET   /v1/platform/agents                   agents.view       agentListQuery → ListResponse<PlatformAgent>
 *   POST  /v1/platform/agents                   agents.manage     createAgentInput → PlatformAgent (201)
 *   PATCH /v1/platform/agents/{id}              agents.manage     updateAgentInput → PlatformAgent
 *   GET   /v1/public/agents/{code}              public            → PublicAgentResponse (404 not_found)
 *
 *   GET   /v1/platform/audit-logs               audit.view        auditLogQuery → ListResponse<PlatformAuditEntry>
 *   GET   /v1/platform/team                     team.view         → { items: PlatformTeamMember[] }
 *
 * Every change here writes one PlatformAuditEntry with who, when, what, before and after (17:
 * «كل طلب يغيّر شيئاً هنا يُسجَّل باسم منفّذه والقيمة قبل وبعد»), in the same transaction; so does
 * opening a receipt. The panel never reads store data beyond what these answers carry: no sales,
 * no amounts of the store's business (07 › مدير المنصة لا يرى بيانات المتاجر تلقائياً).
 */

// ─── Sign-in and 2FA ─────────────────────────────────────────────────────────

/**
 * 16 and 07 ask for a hardware security key (WebAuthn) for every team member. Phase 1 ships the
 * safe subset the brief allows: password + TOTP (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step, a code
 * used once), one-time recovery codes, VPN-only routes, short sessions and a step-up TOTP on every
 * sensitive action. WebAuthn adds a `webauthn` stage to PlatformLoginChallenge.next later, and
 * then becomes mandatory (docs/contracts/step6.md, Q1).
 */
export const PLATFORM_TOKEN_AUDIENCE = 'serva-platform';
export const PLATFORM_REFRESH_COOKIE = 'serva_prt';
export const PLATFORM_COOKIE_PATH = '/v1/platform/auth';
/** Access token lifetime, seconds */
export const PLATFORM_ACCESS_TTL_SECONDS = 600;
/** A refresh unused this long ends the sign-in (design: «الجلسة تنتهي بعد 30 دقيقة دون استخدام») */
export const PLATFORM_IDLE_SECONDS = 1800;
/** Absolute end of a sign-in, never extended */
export const PLATFORM_ABSOLUTE_SECONDS = 12 * 3600;
/** Between the password and the code */
export const PLATFORM_CHALLENGE_TTL_SECONDS = 300;
/** Wrong codes on one challenge before it is spent (the password is asked again) */
export const PLATFORM_CHALLENGE_MAX_ATTEMPTS = 5;
export const PLATFORM_RECOVERY_CODE_COUNT = 10;

export const platformLoginInput = z.object({
  email: z.string('البريد مطلوب').trim().toLowerCase().pipe(z.email('البريد غير صحيح')),
  password: z.string('كلمة السر مطلوبة').min(1, 'كلمة السر مطلوبة').max(200),
});
export type PlatformLoginInput = z.input<typeof platformLoginInput>;
export type PlatformLoginData = z.output<typeof platformLoginInput>;

/**
 * The answer to a right password; no token yet. `totp_enroll` happens once, at the first sign-in:
 * the screen shows the QR of `otpauthUri` (and `secret` to type by hand) and asks for the first
 * code. A wrong email or password is 401 `invalid_credentials`, the same for both, after the
 * same work (no account enumeration); every attempt is audited and the general manager is
 * alerted of each sign-in (16).
 */
export interface PlatformLoginChallenge {
  challengeId: string;
  next: 'totp_enroll' | 'totp_verify';
  /** Seconds */
  expiresIn: number;
  enrollment: { secret: string; otpauthUri: string } | null;
}

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A 6-digit TOTP code as typed («١٢٣ ٤٥٦» reads 123456), or null. */
export function normalizeTotp(input: string): string | null {
  let out = '';
  for (const ch of latinDigits(input)) {
    if (ch === ' ') continue;
    if (!isDigit(ch)) return null;
    out += ch;
  }
  return out.length === 6 ? out : null;
}

/** A recovery code «ABCDE-FGH23» as typed (case, spaces, the dash are free), or null. */
export function normalizeRecoveryCode(input: string): string | null {
  let out = '';
  for (const ch of input.trim().toUpperCase()) {
    if (ch === '-' || ch === ' ') continue;
    if (!RECOVERY_ALPHABET.includes(ch)) return null;
    out += ch;
  }
  return out.length === 10 ? `${out.slice(0, 5)}-${out.slice(5)}` : null;
}

/** A TOTP code field: on sign-in and as the step-up of sensitive actions (`totp`). */
export const totpCodeSchema = z.string('اكتب الرمز من تطبيق المصادقة').transform((value, ctx) => {
  const code = normalizeTotp(value);
  if (!code) {
    ctx.addIssue({ code: 'custom', message: 'الرمز 6 أرقام من تطبيق المصادقة' });
    return z.NEVER;
  }
  return code;
});

/**
 * POST /v1/platform/auth/totp: the code from the authenticator app, or one recovery code. A wrong
 * code is 401 `otp_invalid`; the fifth spends the challenge (401 `locked`, sign in again).
 */
export const platformTotpInput = z.object({
  challengeId: uuidSchema,
  code: z.string('اكتب الرمز').transform((value, ctx) => {
    const totp = normalizeTotp(value);
    if (totp) return { kind: 'totp' as const, value: totp };
    const recovery = normalizeRecoveryCode(value);
    if (recovery) return { kind: 'recovery' as const, value: recovery };
    ctx.addIssue({ code: 'custom', message: 'اكتب الرمز من 6 أرقام، أو أحد رموز الاسترداد' });
    return z.NEVER;
  }),
});
export type PlatformTotpInput = z.input<typeof platformTotpInput>;
export type PlatformTotpData = z.output<typeof platformTotpInput>;

export interface PlatformMe {
  id: string;
  fullName: string;
  email: string;
  role: PlatformRole;
  permissions: PlatformPermission[];
  lastLoginAt: string | null;
}

export interface PlatformAuthResponse {
  accessToken: string;
  expiresIn: number;
  user: PlatformMe;
  /** Only right after enrolment: shown once, to keep in the safe; each works once */
  recoveryCodes: string[] | null;
}

export interface PlatformRefreshResponse {
  accessToken: string;
  expiresIn: number;
}

// ─── Stores ──────────────────────────────────────────────────────────────────

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const PLATFORM_STORE_SORTS = ['newest', 'ends_soon', 'name'] as const;

/** GET /v1/platform/stores (07: «بحث وتصفية حسب الحالة والبلد والقطاع»; 17: «والمحافظة والوكيل»). */
export const platformStoreListQuery = z.object({
  /** Store name, store code, owner name or phone */
  q: z.string().trim().max(100).optional(),
  state: z.enum(SUBSCRIPTION_STATE_KEYS).optional(),
  /** «دفعة بانتظار التأكيد» */
  pendingPayment: booleanQuery.optional(),
  sector: z.enum(SECTOR_KEYS).optional(),
  planId: uuidSchema.optional(),
  /** An agent id, or `none` for stores that came without one */
  agentId: z.union([uuidSchema, z.literal('none')]).optional(),
  governorate: z.enum(GOVERNORATE_KEYS).optional(),
  sort: z.enum(PLATFORM_STORE_SORTS).default('newest'),
  ...listPageQuery,
});
export type PlatformStoreListQuery = z.input<typeof platformStoreListQuery>;

/** How a store came to its agent (23 › 7): his link (`/register?agent=CODE`) or his code typed. */
export type AttributionVia = 'link' | 'code';

export interface PlatformStoreSubscription {
  status: SubscriptionStatus;
  state: SubscriptionState;
  access: StoreAccess;
  plan: { id: string; code: string; name: string };
  billingCycle: BillingCycle | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  provisionalUntil: string | null;
  endsAt: string | null;
  daysLeft: number | null;
}

export interface PlatformStoreListItem {
  id: string;
  name: string;
  /** The public 6-digit store code */
  storeCode: string;
  sectors: SectorKey[];
  governorate: Governorate | null;
  owner: { fullName: string; phone: string | null };
  subscription: PlatformStoreSubscription;
  agent: { id: string; code: string; fullName: string; via: AttributionVia } | null;
  pendingPayment: boolean;
  createdAt: string;
  /** Last time a device of the store reached the server; null before any */
  lastSeenAt: string | null;
}

export const SUBSCRIPTION_EVENT_KINDS = {
  trial_started: 'بدء التجربة',
  trial_extended: 'تمديد التجربة',
  period_extended: 'تمديد الفترة',
  grace_extended: 'تمديد المهلة',
  provisional_granted: 'تفعيل مؤقت',
  payment_confirmed: 'تأكيد دفعة',
  payment_rejected: 'رفض دفعة',
  payment_reversed: 'إلغاء تأكيد دفعة',
  suspended: 'إيقاف',
  resumed: 'إعادة تفعيل',
} as const;
export type SubscriptionEventKind = keyof typeof SUBSCRIPTION_EVENT_KINDS;

export type PlatformStoreListResponse = ListResponse<PlatformStoreListItem>;

export interface SubscriptionEvent {
  id: string;
  at: string;
  kind: SubscriptionEventKind;
  /** A team member, the store's owner, or the system (null name) */
  actor: { type: 'platform' | 'store' | 'system'; name: string | null };
  reason: string | null;
  days: number | null;
}

export interface PlatformStoreNote {
  id: string;
  text: string;
  author: { id: string; fullName: string };
  createdAt: string;
}

export interface PlatformInvoiceSummary {
  id: string;
  number: string;
  status: InvoiceStatus;
  planName: string;
  cycle: BillingCycle;
  amountUsdMinor: number;
  amountSypMinor: number;
  createdAt: string;
  paidAt: string | null;
  /** The confirmed payment's method, «مدفوعة · شام كاش» */
  paidWith: SubscriptionPaymentMethod | null;
}

/** GET /v1/platform/stores/{id}: «بلا أرقام مبيعات» (17). */
export interface PlatformStoreDetail extends PlatformStoreListItem {
  address: string | null;
  phone: string | null;
  /** tenants.status: the platform's own switch */
  storeStatus: 'active' | 'suspended';
  suspension: { reason: string; at: string; by: string } | null;
  onboarding: { step: OnboardingStep; completedAt: string | null };
  /** Usage against the plan's limits (counts only) */
  usage: UsageLine[];
  counts: { branches: number; devices: number; users: number };
  /** Newest first, the last 12 */
  invoices: PlatformInvoiceSummary[];
  /** Newest first */
  notes: PlatformStoreNote[];
  /** Newest first, the last 50 */
  events: SubscriptionEvent[];
}

/**
 * POST /v1/platform/stores/{id}/extend (17; 13 › «مدة التجربة… وتمديدها لمتجر بعينه»): adds days
 * with extendEnd() to the trial, the paid period or the grace period. Trial on a paid
 * subscription, or period/grace on a trial, is 409 `conflict`. Only this store changes (23 › 6).
 */
export const extendStoreInput = z.object({
  target: z.enum(['trial', 'period', 'grace']),
  days: z.int('عدد الأيام رقم صحيح').min(1, 'يوم واحد على الأقل').max(365, 'سنة على الأكثر'),
  reason: shortTextSchema(500),
});
export type ExtendStoreInput = z.input<typeof extendStoreInput>;
export type ExtendStoreData = z.output<typeof extendStoreInput>;

/**
 * Suspend and resume «بسبب مكتوب» (17). A suspended store is read-only (billing.ts
 * subscriptionState), not locked out: its owner still signs in, reads and exports (07, 24 › 21).
 */
export const storeReasonInput = z.object({ reason: shortTextSchema(500) });
export type StoreReasonInput = z.input<typeof storeReasonInput>;

export const storeNoteInput = z.object({ text: shortTextSchema(2000) });
export type StoreNoteInput = z.input<typeof storeNoteInput>;

// ─── Payments queue «بانتظار تأكيدك» ─────────────────────────────────────────

/**
 * What the queue warns about (design: «مطابق، رقم مكرر، ناقص 1.5%، رمز QR قديم»); none = «مطابق».
 * Confirming a payment with any check needs a written `note`.
 */
export const PAYMENT_CHECKS = {
  amount_short: 'المبلغ أقل من الفاتورة',
  amount_over: 'المبلغ أكثر من الفاتورة',
  receipt_reused: 'صورة الإيصال استُخدمت في دفعة أخرى',
  transaction_resubmitted: 'رقم العملية في دفعة رُفضت سابقاً',
  price_expired: 'انتهت صلاحية سعر الفاتورة قبل الإرسال',
  account_changed: 'الحساب المدفوع له موقوف أو تغيّر (رمز QR قديم)',
} as const;
export type PaymentCheck = keyof typeof PAYMENT_CHECKS;

/** The checks of a payment, computed by the server when it is listed (shared so both sides agree). */
export function paymentChecks(p: {
  paidAmountMinor: number;
  paidCurrency: 'SYP' | 'USD';
  invoice: { amountSypMinor: number; amountUsdMinor: number; priceValidUntil: Date };
  submittedAt: Date;
  receiptReused: boolean;
  transactionResubmitted: boolean;
  accountActive: boolean;
}): PaymentCheck[] {
  const expected = p.paidCurrency === 'USD' ? p.invoice.amountUsdMinor : p.invoice.amountSypMinor;
  const checks: PaymentCheck[] = [];
  if (p.paidAmountMinor < expected) checks.push('amount_short');
  if (p.paidAmountMinor > expected) checks.push('amount_over');
  if (p.receiptReused) checks.push('receipt_reused');
  if (p.transactionResubmitted) checks.push('transaction_resubmitted');
  if (p.submittedAt > p.invoice.priceValidUntil) checks.push('price_expired');
  if (!p.accountActive) checks.push('account_changed');
  return checks;
}

/** Oldest first by default: the queue is worked from the top. */
export const platformPaymentListQuery = z.object({
  status: z.enum(PAYMENT_STATUS_KEYS).default('pending'),
  method: z.enum(SUBSCRIPTION_PAYMENT_METHOD_KEYS).optional(),
  storeId: uuidSchema.optional(),
  /** Transaction number, payment or invoice number, store name */
  q: z.string().trim().max(100).optional(),
  from: isoTimeSchema.optional(),
  to: isoTimeSchema.optional(),
  ...listPageQuery,
});
export type PlatformPaymentListQuery = z.input<typeof platformPaymentListQuery>;

export interface PlatformPayment {
  id: string;
  number: string;
  status: PaymentStatus;
  store: { id: string; name: string; storeCode: string };
  invoice: {
    id: string;
    number: string;
    planName: string;
    cycle: BillingCycle;
    amountUsdMinor: number;
    amountSypMinor: number;
    priceValidUntil: string;
  };
  method: SubscriptionPaymentMethod;
  account: { id: string; label: string };
  transactionNumber: string;
  paidAmountMinor: number;
  paidCurrency: 'SYP' | 'USD';
  submittedAt: string;
  paidAt: string | null;
  provisionalUntil: string | null;
  checks: PaymentCheck[];
  decidedAt: string | null;
  decidedBy: { id: string; fullName: string } | null;
  reason: string | null;
}

export type PlatformPaymentListResponse = ListResponse<PlatformPayment>;

export interface PlatformPaymentDetail extends PlatformPayment {
  /** GET with the platform Bearer token (fetch as a blob); opening it is audited */
  receipt: { url: string; contentType: string; sizeBytes: number; sha256: string };
  /** Other payments with the same receipt image or a rejected one with the same number */
  related: {
    paymentId: string;
    number: string;
    storeName: string;
    status: PaymentStatus;
    via: 'receipt' | 'transaction';
  }[];
  /** The store's earlier payments: how many, and how many were rejected */
  storeHistory: { payments: number; rejected: number };
}

/**
 * Confirm (07: «تأكيد فيصبح الاشتراك نشطاً»): only a `pending` payment (else 409 `conflict`). With
 * any check the `note` is required (validation_failed on `note`): «أكّد رغم … · يحتاج سبباً مكتوباً».
 */
export const confirmPaymentInput = z.object({ note: z.string().trim().min(1).max(500).optional() });
export type ConfirmPaymentInput = z.input<typeof confirmPaymentInput>;

/** Ready reasons for the reject box; the text sent to the owner is always `reason`. */
export const PAYMENT_REJECTION_PRESETS = [
  'رقم العملية مستخدم في دفعة سابقة',
  'المبلغ في الإيصال لا يطابق الفاتورة',
  'صورة الإيصال غير واضحة. أرسل صورة أوضح',
  'لم نجد التحويل في كشف الحساب',
] as const;

export const rejectPaymentInput = z.object({ reason: shortTextSchema(500) });
export type RejectPaymentInput = z.input<typeof rejectPaymentInput>;

/** Undo a wrong confirmation: general manager only, a written reason and a fresh TOTP code. */
export const unconfirmPaymentInput = z.object({ reason: shortTextSchema(500), totp: totpCodeSchema });
export type UnconfirmPaymentInput = z.input<typeof unconfirmPaymentInput>;

// ─── Plans and the billing rate ──────────────────────────────────────────────

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  /** Offered to stores on «اختر باقتك» */
  isActive: boolean;
  /**
   * The plan new stores trial on (the migrated «free» row). It carries the trial length and is
   * never offered or sold: there is no free plan (07).
   */
  isDefault: boolean;
  trialDays: number | null;
  graceDays: number;
  /** Null: «بعرض سعر» */
  priceMonthlyUsdMinor: number | null;
  priceYearlyUsdMinor: number | null;
  limits: PlanLimits;
  features: PlanFeature[];
  sortOrder: number;
  /** Stores on this plan now */
  storesCount: number;
  version: number;
  updatedAt: string;
}

const isPlanCodeChar = (ch: string) => (ch >= 'a' && ch <= 'z') || isDigit(ch) || ch === '_';

const planCodeSchema = z
  .string('رمز الباقة مطلوب')
  .trim()
  .toLowerCase()
  .refine(
    (v) => v.length >= 2 && v.length <= 32 && [...v].every(isPlanCodeChar),
    'رمز الباقة أحرف لاتينية صغيرة وأرقام و _',
  );

const usdPriceSchema = z.int('السعر رقم صحيح بالسنت').min(1, 'السعر أكبر من صفر').max(100_000_000).nullable();

const planFeatureListSchema = z
  .array(z.enum(PLAN_FEATURE_KEYS))
  .refine((list) => new Set(list).size === list.length, 'الميزة مكررة');

/**
 * Price changes reach new invoices only: an issued invoice keeps its amount and a paid period its
 * price (07 › تثبيت السعر; 13 › المدفوع محمي).
 */
export const createPlanInput = z.object({
  code: planCodeSchema,
  name: shortTextSchema(60),
  priceMonthlyUsdMinor: usdPriceSchema,
  priceYearlyUsdMinor: usdPriceSchema,
  limits: planLimitsSchema.default({}),
  features: planFeatureListSchema.default([]),
  graceDays: z.int().min(0).max(60).default(7),
  sortOrder: z.int().min(0).max(1000).default(0),
  /** A new plan starts hidden; switch it on when ready */
  isActive: z.boolean().default(false),
});
export type CreatePlanInput = z.input<typeof createPlanInput>;
export type CreatePlanData = z.output<typeof createPlanInput>;

export const updatePlanInput = z.object({
  version: versionSchema,
  name: shortTextSchema(60).optional(),
  priceMonthlyUsdMinor: usdPriceSchema.optional(),
  priceYearlyUsdMinor: usdPriceSchema.optional(),
  limits: planLimitsSchema.optional(),
  features: planFeatureListSchema.optional(),
  /** On the default plan only: the trial length of new stores (409 `conflict` on another plan) */
  trialDays: z.int().min(1).max(365).optional(),
  graceDays: z.int().min(0).max(60).optional(),
  sortOrder: z.int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});
export type UpdatePlanInput = z.input<typeof updatePlanInput>;
export type UpdatePlanData = z.output<typeof updatePlanInput>;

/** «سعر عرض الأسعار: 130 ل.س = 1 $» (07 › العملة; 17 › billing-rate). */
export interface BillingRate {
  sypPerUsd: string;
  validFrom: string;
  setBy: { id: string; fullName: string } | null;
}

/** New invoices use it from now; issued invoices keep theirs (valid 7 days). */
export const setBillingRateInput = z.object({ sypPerUsd: usdRateSchema });
export type SetBillingRateInput = z.input<typeof setBillingRateInput>;

// ─── Payment accounts and the two-person rule ────────────────────────────────

/**
 * The platform's receiving accounts, shown to owners (07 › صفحة طرق الدفع في لوحتك). Creating one
 * or changing where money goes (number, QR, holder, bank, instructions, switching on) is sensitive
 * (13 › موافقة شخص ثانٍ; 16): the request needs a fresh TOTP (`totp`) and answers 202 with a
 * pending approval; it takes effect when another super admin approves, or by itself 24 hours after
 * the request if nobody cancels. Switching an account off and the display order take effect at
 * once: stopping payments to an account is always safe (07 › خطة طوارئ شام كاش).
 */
export interface PlatformPaymentAccount extends PublicPaymentAccount {
  isActive: boolean;
  sortOrder: number;
  version: number;
  updatedAt: string;
  /** A sensitive change waiting for approval */
  pendingChange: { approvalId: string; executesAt: string } | null;
}

/** Account numbers as printed: letters, digits, spaces and dashes, 4 to 64. */
const accountNumberSchema = z
  .string('رقم الحساب مطلوب')
  .transform(latinDigits)
  .refine(
    (v) =>
      v.length >= 4 &&
      v.length <= 64 &&
      [...v].every(
        (ch) =>
          isDigit(ch) || ch === ' ' || ch === '-' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z'),
      ),
    'رقم الحساب أرقام وحروف لاتينية فقط',
  );

/** The text a QR carries: printable, one line, up to 2000 characters. */
const qrPayloadSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => [...v].every((ch) => ch >= ' ' && ch !== '\u007f'), 'محتوى رمز QR غير صالح');

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => v || null);

const paymentAccountFields = {
  label: shortTextSchema(60),
  accountNumber: accountNumberSchema,
  holderName: shortTextSchema(120),
  qrPayload: qrPayloadSchema
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  bankName: optionalLine(120),
  bankBranch: optionalLine(120),
  instructions: optionalLine(500),
};

export const createPaymentAccountInput = z
  .object({
    method: z.enum(SUBSCRIPTION_PAYMENT_METHOD_KEYS),
    ...paymentAccountFields,
    sortOrder: z.int().min(0).max(1000).default(0),
    totp: totpCodeSchema,
  })
  .superRefine((value, ctx) => {
    if (value.method === 'bank_transfer' && !value.bankName) {
      ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'اسم المصرف مطلوب للحوالة' });
    }
  });
export type CreatePaymentAccountInput = z.input<typeof createPaymentAccountInput>;
export type CreatePaymentAccountData = z.output<typeof createPaymentAccountInput>;

/** Fields whose change waits for a second person. */
export const SENSITIVE_PAYMENT_ACCOUNT_FIELDS = [
  'label',
  'accountNumber',
  'holderName',
  'qrPayload',
  'bankName',
  'bankBranch',
  'instructions',
] as const;

/** True when a PATCH must go through an approval: any sensitive field, or switching an account on. */
export function paymentAccountChangeIsSensitive(patch: Record<string, unknown>): boolean {
  if (patch.isActive === true) return true;
  return SENSITIVE_PAYMENT_ACCOUNT_FIELDS.some((field) => patch[field] !== undefined);
}

export const updatePaymentAccountInput = z
  .object({
    version: versionSchema,
    label: paymentAccountFields.label.optional(),
    accountNumber: accountNumberSchema.optional(),
    holderName: paymentAccountFields.holderName.optional(),
    qrPayload: qrPayloadSchema.nullable().optional(),
    bankName: z.string().trim().max(120).nullable().optional(),
    bankBranch: z.string().trim().max(120).nullable().optional(),
    instructions: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.int().min(0).max(1000).optional(),
    totp: totpCodeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (paymentAccountChangeIsSensitive(value) && value.totp === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['totp'],
        message: 'اكتب الرمز من تطبيق المصادقة لتأكيد التغيير',
      });
    }
  });
export type UpdatePaymentAccountInput = z.input<typeof updatePaymentAccountInput>;
export type UpdatePaymentAccountData = z.output<typeof updatePaymentAccountInput>;

export const APPROVAL_DELAY_HOURS = 24;

export const APPROVAL_KINDS = {
  payment_account_create: 'إضافة حساب استلام',
  payment_account_change: 'تغيير حساب استلام',
} as const;
export type ApprovalKind = keyof typeof APPROVAL_KINDS;

export const APPROVAL_STATUSES = ['pending', 'executed', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * «بانتظار الشخص الثاني» (12 › الفريق والسجل). Approved by another super admin with a fresh TOTP
 * (approving one's own request is 403 `forbidden`), or executed by the server at `executesAt`;
 * the requester or any super admin may cancel before that. The Telegram alert to the general
 * manager goes out at the request (16).
 */
export interface PlatformApproval {
  id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  /** «تغيير رقم حساب سيريتل كاش» */
  summary: string;
  target: { type: 'payment_account'; id: string | null };
  /** The fields before and after (secrets never appear here) */
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  requestedBy: { id: string; fullName: string };
  requestedAt: string;
  /** requestedAt + 24 h */
  executesAt: string;
  decidedBy: { id: string; fullName: string } | null;
  decidedAt: string | null;
  cancelReason: string | null;
}

/** The 202 answer of a sensitive request; the error code list names the same state. */
export interface PendingApprovalResponse {
  status: 'awaiting_second_approval';
  approval: PlatformApproval;
}

export type PlatformApprovalListResponse = ListResponse<PlatformApproval>;

export const approvalListQuery = z.object({
  status: z.enum(APPROVAL_STATUSES).default('pending'),
  ...listPageQuery,
});

export const approveInput = z.object({ totp: totpCodeSchema });
export type ApproveInput = z.input<typeof approveInput>;

export const cancelApprovalInput = z.object({ reason: shortTextSchema(500) });
export type CancelApprovalInput = z.input<typeof cancelApprovalInput>;

// ─── Agents ──────────────────────────────────────────────────────────────────

export const AGENT_STATUSES = ['active', 'suspended'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** The sign-up path that pre-fills the agent's code (04: «يُملأ تلقائياً إن جاء من رابط وكيل»). */
export function agentReferralPath(code: string): string {
  return `/register?agent=${encodeURIComponent(code)}`;
}

export interface PlatformAgent {
  id: string;
  code: string;
  fullName: string;
  phone: string | null;
  region: Governorate | null;
  status: AgentStatus;
  /** agentReferralPath(code); the panel prefixes the app's public origin and offers a QR */
  referralPath: string;
  /** Stores attributed to him, and those with a confirmed payment */
  storesCount: number;
  payingStoresCount: number;
  createdAt: string;
  version: number;
}

export type PlatformAgentListResponse = ListResponse<PlatformAgent>;

export const agentListQuery = z.object({
  /** Name, code or phone */
  q: z.string().trim().max(100).optional(),
  status: z.enum(AGENT_STATUSES).optional(),
  ...listPageQuery,
});

/** A code taken by another agent is 409 `conflict` on `code`. */
export const createAgentInput = z.object({
  code: agentCodeSchema,
  fullName: shortTextSchema(80),
  phone: phoneSchema,
  region: z.enum(GOVERNORATE_KEYS).nullable().optional().default(null),
});
export type CreateAgentInput = z.input<typeof createAgentInput>;
export type CreateAgentData = z.output<typeof createAgentInput>;

/** The code never changes: printed links and QR codes carry it. A suspended agent's code stops attributing. */
export const updateAgentInput = z.object({
  version: versionSchema,
  fullName: shortTextSchema(80).optional(),
  phone: phoneSchema.optional(),
  region: z.enum(GOVERNORATE_KEYS).nullable().optional(),
  status: z.enum(AGENT_STATUSES).optional(),
});
export type UpdateAgentInput = z.input<typeof updateAgentInput>;
export type UpdateAgentData = z.output<typeof updateAgentInput>;

/** GET /v1/public/agents/{code}: checks a code at sign-up; 404 for an unknown or suspended one. Rate-limited like sign-in. */
export interface PublicAgentResponse {
  code: string;
  fullName: string;
}

// ─── Audit and team ──────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.totp_enrolled',
  'auth.recovery_code_used',
  'auth.logout',
  'store.extend',
  'store.suspend',
  'store.resume',
  'store.note',
  'payment.receipt_viewed',
  'payment.confirm',
  'payment.reject',
  'payment.unconfirm',
  'plan.create',
  'plan.update',
  'billing_rate.set',
  'payment_account.request',
  'payment_account.update',
  'approval.approve',
  'approval.cancel',
  'approval.execute',
  'agent.create',
  'agent.update',
] as const;
export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

/** The design's tabs: «الكل، المتاجر، المال، المحتوى، الفريق». The area is the action's prefix. */
export const PLATFORM_AUDIT_AREAS = [
  'auth',
  'store',
  'payment',
  'plan',
  'billing_rate',
  'payment_account',
  'approval',
  'agent',
] as const;
export type PlatformAuditArea = (typeof PLATFORM_AUDIT_AREAS)[number];

export const auditLogQuery = z.object({
  area: z.enum(PLATFORM_AUDIT_AREAS).optional(),
  action: z.enum(PLATFORM_AUDIT_ACTIONS).optional(),
  actorId: uuidSchema.optional(),
  storeId: uuidSchema.optional(),
  from: isoTimeSchema.optional(),
  to: isoTimeSchema.optional(),
  ...listPageQuery,
});
export type AuditLogQuery = z.input<typeof auditLogQuery>;

/**
 * One line of «سجل كل عملية في اللوحة بالاسم والوقت والقيمة قبل وبعد». Append-only; the server
 * also copies it off the machine (13 › سجل كامل). Never holds a password, a TOTP secret or a code.
 */
export interface PlatformAuditEntry {
  id: string;
  at: string;
  /** Null for the system (an approval executed after 24 hours) */
  actor: { id: string; fullName: string } | null;
  action: PlatformAuditAction;
  area: PlatformAuditArea;
  target: { type: string; id: string } | null;
  store: { id: string; name: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  ip: string | null;
}

export type PlatformAuditListResponse = ListResponse<PlatformAuditEntry>;

export interface PlatformTeamMember {
  id: string;
  fullName: string;
  email: string;
  role: PlatformRole;
  status: 'active' | 'disabled';
  totpEnrolled: boolean;
  lastLoginAt: string | null;
}
