import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ─── Enums ────────────────────────────────────────────────────────────────────

export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
]);
export const billingCycle = pgEnum('billing_cycle', ['monthly', 'yearly']);
export const platformRole = pgEnum('platform_role', ['super_admin', 'support', 'accountant']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);

// ─── Platform (no tenant_id) ──────────────────────────────────────────────────

export interface PlanLimits {
  branches?: number | null;
  registers?: number | null;
  users?: number | null;
  products?: number | null;
  assistantQuestionsPerMonth?: number | null;
}

/** Subscription plans. Everything here is editable from the platform admin panel. */
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isFree: boolean('is_free').notNull().default(false),
  /** The plan new stores start on */
  isDefault: boolean('is_default').notNull().default(false),
  /** Length of the free period in days; null = no end */
  trialDays: integer('trial_days'),
  graceDays: integer('grace_days').notNull().default(7),
  priceMonthlyMinor: bigint('price_monthly_minor', { mode: 'number' }),
  priceYearlyMinor: bigint('price_yearly_minor', { mode: 'number' }),
  currency: text('currency').notNull().default('USD'),
  limits: jsonb('limits').$type<PlanLimits>().notNull().default({}),
  features: text('features')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const platformUsers = pgTable('platform_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: platformRole('role').notNull(),
  status: userStatus('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A store (tenant). Row-level security limits each store to its own row. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  taxNumber: text('tax_number'),
  country: text('country').notNull().default('SY'),
  timezone: text('timezone').notNull().default('Asia/Damascus'),
  sectors: text('sectors').array().notNull(),
  /** Referral code typed at sign-up; linked to an agent once the agents module exists */
  referralCode: text('referral_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus('status').notNull(),
    billingCycle: billingCycle('billing_cycle'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('subscriptions_tenant_unique').on(t.tenantId)],
);

// ─── Store (every table carries tenant_id and is protected by RLS) ─────────────

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  baseCurrency: text('base_currency').notNull(),
  enabledCurrencies: text('enabled_currencies').array().notNull(),
  /** Shelf prices include tax (common for consumer prices in Syria) */
  taxInclusive: boolean('tax_inclusive').notNull().default(true),
  defaultTaxRateBp: integer('default_tax_rate_bp').notNull().default(0),
  /** 0 = no cash rounding; e.g. 5 = round cash totals to 0.05 */
  cashRoundingMinor: integer('cash_rounding_minor').notNull().default(0),
  numberFormat: text('number_format').notNull().default('latn'),
  receiptFooter: text('receipt_footer'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('branches_tenant_code_unique').on(t.tenantId, t.code),
    unique('branches_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const registers = pgTable(
  'registers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    deviceId: text('device_id'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Composite key: a register can only point at a branch of the same store
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    unique('registers_branch_code_unique').on(t.branchId, t.code),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    permissions: text('permissions').array().notNull(),
    maxDiscountBp: integer('max_discount_bp').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('roles_tenant_key_unique').on(t.tenantId, t.key),
    unique('roles_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fullName: text('full_name').notNull(),
    /** E.164; unique across the platform because it is the login identifier */
    phone: text('phone'),
    passwordHash: text('password_hash'),
    pinHash: text('pin_hash'),
    status: userStatus('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_phone_unique')
      .on(t.phone)
      .where(sql`${t.phone} is not null`),
    unique('users_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    /** null = the role applies to every branch */
    branchId: uuid('branch_id'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    unique('user_roles_unique').on(t.userId, t.roleId, t.branchId).nullsNotDistinct(),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    data: jsonb('data'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

/**
 * Refresh-token sessions. Looked up by token hash before the tenant is known,
 * so this table is not under RLS; it never stores the raw token.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    index('sessions_user_idx').on(t.userId),
  ],
);

/** Tables that carry tenant_id and are protected by the tenant_isolation policy. */
export const TENANT_TABLES = [
  'subscriptions',
  'tenant_settings',
  'branches',
  'registers',
  'roles',
  'users',
  'user_roles',
  'audit_logs',
] as const;
