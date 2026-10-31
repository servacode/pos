import { z } from 'zod';
import { convert, roundToStep } from '../money';
import type { SubscriptionStatus } from './auth';
import {
  isoTimeSchema,
  latinDigits,
  listPageQuery,
  positiveMinorSchema,
  uuidSchema,
  type ListResponse,
} from './common';

/**
 * Subscriptions and their manual payment, store side (07 › دورة حياة الاشتراك، فوترة الاشتراكات،
 * طرق دفع الاشتراك، تحصيل الدفعات; 17 › الاشتراك من جهة المتجر; 12 › حالات الاشتراك على الشاشات;
 * 23 › المرحلة 1 › 6). The platform side is contracts/platform.ts.
 *
 * Store token (`Authorization: Bearer`), tenant from the token; every route needs
 * `subscription.manage` (owner only):
 *
 *   GET  /v1/subscription                         → SubscriptionResponse
 *   GET  /v1/subscription/plans                   → PlanOffersResponse
 *   GET  /v1/payment-methods                      → { items: PublicPaymentAccount[] }
 *   GET  /v1/subscription/invoices                invoiceListQuery → ListResponse<SubscriptionInvoice>
 *   POST /v1/subscription/invoices                createInvoiceInput → SubscriptionInvoice (201, or 200 reused)
 *   GET  /v1/subscription/invoices/{id}           → SubscriptionInvoice
 *   POST /v1/subscription/invoices/{id}/payments  submitPaymentInput → SubscriptionPayment (201)
 *   GET  /v1/subscription/payments                paymentListQuery → ListResponse<SubscriptionPayment>
 *
 * The flow (23 › 6): the owner picks a plan and a cycle → POST invoices gives the reference
 * `SUB-2026-000001`, the amount in dollars and in pounds at the platform's weekly rate (valid 7
 * days) → GET payment-methods gives the QR, the account number and the holder → he pays in his
 * wallet with the reference in the note, uploads the receipt (contracts/uploads.ts, purpose
 * `payment_receipt`) and POSTs the transaction number → the payment is `pending`
 * «بانتظار التأكيد» (number `SBP-2026-000001`) and the store is active provisionally for 72 hours →
 * the platform confirms and the subscription is active to the period end, or rejects with a reason.
 *
 * Invoices: one open invoice per store. A new POST voids the store's other open invoices, unless
 * one for the same plan and cycle is still within its price validity, which is answered again
 * (200) instead. An invoice's price never changes (07 › تثبيت السعر); after `priceValidUntil` a
 * payment is still taken (the owner may have paid on the last day) and the platform sees the
 * `price_expired` check. An invoice with a pending payment takes no second one (409 `conflict`).
 *
 * Transaction numbers (17: `duplicate_transaction`): normalizeTransactionNumber() decides
 * equality, and a number is unique across ALL stores and all methods. The server refuses with 409
 * `duplicate_transaction` (on `transactionNumber`) a number already held by any payment, except a
 * `rejected` payment of the same store (a resubmission after «اطلب إيصالاً آخر»). The check is
 * a unique index, not a read-then-write.
 *
 * Provisional activation (07 › تفعيل مؤقت 72 ساعة): on submission the subscription gets
 * `provisionalUntil = now + 72h`, once per invoice period, and never for a store that has a
 * rejected payment. The answer's `provisionalUntil` is null when it was not granted.
 *
 * Confirmation (platform): the invoice is paid; the subscription becomes `active` on the invoice's
 * plan and cycle for the period of paidPeriodOnConfirm() (it starts where the trial or the paid
 * period ends, so paying early loses no day); `graceEndsAt` = period end + the plan's grace days;
 * `provisionalUntil` is cleared. Rejection clears `provisionalUntil` and sends the reason.
 */

// ─── Constants of 07 (all editable later from the panel, 13) ────────────────

