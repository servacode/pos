import { z } from 'zod';
import { BILLING_CYCLES, type BillingCycle, type SubscriptionPage } from './billing';
import { uuidSchema } from './common';

/**
 * The agents program (07 › برنامج الوكلاء), platform side only. Amounts are USD minor (cents), the
 * unit of the plans' prices. Nothing here is a store's accounting.
 *
 * Platform (its own sign-in; owner and accountant change money, support only reads):
 *   GET  /v1/platform/agents                     { items: PlatformAgent[] }
 *   POST /v1/platform/agents                     agentInput → { id }
 *   GET  /v1/platform/agents/{id}                PlatformAgentPage
 *   PUT  /v1/platform/agents/{id}                agentInput → 204
 *   POST /v1/platform/agents/{id}/balance        agentBalanceInput → { balanceMinor, replay }
 *   PUT  /v1/platform/stores/{id}/agent          moveStoreInput → 204
 *
 * Agent (his own sign-in and token realm):
 *   POST /v1/agent/login                         agentLoginInput → AgentLoginResponse
 *   PUT  /v1/agent/password                      agentPasswordInput → 204
 *   GET  /v1/agent/me                            AgentMe
 *   GET  /v1/agent/stores                        { items: AgentStore[] }
 *   GET  /v1/agent/ledger                        { items: AgentLedgerRow[] }
 *   POST /v1/agent/stores/{id}/activate          agentActivateInput → AgentActivation
 */

export const AGENT_STATUSES = ['active', 'suspended'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** { basic: { monthly: 800, yearly: 8000 } }: a wholesale price that replaces the discount for that plan and cycle */
export const priceOverridesSchema = z.record(
  z.string().trim().min(1).max(40),
  z.object({
    monthly: z.int().positive().max(100_000_000).optional(),
    yearly: z.int().positive().max(100_000_000).optional(),
  }),
);
export type PriceOverrides = z.output<typeof priceOverridesSchema>;

export const agentInput = z.object({
  code: z
    .string('اكتب كود الوكيل')
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'الكود حروف إنكليزية وأرقام وشرطة، من 2 إلى 24 خانة'),
  fullName: z.string('اكتب اسم الوكيل').trim().min(2, 'اكتب اسم الوكيل').max(80),
  phone: z.string().trim().max(30).default(''),
  email: z.union([z.literal(''), z.email('البريد غير صحيح')]).default(''),
  region: z.string().trim().max(60).default(''),
  status: z.enum(AGENT_STATUSES),
  /** Off the plan's list price in hundredths of a percent: 2000 = 20% */
  discountBp: z.int().min(0).max(10_000),
  priceOverrides: priceOverridesSchema.default({}),
  note: z.string().trim().max(300).default(''),
  /** Set when adding him or when he forgot it; he must change it at his first sign-in */
  password: z.union([z.literal(''), z.string().min(8, 'كلمة السر 8 خانات على الأقل').max(200)]).default(''),
});
export type AgentInput = z.input<typeof agentInput>;

export const agentBalanceInput = z.object({
  /** Plus tops up, minus deducts; never zero */
  amountMinor: z
    .int('اكتب المبلغ')
    .refine((v) => v !== 0, 'اكتب المبلغ')
    .refine((v) => Math.abs(v) <= 100_000_000, 'المبلغ كبير'),
  note: z.string().trim().max(200).default(''),
  /** One per attempt: a repeated request with the same key changes nothing twice */
  requestKey: z.string().trim().min(8).max(64),
});

export const moveStoreInput = z.object({ agentId: uuidSchema.nullable() });

export const agentLoginInput = z.object({
  email: z.email('اكتب البريد الإلكتروني'),
  password: z.string().min(1, 'اكتب كلمة السر').max(200),
});

export const agentPasswordInput = z.object({
  current: z.string().min(1).max(200),
  password: z.string().min(8, 'كلمة السر 8 خانات على الأقل').max(200),
});

export const agentActivateInput = z.object({
  planCode: z.string().trim().min(1).max(40),
  billingCycle: z.enum(BILLING_CYCLES),
  requestKey: z.string().trim().min(8).max(64),
});

export interface PlatformAgent {
  id: string;
  code: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  status: AgentStatus;
  discountBp: number;
  priceOverrides: PriceOverrides;
  balanceMinor: number;
  note: string | null;
  hasLogin: boolean;
  createdAt: string;
  stores: number;
  paying: number;
  trialing: number;
}

export interface AgentStore {
  tenantId: string;
  name: string;
  storeCode: string;
  ownerPhone: string | null;
  createdAt: string;
  tenantStatus: 'active' | 'suspended';
  planCode: string | null;
  planName: string | null;
  /** What is true now: a store past its period inside its grace is past_due, beyond it suspended */
  status: SubscriptionPage['status'] | null;
  billingCycle: BillingCycle | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
}

export interface AgentLedgerRow {
  id: string;
  kind: 'topup' | 'adjust' | 'activation';
  amountMinor: number;
  balanceAfterMinor: number;
  storeId: string | null;
  storeName: string | null;
  planCode: string | null;
  billingCycle: BillingCycle | null;
  listPriceMinor: number | null;
  note: string | null;
  createdAt: string;
}

export interface PlatformAgentPage {
  agent: PlatformAgent;
  stores: AgentStore[];
  ledger: AgentLedgerRow[];
}

export interface AgentLoginResponse {
  token: string;
  expiresAt: string;
  agent: { id: string; fullName: string; code: string; mustChangePassword: boolean };
}

/** A plan he may sell and what each cycle costs him against its list price */
export interface AgentPlanPrice {
  code: string;
  name: string;
  monthly: { listMinor: number; wholesaleMinor: number } | null;
  yearly: { listMinor: number; wholesaleMinor: number } | null;
}

export interface AgentMe {
  id: string;
  fullName: string;
  code: string;
  phone: string | null;
  balanceMinor: number;
  mustChangePassword: boolean;
  plans: AgentPlanPrice[];
}

export interface AgentActivation {
  chargedMinor: number;
  balanceAfterMinor: number;
  periodEnd: string | null;
  /** True when this key had already been used: nothing was charged again */
  replay: boolean;
}

/** The wholesale price of one plan and cycle for an agent: his own price, or the list price less his discount. */
export function wholesalePrice(listMinor: number, discountBp: number, override: number | undefined): number {
  return override ?? Math.floor((listMinor * (10_000 - discountBp) + 5_000) / 10_000);
}
