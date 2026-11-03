import { z } from 'zod';
import { isoTimeSchema, uuidSchema } from './common';

/**
 * The store's subscription and the platform panel (07 › فوترة الاشتراكات، لوحة مدير المنصة).
 *
 * Store (subscription.manage):
 *   GET  /v1/subscription                        SubscriptionPage
 *   POST /v1/subscription/invoices               openInvoiceInput → SubscriptionInvoice
 *   POST /v1/subscription/payments               reportPaymentInput → SubscriptionPayment
 *
 * Platform (its own sign-in, /v1/platform/login):
 *   POST /v1/platform/login                      platformLoginInput → PlatformLoginResponse
 *   GET  /v1/platform/stores                     { items: PlatformStore[] }
 *   PUT  /v1/platform/stores/{id}/subscription   platformSubscriptionInput → 204
 *   GET  /v1/platform/payments?status=           { items: PlatformPayment[] }
 *   POST /v1/platform/payments/{id}/confirm      → 204
 *   POST /v1/platform/payments/{id}/reject       { reason } → 204
 *   GET  /v1/platform/plans                      { items: PlanRow[] }
 *   PUT  /v1/platform/plans/{code}               planInput → 204
 *   GET  /v1/platform/settings                   PlatformSettings
 *   PUT  /v1/platform/settings                   PlatformSettings → 204
 */

export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export interface PaymentMethodInfo {
  key: string;
  label: string;
  account: string;
  beneficiary: string;
  instructions: string;
  enabled: boolean;
}

export interface PlanRow {
  code: string;
  name: string;
  isFree: boolean;
  /** Dollar cents */
  priceMonthlyMinor: number | null;
  priceYearlyMinor: number | null;
  trialDays: number | null;
  isActive: boolean;
  limits: Record<string, number | null>;
}

export interface SubscriptionInvoice {
  id: string;
  number: string;
  planCode: string;
  planName: string;
  billingCycle: BillingCycle;
  usdMinor: number;
  sypMinor: number;
  status: 'open' | 'paid' | 'cancelled';
  createdAt: string;
}

export interface SubscriptionPayment {
  id: string;
  number: string;
  invoiceId: string;
  method: string;
  transactionRef: string;
  amountMinor: number;
  currency: 'USD' | 'SYP';
  status: 'pending' | 'confirmed' | 'rejected';
  submittedAt: string;
  reason: string | null;
}

export interface SubscriptionPage {
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  planCode: string;
  planName: string;
  billingCycle: BillingCycle | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** The 72 hours a store keeps while its payment waits */
  graceEndsAt: string | null;
  plans: PlanRow[];
  invoices: SubscriptionInvoice[];
  payments: SubscriptionPayment[];
  paymentMethods: PaymentMethodInfo[];
  sypPerUsd: string;
}

export const openInvoiceInput = z.object({
  planCode: z.string().trim().min(1).max(40),
  billingCycle: z.enum(BILLING_CYCLES),
});

export const reportPaymentInput = z.object({
  invoiceId: uuidSchema,
  method: z.string().trim().min(1).max(40),
  transactionRef: z.string('اكتب رقم العملية').trim().min(3, 'اكتب رقم العملية كما في الإيصال').max(80),
  amountMinor: z.int().positive('اكتب المبلغ الذي حوّلته'),
  currency: z.enum(['USD', 'SYP']),
});

// ─── Platform ────────────────────────────────────────────────────────────────

export const platformLoginInput = z.object({
  email: z.email('اكتب البريد الإلكتروني'),
  password: z.string().min(1, 'اكتب كلمة السر').max(200),
});

export interface PlatformLoginResponse {
  token: string;
  expiresAt: string;
  user: { id: string; fullName: string; role: 'super_admin' | 'support' | 'accountant' };
}

export interface PlatformStore {
  tenantId: string;
  name: string;
  storeCode: string;
  ownerPhone: string | null;
  createdAt: string;
  tenantStatus: 'active' | 'suspended';
  planCode: string | null;
  planName: string | null;
  status: SubscriptionPage['status'] | null;
  billingCycle: BillingCycle | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  pendingPayments: number;
  lastSale: string | null;
}

export interface PlatformPayment {
  id: string;
  tenantId: string;
  storeName: string;
  number: string;
  invoiceNumber: string;
  planName: string;
  billingCycle: BillingCycle;
  method: string;
  transactionRef: string;
  amountMinor: number;
  currency: 'USD' | 'SYP';
  invoiceUsdMinor: number;
  invoiceSypMinor: number;
  status: SubscriptionPayment['status'];
  submittedAt: string;
  reason: string | null;
}

export const platformSubscriptionInput = z.object({
  planCode: z.string().trim().min(1).max(40),
  status: z.enum(['trialing', 'active', 'past_due', 'suspended', 'cancelled']),
  currentPeriodEnd: isoTimeSchema,
});

export const rejectPaymentInput = z.object({
  reason: z.string().trim().min(3, 'اكتب سبب الرفض').max(200),
});

export const planInput = z.object({
  name: z.string().trim().min(2).max(60),
  priceMonthlyMinor: z.int().positive().nullable(),
  priceYearlyMinor: z.int().positive().nullable(),
  trialDays: z.int().min(0).max(365).nullable(),
  isActive: z.boolean(),
});

export const platformSettingsInput = z.object({
  paymentMethods: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(40),
        label: z.string().trim().min(1).max(60),
        account: z.string().trim().max(120),
        beneficiary: z.string().trim().max(120),
        instructions: z.string().trim().max(500),
        enabled: z.boolean(),
      }),
    )
    .max(10),
  sypPerUsd: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/, 'سعر غير صالح'),
});
export type PlatformSettings = z.output<typeof platformSettingsInput>;