export const TRIAL_DAYS = 30;
export const DEFAULT_GRACE_DAYS = 7;
export const PROVISIONAL_HOURS = 72;
/** «يبقى صالحاً 7 أيام على الفاتورة» */
export const INVOICE_PRICE_VALID_DAYS = 7;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** «السنوي هو الافتراضي في صفحة الدفع (ادفع 10 أشهر وخذ 12)» */
export const BILLING_CYCLES = ['yearly', 'monthly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, yearly: 12 };

/**
 * Manual methods (07 › طرق دفع الاشتراك). The official Sham Cash link and the agent's prepaid
 * credit come later (phase 3) and will be added here.
 */
export const SUBSCRIPTION_PAYMENT_METHODS = {
  sham_cash: 'شام كاش',
  syriatel_cash: 'سيريتل كاش',
  mtn_cash: 'MTN كاش',
  bank_transfer: 'حوالة بنكية',
} as const;
export type SubscriptionPaymentMethod = keyof typeof SUBSCRIPTION_PAYMENT_METHODS;
export const SUBSCRIPTION_PAYMENT_METHOD_KEYS = Object.keys(SUBSCRIPTION_PAYMENT_METHODS) as [
  SubscriptionPaymentMethod,
  ...SubscriptionPaymentMethod[],
];

// ─── Subscription state and the read-only rule ──────────────────────────────

/**
 * What the screens and the server act on (12 › حالات الاشتراك), derived by subscriptionState()
 * from the stored status and dates:
 * - `trialing`: the 30-day trial, everything on.
 * - `provisional`: a payment was sent and waits; active for up to 72 hours (12: «وصلتنا دفعتك»).
 * - `active`: paid to `currentPeriodEnd`.
 * - `grace`: up to 7 days after the period end; selling goes on with a banner («فترة السماح»).
 * - `read_only`: the trial or the subscription ended; reading and export only.
 * - `suspended`: stopped by the platform (abuse, a written reason); reading and export only.
 * - `cancelled`: ended by the owner; reading and export only.
 * The seasonal pause («موقوف موسمياً») is phase 5 and will add `paused`.
 */
export const SUBSCRIPTION_STATES = {
  trialing: 'تجربة',
  provisional: 'مفعّل مؤقتاً',
  active: 'نشط',
  grace: 'فترة السماح',
  read_only: 'انتهى الاشتراك',
  suspended: 'موقوف',
  cancelled: 'ملغى',
} as const;
export type SubscriptionState = keyof typeof SUBSCRIPTION_STATES;
export const SUBSCRIPTION_STATE_KEYS = Object.keys(SUBSCRIPTION_STATES) as [
  SubscriptionState,
  ...SubscriptionState[],
];

/** `full`: everything works. `read_only`: GETs and the READ_ONLY_ALLOWED writes only. */
export type StoreAccess = 'full' | 'read_only';

export interface SubscriptionDates {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Null: period end + DEFAULT_GRACE_DAYS */
  graceEndsAt: Date | null;
  provisionalUntil: Date | null;
  /** tenants.status = 'suspended' (set by the platform) */
  storeSuspended: boolean;
}

export interface SubscriptionStateResult {
  state: SubscriptionState;
  access: StoreAccess;
  /** When the current state ends by itself (trial end, period end, grace end, provisional end); null if never */
  endsAt: Date | null;
  /** Whole days to `endsAt`, rounded up, never negative; null without an end */
  daysLeft: number | null;
}

const daysUntil = (end: Date | null, now: Date) =>
  end === null ? null : Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));

const result = (state: SubscriptionState, endsAt: Date | null, now: Date): SubscriptionStateResult => ({
  state,
  access: state === 'read_only' || state === 'suspended' || state === 'cancelled' ? 'read_only' : 'full',
  endsAt,
  daysLeft: daysUntil(endsAt, now),
});

/**
 * The one rule for «can this store sell and edit now» (07; 12; 24 › 3), shared by the server's
 * guard, GET /v1/subscription, /v1/me and the platform's store list. In order: a store suspended
 * by the platform or a suspended/cancelled subscription is read-only; a running provisional
 * activation is full; a trial is full until its end (no grace after a trial: the platform extends
 * trials instead); a paid period is full until its end, then `grace` until the grace end, then
 * read-only. Nothing here deletes anything.
 */
export function subscriptionState(s: SubscriptionDates, now: Date): SubscriptionStateResult {
  if (s.storeSuspended || s.status === 'suspended') return result('suspended', null, now);
  if (s.status === 'cancelled') return result('cancelled', null, now);
  if (s.provisionalUntil && s.provisionalUntil > now) return result('provisional', s.provisionalUntil, now);
  if (s.status === 'trialing') {
    if (s.trialEndsAt === null || s.trialEndsAt > now) return result('trialing', s.trialEndsAt, now);
    return result('read_only', null, now);
  }
  // active or past_due
  const end = s.currentPeriodEnd;
  if (end === null) return result('active', null, now);
  if (end > now) return result('active', end, now);
  const graceEnd = s.graceEndsAt ?? new Date(end.getTime() + DEFAULT_GRACE_DAYS * DAY_MS);
  if (graceEnd > now) return result('grace', graceEnd, now);
  return result('read_only', null, now);
}

/**
 * Writes a read-only store may still make, as `METHOD /route/template` in Fastify's form (the
 * server compares `${request.method} ${request.routeOptions.url}`). Every GET, HEAD and OPTIONS
 * works too: browsing, reports and exports. Anything else answers 403 `read_only` with
 * READ_ONLY_MESSAGE, and the web shows «اشترك» (12: «زر اشترك في كل صفحة»).
 *
 * Why each is here: signing in and out; paying (the receipt upload, for purpose
 * `payment_receipt` only, the invoice, the payment); accepting new terms; revoking a lost or
 * stolen device (safety never waits for a payment); and the devices' sync. The push stays open
 * because a sale made offline under a valid licence, or in a shift open when the subscription
 * ended (up to 24 hours, 07 › لا إيقاف في منتصف وردية), is never refused: the server accepts it
 * and flags `license_expired` when it was made after the licence's end. Devices stop new sales
 * themselves when their signed licence ends.
 */
export const READ_ONLY_ALLOWED_WRITES = [
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  'POST /v1/auth/logout',
  'POST /v1/auth/logout-all',
  'POST /v1/auth/select-store',
  'POST /v1/uploads',
  'POST /v1/subscription/invoices',
  'POST /v1/subscription/invoices/:id/payments',
  'POST /v1/legal/accept',
  'POST /v1/devices/:id/revoke',
  'POST /v1/device/staff-sessions',
  'POST /v1/sync/push',
  'POST /v1/sync/heartbeat',
  'POST /v1/sync/resync',
] as const;

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** True when a read-only store may make this request (`routeUrl` is the route template). */
export function allowedWhenReadOnly(method: string, routeUrl: string): boolean {
  const verb = method.toUpperCase();
  if (READ_METHODS.includes(verb)) return true;
  return (READ_ONLY_ALLOWED_WRITES as readonly string[]).includes(`${verb} ${routeUrl}`);
}

export const READ_ONLY_MESSAGE =
  'انتهى اشتراكك: تقدر تتصفح بياناتك وتصدّرها، والبيع والتعديل متوقفان حتى تشترك.';
export const SUSPENDED_MESSAGE = 'المتجر موقوف من المنصة: تقدر تتصفح بياناتك وتصدّرها. تواصل مع الدعم.';

// ─── Amounts and periods ─────────────────────────────────────────────────────

/**
 * The pounds of a dollar price at the platform's weekly rate (07 › العملة: «السعر بالدولار، والدفع
 * بالليرة… بسعر أسبوعي… مقرّباً لرقم سهل»): the rate itself is the easy number (130), and the
 * amount is rounded to whole pounds. 250 $ at 130 = 32,500 ل.س.
 */
export function subscriptionSypAmount(usdMinor: number, sypPerUsd: string): number {
  const exact = convert(usdMinor, 'USD', 'SYP', { unit: 'USD', quote: 'SYP', rate: sypPerUsd });
  return roundToStep(exact, 100);
}

/** Adds calendar months in UTC; the 31st becomes the month's last day (Jan 31 + 1 = Feb 28/29). */
export function addMonthsUtc(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(from.getTime());
  out.setUTCFullYear(y, m, Math.min(from.getUTCDate(), lastDay));
  return out;
}

/**
 * The paid period a confirmed payment buys: it starts where the running trial or paid period ends
 * (or now, if nothing runs), and lasts one cycle. Paying on day 18 of the trial starts the year
 * on day 30; renewing before the end adds to it.
 */
export function paidPeriodOnConfirm(
  current: { status: SubscriptionStatus; trialEndsAt: Date | null; currentPeriodEnd: Date | null },
  now: Date,
  cycle: BillingCycle,
): { start: Date; end: Date } {
  const running = current.status === 'trialing' ? current.trialEndsAt : current.currentPeriodEnd;
  const start = running && running > now ? running : now;
  return { start, end: addMonthsUtc(start, BILLING_CYCLE_MONTHS[cycle]) };
}

/**
 * A platform extension (17 › extend; 23 › 6: «مدّد تجربة متجر واحد 10 أيام» → 40 days): adds the days
 * to the current end, or to now when it has passed, so an expired trial reopens for that many days.
 */
export function extendEnd(currentEnd: Date | null, now: Date, days: number): Date {
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  return new Date(base.getTime() + days * DAY_MS);
}

export function provisionalUntilFrom(submittedAt: Date): Date {
  return new Date(submittedAt.getTime() + PROVISIONAL_HOURS * HOUR_MS);
}

/** «SUB-2026-000001» for invoices, «SBP-2026-000001» for payments (07 › الترقيم): yearly, platform-wide. */
export function billingNumber(kind: 'invoice' | 'payment', year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError(`bad year ${year}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new RangeError(`bad sequence ${seq}`);
  return `${kind === 'invoice' ? 'SUB' : 'SBP'}-${year}-${String(seq).padStart(6, '0')}`;
}

// ─── Transaction numbers ─────────────────────────────────────────────────────

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const isUpper = (ch: string) => ch >= 'A' && ch <= 'Z';
const SEPARATORS = [' ', '-', '_', '/', '.', '#'];

export const TRANSACTION_NUMBER_MIN = 4;
export const TRANSACTION_NUMBER_MAX = 40;

/**
 * The comparable form of a wallet or bank transaction number: Arabic digits read as Latin, upper
 * case, spaces and - _ / . # dropped; then only A–Z and 0–9, 4 to 40 of them. «tx-6f21 90a7» and
 * «TX6F2190A7» are the same number. Null when it is not a transaction number. No regex: each
 * character is checked.
 */
export function normalizeTransactionNumber(input: string): string | null {
  const text = latinDigits(input).toUpperCase();
  let out = '';
  for (const ch of text) {
    if (SEPARATORS.includes(ch)) continue;
    if (!isDigit(ch) && !isUpper(ch)) return null;
    out += ch;
  }
  return out.length >= TRANSACTION_NUMBER_MIN && out.length <= TRANSACTION_NUMBER_MAX ? out : null;
}

export const transactionNumberSchema = z
  .string('اكتب رقم العملية')
  .max(80, 'رقم العملية طويل جداً')
  .transform((value, ctx) => {
    const normalized = normalizeTransactionNumber(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'رقم العملية غير صحيح. انسخه كما يظهر في تطبيقك' });
      return z.NEVER;
    }
    return normalized;
  });

// ─── Plans ───────────────────────────────────────────────────────────────────

/** Limits a plan sets (07 › الباقات وحدود الاستخدام). In a plan: a number, or null for «غير محدود». */
export const PLAN_LIMITS = {
  branches: 'الفروع',
  registers: 'أجهزة الكاشير',
  auxDevices: 'أجهزة النادل وشاشات المطبخ',
  users: 'المستخدمون',
  products: 'المنتجات (بالموديل)',
  warehousesPerBranch: 'المستودعات في الفرع',
  customFieldsPerType: 'الحقول الإضافية لكل نوع',
  storageMb: 'مساحة المرفقات (ميغابايت)',
  onlineItems: 'أصناف المتجر الإلكتروني',
  onlineOrdersPerMonth: 'طلبات المتجر الإلكتروني شهرياً',
  salesReps: 'المندوبون',
  payrollEmployees: 'الموظفون في الرواتب',
  assistantQuestionsPerMonth: 'أسئلة المساعد الذكي شهرياً',
} as const;
export type PlanLimitKey = keyof typeof PLAN_LIMITS;
export const PLAN_LIMIT_KEYS = Object.keys(PLAN_LIMITS) as [PlanLimitKey, ...PlanLimitKey[]];
/** A missing key means «غير محدود», like null. */
export type PlanLimits = Partial<Record<PlanLimitKey, number | null>>;

const limitSchema = z.int('الحد رقم صحيح').min(0, 'الحد لا يكون سالباً').max(1_000_000).nullable().optional();

export const planLimitsSchema = z
  .object({
    branches: limitSchema,
    registers: limitSchema,
    auxDevices: limitSchema,
    users: limitSchema,
    products: limitSchema,
    warehousesPerBranch: limitSchema,
    customFieldsPerType: limitSchema,
    storageMb: limitSchema,
    onlineItems: limitSchema,
    onlineOrdersPerMonth: limitSchema,
    salesReps: limitSchema,
    payrollEmployees: limitSchema,
    assistantQuestionsPerMonth: limitSchema,
  } satisfies Record<PlanLimitKey, typeof limitSchema>)
  .strict();

/**
 * What a plan includes (07's ✓ rows); the keys already in the seeded plans plus the later modules.
 * Distinct from the store's feature switches (sectors.ts): a switch hides or shows screens, an
 * entitlement says whether the plan pays for them after the trial.
 */
export const PLAN_FEATURES = {
  sales: 'البيع',
  inventory: 'المخزون',
  customers: 'الزبائن',
  credit: 'الآجل',
  purchases: 'المشتريات والموردون',
  transfers: 'التحويل بين الفروع',
  promotions: 'العروض والولاء',
  accounting_reports: 'القوائم المالية الكاملة',
  api: 'ربط برمجي مع أنظمة أخرى',
  online_store: 'المتجر الإلكتروني والمنيو',
  sales_channels: 'قنوات البيع',
  sales_reps: 'وضع المندوب',
  fixed_assets: 'الأصول الثابتة',
  payroll: 'الرواتب',
} as const;
export type PlanFeature = keyof typeof PLAN_FEATURES;
export const PLAN_FEATURE_KEYS = Object.keys(PLAN_FEATURES) as [PlanFeature, ...PlanFeature[]];

/** A price in both currencies: dollars set by the platform, pounds at the weekly rate. */
export interface DualPrice {
  usdMinor: number;
  sypMinor: number;
}

/** A plan offered on «اختر باقتك» (only active paid plans; the trial carrier plan is never offered). */
export interface OfferedPlan {
  id: string;
  code: string;
  name: string;
  /** Null: «بعرض سعر» (enterprise) — the screen shows «اطلب عرضاً» instead of paying */
  monthly: DualPrice | null;
  yearly: DualPrice | null;
  /** «بدل 120 $»: twelve monthly prices, for the yearly saving line */
  yearlyInsteadOfUsdMinor: number | null;
  limits: PlanLimits;
  features: PlanFeature[];
  /** «الموصى بها لمحلك» from the trial's usage */
  recommended: boolean;
  /** «ما ستفقده هنا»: limits the store's current usage goes over on this plan */
  overLimits: { key: PlanLimitKey; used: number; limit: number }[];
}

export interface PlanOffersResponse {
  items: OfferedPlan[];
  /** «بسعر هذا الأسبوع 130» */
  billingRate: { sypPerUsd: string; validFrom: string };
}

export interface UsageLine {
  key: PlanLimitKey;
  used: number;
  /** Null: unlimited on the compared plan */
  limit: number | null;
}

/** GET /v1/subscription */
export interface SubscriptionResponse {
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
  /** subscriptionState().endsAt / daysLeft */
  endsAt: string | null;
  daysLeft: number | null;
  /** Usage against the paid plan, or during the trial against the recommended one (12: «الاستخدام مقابل الحدود») */
  usage: { planId: string; planName: string; lines: UsageLine[] } | null;
  /** The latest payment still waiting, for «دفعتك بانتظار التأكيد» */
  pendingPayment: SubscriptionPayment | null;
  /** The open invoice, if any, to resume the payment page */
  openInvoice: SubscriptionInvoice | null;
}

// ─── Where to pay ────────────────────────────────────────────────────────────

/** An account of the platform that receives payments (GET /v1/payment-methods; active ones only). */
export interface PublicPaymentAccount {
  id: string;
  method: SubscriptionPaymentMethod;
  /** «شام كاش»، «سيريتل كاش 2» */
  label: string;
  /** Shown with a copy button: «8820 1147 3306» */
  accountNumber: string;
  /** «المستفيد»: always the company, never a person (07) */
  holderName: string;
  /** The text the QR encodes; the web draws the QR. Null for a bank transfer */
  qrPayload: string | null;
  bankName: string | null;
  bankBranch: string | null;
  /** Shown above the form, e.g. «اكتب رقم الفاتورة SUB-… في الملاحظة» */
  instructions: string | null;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = {
  open: 'بانتظار الدفع',
  payment_pending: 'دفعة بانتظار التأكيد',
  paid: 'مدفوعة',
  void: 'ملغاة',
} as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUSES;

/** POST /v1/subscription/invoices: a renewal or the first subscription (yearly unless chosen). */
export const createInvoiceInput = z.object({
  planId: uuidSchema,
  cycle: z.enum(BILLING_CYCLES).default('yearly'),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceInput>;
export type CreateInvoiceData = z.output<typeof createInvoiceInput>;

export interface SubscriptionInvoice {
  id: string;
  /** SUB-2026-000123: the reference written in the transfer note */
  number: string;
  status: InvoiceStatus;
  plan: { id: string; code: string; name: string };
  cycle: BillingCycle;
  /** The period it would buy if confirmed now; recomputed at confirmation (paidPeriodOnConfirm) */
  periodStart: string;
  periodEnd: string;
  amountUsdMinor: number;
  /** subscriptionSypAmount(amountUsdMinor, sypPerUsd) */
  amountSypMinor: number;
  sypPerUsd: string;
  priceValidUntil: string;
  createdAt: string;
  paidAt: string | null;
  /** Newest first */
  payments: SubscriptionPayment[];
}

export const invoiceListQuery = z.object({ ...listPageQuery });
export type InvoiceListResponse = ListResponse<SubscriptionInvoice>;

// ─── Payments ────────────────────────────────────────────────────────────────

export const PAYMENT_STATUSES = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكدة',
  rejected: 'مرفوضة',
  /** A wrong confirmation undone by the general manager (07 › فصل المهام) */
  reversed: 'أُلغي تأكيدها',
} as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUSES;
export const PAYMENT_STATUS_KEYS = Object.keys(PAYMENT_STATUSES) as [PaymentStatus, ...PaymentStatus[]];

/**
 * POST /v1/subscription/invoices/{id}/payments: «أرسل الدفعة». The method is the account's. The
 * amount defaults to the invoice's pounds; the owner changes it only if he paid another amount or
 * in dollars.
 */
export const submitPaymentInput = z.object({
  /** The PublicPaymentAccount he paid to */
  accountId: uuidSchema,
  transactionNumber: transactionNumberSchema,
  /** An upload with purpose `payment_receipt`, not used by another payment */
  receiptUploadId: uuidSchema,
  paidAmountMinor: positiveMinorSchema.optional(),
  paidCurrency: z.enum(['SYP', 'USD']).default('SYP'),
  /** When he paid, if not now */
  paidAt: isoTimeSchema.optional(),
  note: z.string().trim().max(300).optional(),
});
export type SubmitPaymentInput = z.input<typeof submitPaymentInput>;
export type SubmitPaymentData = z.output<typeof submitPaymentInput>;

export interface SubscriptionPayment {
  id: string;
  /** SBP-2026-000311 */
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  method: SubscriptionPaymentMethod;
  accountId: string;
  accountLabel: string;
  /** Normalized */
  transactionNumber: string;
  paidAmountMinor: number;
  paidCurrency: 'SYP' | 'USD';
  receipt: { id: string; url: string };
  status: PaymentStatus;
  submittedAt: string;
  paidAt: string | null;
  /** The provisional activation this payment gave, or null when none was granted */
  provisionalUntil: string | null;
  decidedAt: string | null;
  /** The reason sent to the owner when rejected or reversed */
  reason: string | null;
}

export const paymentListQuery = z.object({
  status: z.enum(PAYMENT_STATUS_KEYS).optional(),
  ...listPageQuery,
});
export type PaymentListResponse = ListResponse<SubscriptionPayment>;
