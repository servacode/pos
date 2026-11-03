import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ─── Common fields ────────────────────────────────────────────────────────────
// Ids are UUIDv7 (time-ordered, so inserts do not scatter indexes). Store tables are keyed by
// (tenant_id, id). `version` and `updated_at` are maintained by the bump_row_version trigger.

const id = () =>
  uuid('id')
    .notNull()
    .default(sql`uuid_generate_v7()`);
const platformId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const version = () => integer('version').notNull().default(1);

/**
 * xid8: the id of the transaction that last wrote a row (15 › السحب). Read as text, because it
 * can exceed 2^53.
 */
export const xid8 = customType<{ data: string; driverData: string }>({
  dataType: () => 'xid8',
});
/**
 * Pull watermark on every table devices download (09 › الحقول المشتركة). Set by the
 * sync_touch_change_xid trigger on every insert and update; deletions leave a row in
 * sync_tombstones.
 */
const changeXid = () =>
  xid8('change_xid')
    .notNull()
    .default(sql`pg_current_xact_id()`);

/** A store sees and writes only rows of the store set by withTenant(). */
const tenantIsolation = (column = sql`tenant_id`) =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: sql`${column} = app_current_tenant()`,
    withCheck: sql`${column} = app_current_tenant()`,
  });

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
/** Administrative state of a store, set by the platform team (e.g. suspended for abuse). */
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const agentStatus = pgEnum('agent_status', ['active', 'suspended']);
export const otpPurpose = pgEnum('otp_purpose', ['registration']);

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
  id: platformId(),
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
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const platformUsers = pgTable('platform_users', {
  id: platformId(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: platformRole('role').notNull(),
  status: userStatus('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Sales agents who bring stores. A store typing an agent's code at sign-up is attributed to that
 * agent (pending until the owner confirms and pays, 07). Not readable by the store role; codes
 * are checked through agent_find_by_code().
 */
export const agents = pgTable('agents', {
  id: platformId(),
  /** Referral code, upper case, e.g. AG-42 */
  code: text('code').notNull().unique(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  status: agentStatus('status').notNull().default('active'),
  version: version(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * One-time codes sent to a phone (09 otp_challenges). For sign-up, the pending registration waits
 * here (payload) and the store is created only once the code is confirmed; unconfirmed rows are
 * deleted after 24 hours and never reserve the number. Reached only through otp_* functions.
 */
export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: platformId(),
    purpose: otpPurpose('purpose').notNull(),
    phone: text('phone').notNull(),
    /** HMAC of the code; the code itself is never stored */
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_challenges_phone_idx').on(t.phone, t.createdAt)],
);

/** A store (tenant). Row-level security limits each store to its own row. */
export const tenants = pgTable(
  'tenants',
  {
    id: platformId(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    taxNumber: text('tax_number'),
    country: text('country').notNull().default('SY'),
    timezone: text('timezone').notNull().default('Asia/Damascus'),
    sectors: text('sectors').array().notNull(),
    /** Agent whose code was given at sign-up (verified); attribution is final after the first payment */
    agentId: uuid('agent_id').references(() => agents.id),
    /** Checked at login, refresh and on every authenticated request */
    status: tenantStatus('status').notNull().default('active'),
    /**
     * Public 6-digit code typed with a manual pairing code (17 › الأجهزة). Random and unique,
     * given by tenant_new_store_code(); not a secret.
     */
    storeCode: text('store_code')
      .notNull()
      .default(sql`tenant_new_store_code()`),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('tenants_store_code_unique').on(t.storeCode), tenantIsolation(sql`id`)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
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
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'subscriptions_pkey', columns: [t.tenantId, t.id] }),
    unique('subscriptions_tenant_unique').on(t.tenantId),
    tenantIsolation(),
  ],
);

/**
 * The platform's own settings (07 › فوترة الاشتراكات): how stores pay (Sham Cash account, transfer
 * details…) and the weekly pound rate a dollar price is shown at. One row; stores read it, the
 * platform panel writes it through platform_settings_save().
 */
export const platformSettings = pgTable('platform_settings', {
  id: integer('id').primaryKey().default(1),
  /** [{ key, label, account, beneficiary, instructions, enabled }] */
  paymentMethods: jsonb('payment_methods').notNull().default([]),
  /** Pounds per dollar for subscription invoices, set weekly */
  sypPerUsd: numeric('syp_per_usd').notNull().default('13000'),
  version: version(),
  updatedAt: updatedAt(),
});

/** What the platform team did, by whom and when (07 › حماية لوحتك). */
export const platformAuditLogs = pgTable('platform_audit_logs', {
  id: platformId(),
  platformUserId: uuid('platform_user_id'),
  action: text('action').notNull(),
  /** The store it was about, when it was about one */
  storeId: uuid('store_id'),
  details: jsonb('details').notNull().default({}),
  createdAt: createdAt(),
});

/** A store's subscription invoice (SUB-2026-000001): a debt to the platform, never in the store's books. */
export const subscriptionInvoices = pgTable(
  'subscription_invoices',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    billingCycle: billingCycle('billing_cycle').notNull(),
    usdMinor: bigint('usd_minor', { mode: 'number' }).notNull(),
    sypMinor: bigint('syp_minor', { mode: 'number' }).notNull(),
    sypPerUsd: numeric('syp_per_usd').notNull(),
    /** open, paid, cancelled */
    status: text('status').notNull().default('open'),
    createdAt: createdAt(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'subscription_invoices_pkey', columns: [t.tenantId, t.id] }),
    unique('subscription_invoices_number_unique').on(t.number),
    tenantIsolation(),
  ],
);

/** A payment a store reported for an invoice (SBP-…), waiting for the platform to confirm it. */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    method: text('method').notNull(),
    transactionRef: text('transaction_ref').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    /** pending, confirmed, rejected */
    status: text('status').notNull().default('pending'),
    submittedBy: uuid('submitted_by').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    reason: text('reason'),
  },
  (t) => [
    primaryKey({ name: 'subscription_payments_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [subscriptionInvoices.tenantId, subscriptionInvoices.id],
    }),
    unique('subscription_payments_number_unique').on(t.number),
    tenantIsolation(),
  ],
);

// ─── Store (every table carries tenant_id and is protected by RLS) ─────────────

export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    baseCurrency: text('base_currency').notNull(),
    enabledCurrencies: text('enabled_currencies').array().notNull(),
    /** Shelf prices include tax (common for consumer prices in Syria) */
    taxInclusive: boolean('tax_inclusive').notNull().default(true),
    defaultTaxRateBp: integer('default_tax_rate_bp').notNull().default(0),
    /**
     * Cash rounding step per currency, in minor units (09/10): only the cash part of a payment is
     * rounded, never the invoice. 0 = no rounding for that currency.
     */
    cashRoundingSteps: jsonb('cash_rounding_steps')
      .$type<Record<string, number>>()
      .notNull()
      .default({ SYP: 1000, USD: 25 }),
    numberFormat: text('number_format').notNull().default('latn'),
    receiptFooter: text('receipt_footer'),
    /** «نهاية يوم العمل», "HH:MM": sales before it belong to the previous business day */
    businessDayCutoff: text('business_day_cutoff').notNull().default('00:00'),
    /** «وضع الوردية»: per_cashier, shared or handover (09 › shifts) */
    shiftMode: text('shift_mode').notNull().default('per_cashier'),
    /** «دقائق الخمول»: a cashier device signs its user out after this many idle minutes */
    idleMinutes: integer('idle_minutes').notNull().default(5),
    /** The start wizard (04 › معالج البداية): the step the owner is on, so they resume there */
    onboardingStep: integer('onboarding_step').notNull().default(0),
    /** When the owner finished or skipped the wizard; null while it still shows */
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    /** «باركود الميزان» (packages/core › scale.ts); null when the store reads no scale labels */
    scaleBarcode: jsonb('scale_barcode').$type<{
      prefixes: string[];
      itemDigits: number;
      valueKind: 'weight' | 'price';
      valueDecimals: number;
    }>(),
    /** «الصالة والمطبخ» (packages/core › contracts/store.ts ServiceSettings); null for a shop */
    service: jsonb('service').$type<{ tables: string[]; orderNumbers: boolean; kitchenTickets: boolean }>(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [index('tenant_settings_change_xid_idx').on(t.tenantId, t.changeXid), tenantIsolation()],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'branches_pkey', columns: [t.tenantId, t.id] }),
    unique('branches_tenant_code_unique').on(t.tenantId, t.code),
    index('branches_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

/**
 * Devices (09: formerly registers): a cashier, an Android POS with a built-in printer, a sales
 * rep's phone, a waiter's device, a price checker, a kitchen screen, a branch hub.
 *
 * A device linked with a pairing code waits for the owner's «اسمح» (pending_approval: no code, no
 * token) and polls with a secret kept only as a hash. On approval it takes the next 3-digit code
 * of its branch, which goes into every document number it issues (INV-001-002-0000154) and is
 * never reused, so a re-activated device gets a new one. The device token is made when the device
 * collects it, stored only as a hash and found through device_find_by_token_hash(). The allowed
 * status changes are enforced by a trigger (0010_devices.sql).
 */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    /** null until approved */
    code: text('code'),
    name: text('name').notNull(),
    /** cashier, android_pos, rep_phone, waiter, price_checker, kitchen_screen, call_screen, hub */
    kind: text('kind').notNull().default('cashier'),
    /** browser, windows, android, ios */
    platform: text('platform').notNull().default('browser'),
    /** pending_approval, active, rejected, revoked */
    status: text('status').notNull().default('active'),
    /** sha256 of the device token; null until the device collects it */
    tokenHash: text('token_hash'),
    /** Public key of the device's own key pair (pairing, licences) */
    publicKey: text('public_key'),
    /** The pairing code it was linked with; null when the owner signed in on the device */
    pairingId: uuid('pairing_id'),
    /** sha256 of the secret the device polls with while it waits for approval */
    activationSecretHash: text('activation_secret_hash'),
    /** The wait for approval ends here */
    activationExpiresAt: timestamp('activation_expires_at', { withTimezone: true }),
    /** When the device collected its token (given once) */
    tokenIssuedAt: timestamp('token_issued_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Revoked (lost or stolen): documents after its last announced number are quarantined */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    /** Heartbeat (17 › POST /v1/sync/heartbeat); the last number per series is in doc_sequences */
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    /** Documents waiting on the device, as it last reported */
    unsentCount: integer('unsent_count'),
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }),
    appVersion: text('app_version'),
    /** Device clock minus server clock at the last sync */
    clockOffsetMs: integer('clock_offset_ms'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'devices_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.approvedBy], foreignColumns: [users.tenantId, users.id] }),
    unique('devices_branch_code_unique').on(t.tenantId, t.branchId, t.code),
    uniqueIndex('devices_token_hash_unique')
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
    uniqueIndex('devices_activation_secret_hash_unique')
      .on(t.activationSecretHash)
      .where(sql`${t.activationSecretHash} is not null`),
    tenantIsolation(),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    permissions: text('permissions').array().notNull(),
    maxDiscountBp: integer('max_discount_bp').notNull().default(0),
    isSystem: boolean('is_system').notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'roles_pkey', columns: [t.tenantId, t.id] }),
    unique('roles_tenant_key_unique').on(t.tenantId, t.key),
    index('roles_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fullName: text('full_name').notNull(),
    /** E.164; unique across the platform because it is the login identifier */
    phone: text('phone'),
    passwordHash: text('password_hash'),
    /** argon2id of the PIN «رمز الدخول»; never sent to a device */
    pinHash: text('pin_hash'),
    /** 4 or 6, null while no PIN is set: which keypad a device shows */
    pinLength: integer('pin_length'),
    /** Moves up with every PIN change, so a device forgets what it learnt of the old one */
    pinVersion: integer('pin_version').notNull().default(0),
    status: userStatus('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'users_pkey', columns: [t.tenantId, t.id] }),
    index('users_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    uniqueIndex('users_phone_unique')
      .on(t.phone)
      .where(sql`${t.phone} is not null`),
    tenantIsolation(),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    /** null = the role applies to every branch */
    branchId: uuid('branch_id'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'user_roles_pkey', columns: [t.tenantId, t.id] }),
    index('user_roles_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    unique('user_roles_unique').on(t.userId, t.roleId, t.branchId).nullsNotDistinct(),
    tenantIsolation(),
  ],
);

/**
 * A pairing code the owner makes for one branch (09 › device_pairings, 16 › زرع جهاز): a QR token
 * of 128 random bits and an 8-character code typed with the store code, both stored only as
 * hashes. Valid 10 minutes, dead after 5 wrong tries, used by one device only. Found before the
 * store is known through device_pairing_find_by_qr_hash() and tenant_find_by_store_code().
 */
export const devicePairings = pgTable(
  'device_pairings',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    /** sha256 of the QR token */
    qrTokenHash: text('qr_token_hash').notNull(),
    /** sha256 of the store id and the manual code */
    codeHash: text('code_hash').notNull(),
    createdBy: uuid('created_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Wrong codes typed for this store while it was open */
    attempts: integer('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** The device linked with it */
    deviceId: uuid('device_id'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'device_pairings_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    uniqueIndex('device_pairings_qr_token_hash_unique').on(t.qrTokenHash),
    index('device_pairings_code_idx').on(t.tenantId, t.codeHash),
    tenantIsolation(),
  ],
);

/**
 * Who did what, append-only (09): the actor and their kind, the grant used (support or accountant),
 * the field-by-field changes, the reason, the device and both clocks. Partitioned by month
 * (created_at), so old months are dropped as partitions; see 0008_audit_logs.sql.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id'),
    /** user, accountant, platform_support, device, system */
    actorType: text('actor_type').notNull().default('user'),
    /** Support grant or accountant link the action was made under */
    grantId: uuid('grant_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    /** Field-by-field changes: { field: [before, after] } */
    changes: jsonb('changes'),
    /** Other context of the action */
    data: jsonb('data'),
    reason: text('reason'),
    deviceId: uuid('device_id'),
    deviceTime: timestamp('device_time', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'audit_logs_pkey', columns: [t.tenantId, t.id, t.createdAt] }),
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantIsolation(),
  ],
);

/**
 * Which version of which legal document a user (or agent) accepted, when, from where, and in what
 * context (09). Append-only: the store role may only insert, and a trigger refuses any change.
 */
export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id'),
    agentId: uuid('agent_id'),
    /** terms, privacy, agent_agreement… */
    document: text('document').notNull(),
    documentVersion: text('document_version').notNull(),
    /** registration, migration_tool… */
    context: text('context').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'legal_acceptances_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    tenantIsolation(),
  ],
);

/**
 * Refresh-token sessions, under RLS like every store table. Before the store is known, a session
 * is found by its token hash through session_find_by_hash(); the raw token is never stored.
 *
 * Each refresh rotates the token into a new row of the same family. The family id is the
 * session id carried by access tokens, and the family ends at absolute_expires_at whatever
 * happens, so a session cannot live forever by refreshing.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
  },
  (t) => [
    primaryKey({ name: 'sessions_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.tenantId, t.familyId),
    tenantIsolation(),
  ],
);

// ─── Sync (15 › عقد المزامنة v1، 09 › التدقيق والمزامنة) ─────────────────────────

/**
 * The durable inbox: every document a device sends is written here as it arrived, with its
 * payload hash, before anything else. Unique per store by document id, with no expiry, so a
 * duplicate is recognised even months later; the rejected and quarantined documents are views of
 * it. Partitioned by month of the document id's UUIDv7 time (0009_sync.sql): a document always
 * lands in the same partition, which keeps the id unique across partitions.
 */
export const syncInbox = pgTable(
  'sync_inbox',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    docId: uuid('doc_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    /** The device's creation order */
    deviceSeq: bigint('device_seq', { mode: 'number' }).notNull(),
    docType: text('doc_type').notNull(),
    number: text('number'),
    payloadHash: text('payload_hash').notNull(),
    /** The whole document as it arrived */
    payload: jsonb('payload').notNull(),
    deps: uuid('deps')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    contractVersion: integer('contract_version').notNull(),
    engineVersion: text('engine_version').notNull(),
    appVersion: text('app_version'),
    deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
    businessDate: date('business_date').notNull(),
    /** accepted, pending_link, rejected, quarantined */
    status: text('status').notNull(),
    /** Why rejected or quarantined, e.g. number_conflict */
    resultCode: text('result_code'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Copies received after the first (a lost answer, a replay): the evidence screen's «مكرر» */
    duplicateCount: integer('duplicate_count').notNull().default(0),
    lastDuplicateAt: timestamp('last_duplicate_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'sync_inbox_pkey', columns: [t.tenantId, t.docId] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    index('sync_inbox_number_idx').on(t.tenantId, t.docType, t.number),
    index('sync_inbox_device_seq_idx').on(t.tenantId, t.deviceId, t.deviceSeq),
    tenantIsolation(),
  ],
);

/**
 * Deletions of synced rows, so devices drop them (15 › السحب). Written by the
 * sync_record_tombstone trigger, never by the API. Partitioned by month of created_at.
 */
export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The pull set the row belonged to, e.g. users */
    collection: text('collection').notNull(),
    recordId: uuid('record_id').notNull(),
    changeXid: changeXid(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'sync_tombstones_pkey', columns: [t.tenantId, t.id, t.createdAt] }),
    index('sync_tombstones_pull_idx').on(t.tenantId, t.collection, t.changeXid, t.recordId),
    tenantIsolation(),
  ],
);

/**
 * Per device and series: the last number the device announced in its heartbeat and the last one
 * that reached the server (09 › doc_sequences). Devices keep their own counters; this is what the
 * server knows, for the missing-documents count and for a revoked device's cut-off.
 */
export const docSequences = pgTable(
  'doc_sequences',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    /** INV, SRT, RCV… */
    series: text('series').notNull(),
    lastAnnounced: integer('last_announced').notNull().default(0),
    lastReceived: integer('last_received').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'doc_sequences_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    unique('doc_sequences_device_series_unique').on(t.tenantId, t.deviceId, t.series),
    tenantIsolation(),
  ],
);

/**
 * A declared loss (GAP, 08): the range of numbers a wiped or broken device issued but never sent,
 * approved by the owner with a reason. The integrity check skips approved ranges.
 */
export const numberGaps = pgTable(
  'number_gaps',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    series: text('series').notNull(),
    fromSeq: integer('from_seq').notNull(),
    toSeq: integer('to_seq').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'number_gaps_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.approvedBy], foreignColumns: [users.tenantId, users.id] }),
    tenantIsolation(),
  ],
);

/**
 * One row about this server (no tenant_id). server_epoch goes up when the database is restored
 * from a backup (server_epoch_bump()), and every sync answer carries it, so devices resend what
 * the restore lost (15 › الحقبة بعد الاستعادة). tombstone_horizon: tombstones before it were
 * dropped, so a device whose cursor is older downloads the set again.
 */
export const serverState = pgTable('server_state', {
  id: boolean('id').primaryKey().default(true),
  serverEpoch: integer('server_epoch').notNull().default(1),
  epochChangedAt: timestamp('epoch_changed_at', { withTimezone: true }).notNull().defaultNow(),
  tombstoneHorizon: xid8('tombstone_horizon')
    .notNull()
    .default(sql`'0'::xid8`),
});

// ─── Shared counters (no tenant_id) ───────────────────────────────────────────

/**
 * Rate-limit counters shared by every server instance (17: an UNLOGGED table on the single
 * server now, Valkey when scaling). Written only through rate_limit_hit().
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
});

// ─── Catalog (09 › الأصناف; docs/contracts/step4.md) ──────────────────────────
// Master data, edited online by the owner and managers and pulled by every device of the store.
// Every table here carries change_xid and the tombstone trigger (0011_catalog.sql).

/** Seeded per store: «قطعة» (piece) and «كيلو» (kg) are system units, found by system_key. */
export const units = pgTable(
  'units',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    allowsFraction: boolean('allows_fraction').notNull().default(false),
    /** piece or kg for the units every store gets; null for the owner's own */
    systemKey: text('system_key'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'units_pkey', columns: [t.tenantId, t.id] }),
    unique('units_system_key_unique').on(t.tenantId, t.systemKey),
    index('units_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

export const taxRates = pgTable(
  'tax_rates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /** Fixed once created: a used rate is never edited in place */
    rateBp: integer('rate_bp').notNull(),
    /** consumption, stamp, sales: picks the posting account */
    kind: text('kind').notNull(),
    showOnReceipt: boolean('show_on_receipt').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'tax_rates_pkey', columns: [t.tenantId, t.id] }),
    index('tax_rates_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'categories_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id] }),
    index('categories_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    /** normalizeArabic(nameAr + ' ' + nameEn), written by the API (15 › البحث في الأصناف) */
    searchName: text('search_name').notNull(),
    categoryId: uuid('category_id'),
    brand: text('brand'),
    /** «الاسم العلمي» of a medicine (03 › الصيدليات): the till finds the product by it too */
    genericName: text('generic_name'),
    /** «له رقم تسلسلي أو IMEI» (03 › الإلكترونيات): every piece is received and sold by its number */
    tracksSerial: boolean('tracks_serial').notNull().default(false),
    /** «الكفالة» in months from the day of sale; null: none */
    warrantyMonths: integer('warranty_months'),
    /** stock, service */
    type: text('type').notNull().default('stock'),
    /** active, temporary */
    status: text('status').notNull().default('active'),
    unitId: uuid('unit_id').notNull(),
    taxRateId: uuid('tax_rate_id'),
    sellOnPos: boolean('sell_on_pos').notNull().default(true),
    /** «الإضافات والخيارات» (contracts/catalog.ts ModifierGroup[]) */
    modifiers: jsonb('modifiers')
      .$type<
        {
          name: string;
          multiple: boolean;
          required: boolean;
          options: { name: string; priceMinor: number }[];
        }[]
      >()
      .notNull()
      .default([]),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'products_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.categoryId], foreignColumns: [categories.tenantId, categories.id] }),
    foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [units.tenantId, units.id] }),
    foreignKey({ columns: [t.tenantId, t.taxRateId], foreignColumns: [taxRates.tenantId, taxRates.id] }),
    index('products_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    index('products_category_idx').on(t.tenantId, t.categoryId),
    tenantIsolation(),
  ],
);

export interface AttributeValue {
  name: string;
  value: string;
}

/** Sales, stock and barcodes always point at the variant; a simple product has one, hidden. */
export const variants = pgTable(
  'variants',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id').notNull(),
    sku: text('sku'),
    label: text('label'),
    attributes: jsonb('attributes').$type<AttributeValue[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    /** «الحد الأدنى في الفرع», thousandths */
    minStockQty: bigint('min_stock_qty', { mode: 'number' }),
    /**
     * The earliest expiry of what is on the shelf (services/expiry.ts: the stock taken from the
     * newest receipts first); null when no receipt gave one. The till warns on it.
     */
    nearestExpiry: date('nearest_expiry'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'variants_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }),
    index('variants_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    index('variants_product_idx').on(t.tenantId, t.productId),
    tenantIsolation(),
  ],
);

/**
 * One shelf price per variant, id = the variant's id (docs/contracts/step4.md decision 4): its
 * own row, so a price edit moves only this small row in the pull.
 */
export const prices = pgTable(
  'prices',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    currency: text('currency').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    minPriceMinor: bigint('min_price_minor', { mode: 'number' }),
    /** «سعر الجملة» of one unit in the price's currency; null: wholesale sells at the shelf price */
    wholesalePriceMinor: bigint('wholesale_price_minor', { mode: 'number' }),
    priceChangedAt: timestamp('price_changed_at', { withTimezone: true }).notNull().defaultNow(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'prices_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.id], foreignColumns: [variants.tenantId, variants.id] }),
    index('prices_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

/** Unique per store (17: «الرمز فريد في المتجر»); a removed barcode is deleted (a tombstone). */
export const barcodes = pgTable(
  'barcodes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    variantId: uuid('variant_id').notNull(),
    code: text('code').notNull(),
    /** standard, internal */
    kind: text('kind').notNull().default('standard'),
    packQty: integer('pack_qty').notNull().default(1000),
    packName: text('pack_name'),
    packPriceMinor: bigint('pack_price_minor', { mode: 'number' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'barcodes_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.variantId], foreignColumns: [variants.tenantId, variants.id] }),
    unique('barcodes_code_unique').on(t.tenantId, t.code),
    index('barcodes_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    index('barcodes_variant_idx').on(t.tenantId, t.variantId),
    tenantIsolation(),
  ],
);

/** Stock per branch and variant (phase 1: one warehouse per branch), thousandths; may go negative. */
export const stockLevels = pgTable(
  'stock_levels',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    qty: bigint('qty', { mode: 'number' }).notNull().default(0),
    reservedQty: bigint('reserved_qty', { mode: 'number' }).notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'stock_levels_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.variantId], foreignColumns: [variants.tenantId, variants.id] }),
    unique('stock_levels_branch_variant_unique').on(t.tenantId, t.branchId, t.variantId),
    index('stock_levels_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

/**
 * Every change of stock, append-only: a sale line moves −baseQty. One row per document and line,
 * so a document processed twice cannot move stock twice. The variant is not a foreign key: a
 * printed sale is never refused, even for a variant this server does not know.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    /** Signed, thousandths of the base unit */
    qty: bigint('qty', { mode: 'number' }).notNull(),
    /** sale, … */
    kind: text('kind').notNull(),
    docId: uuid('doc_id').notNull(),
    lineNo: integer('line_no').notNull(),
    businessDate: date('business_date').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'stock_movements_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    unique('stock_movements_doc_line_unique').on(t.tenantId, t.docId, t.lineNo),
    index('stock_movements_variant_idx').on(t.tenantId, t.variantId, t.createdAt),
    tenantIsolation(),
  ],
);

/** Rates the store set (09 › exchange_rates): one `unit` is worth `rate` of `quote`. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    unit: text('unit').notNull(),
    quote: text('quote').notNull(),
    rate: text('rate').notNull(),
    collectRate: text('collect_rate'),
    minRate: text('min_rate'),
    maxRate: text('max_rate'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'exchange_rates_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [users.tenantId, users.id] }),
    index('exchange_rates_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

// ─── PIN sign-in on devices (16 › تخمين رمز PIN) ──────────────────────────────

/** Wrong PINs in a row per user and device, and the lockout they caused. */
export const pinAttempts = pgTable(
  'pin_attempts',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    failures: integer('failures').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'pin_attempts_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    unique('pin_attempts_user_device_unique').on(t.tenantId, t.userId, t.deviceId),
    tenantIsolation(),
  ],
);

// ─── Documents processed from devices (17 › الإرسال) ──────────────────────────
// Written by the sync processors from accepted documents; the id is the document's id, and the
// whole payload is kept as it arrived. No journal entries yet.

/**
 * A shift (SFT). Made by its shift_open, or by its shift_close when that arrives first (the open
 * fields stay null until the open arrives).
 */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    number: text('number'),
    /** open, closed */
    status: text('status').notNull().default('open'),
    openedBy: uuid('opened_by'),
    mode: text('mode'),
    handoverFromShiftId: uuid('handover_from_shift_id'),
    opening: jsonb('opening'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    businessDate: date('business_date'),
    closeDocId: uuid('close_doc_id'),
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closing: jsonb('closing'),
    shortageTreatment: text('shortage_treatment'),
    forced: boolean('forced'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'shifts_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    tenantIsolation(),
  ],
);

/** A completed sale (INV). shift_linked turns true once its shift is known. */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    number: text('number').notNull(),
    businessDate: date('business_date').notNull(),
    deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
    /** As the payload names it; the shift may arrive later */
    shiftId: uuid('shift_id').notNull(),
    shiftLinked: boolean('shift_linked').notNull().default(false),
    cashierId: uuid('cashier_id').notNull(),
    salespersonId: uuid('salesperson_id'),
    customerId: uuid('customer_id'),
    customerName: text('customer_name'),
    currency: text('currency').notNull(),
    taxInclusive: boolean('tax_inclusive').notNull(),
    grossMinor: bigint('gross_minor', { mode: 'number' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    tipMinor: bigint('tip_minor', { mode: 'number' }).notNull(),
    roundingBaseMinor: bigint('rounding_base_minor', { mode: 'number' }).notNull().default(0),
    changeBaseMinor: bigint('change_base_minor', { mode: 'number' }).notNull().default(0),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    payload: jsonb('payload').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'invoices_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    index('invoices_shift_idx').on(t.tenantId, t.shiftId),
    index('invoices_business_date_idx').on(t.tenantId, t.branchId, t.businessDate),
    tenantIsolation(),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull(),
    lineNo: integer('line_no').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    name: text('name').notNull(),
    barcode: text('barcode'),
    packQty: integer('pack_qty').notNull(),
    qty: bigint('qty', { mode: 'number' }).notNull(),
    baseQty: bigint('base_qty', { mode: 'number' }).notNull(),
    priceCurrency: text('price_currency').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    taxRateId: uuid('tax_rate_id'),
    taxRateBp: integer('tax_rate_bp').notNull(),
    grossMinor: bigint('gross_minor', { mode: 'number' }).notNull(),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'invoice_lines_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }),
    unique('invoice_lines_line_unique').on(t.tenantId, t.invoiceId, t.lineNo),
    index('invoice_lines_variant_idx').on(t.tenantId, t.variantId),
    tenantIsolation(),
  ],
);

export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id').notNull(),
    paymentNo: integer('payment_no').notNull(),
    method: text('method').notNull(),
    currency: text('currency').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    rate: jsonb('rate'),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'number' }).notNull(),
    reference: text('reference'),
    cardLast4: text('card_last4'),
    cardBrand: text('card_brand'),
    providerAccountId: uuid('provider_account_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'invoice_payments_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }),
    unique('invoice_payments_no_unique').on(t.tenantId, t.invoiceId, t.paymentNo),
    tenantIsolation(),
  ],
);

/** Drawer movements (CSH): pay_in, pay_out, expense, safe_drop. */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    number: text('number'),
    businessDate: date('business_date').notNull(),
    shiftId: uuid('shift_id').notNull(),
    shiftLinked: boolean('shift_linked').notNull().default(false),
    kind: text('kind').notNull(),
    currency: text('currency').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    baseCurrency: text('base_currency').notNull(),
    rate: jsonb('rate'),
    baseAmountMinor: bigint('base_amount_minor', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    expenseAccountCode: text('expense_account_code'),
    reference: text('reference'),
    performedBy: uuid('performed_by').notNull(),
    approval: jsonb('approval'),
    payload: jsonb('payload').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'cash_movements_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    index('cash_movements_shift_idx').on(t.tenantId, t.shiftId),
    tenantIsolation(),
  ],
);

/**
 * A sale return (RET, 08 › مرتجع مبيعات): goods back at the prices the sale charged, the money paid
 * back in the sale's currency. The sale is named, not a foreign key: a return may arrive before
 * the sale it returns (another device's), and is never refused for it.
 */
export const saleReturns = pgTable(
  'sale_returns',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    number: text('number').notNull(),
    businessDate: date('business_date').notNull(),
    deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
    saleId: uuid('sale_id').notNull(),
    saleNumber: text('sale_number').notNull(),
    shiftId: uuid('shift_id').notNull(),
    shiftLinked: boolean('shift_linked').notNull().default(false),
    cashierId: uuid('cashier_id').notNull(),
    currency: text('currency').notNull(),
    reason: text('reason').notNull(),
    grossExTaxMinor: bigint('gross_ex_tax_minor', { mode: 'number' }).notNull(),
    discountExTaxMinor: bigint('discount_ex_tax_minor', { mode: 'number' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    /** cash, card, wallet, transfer; null when nothing was paid back */
    refundMethod: text('refund_method'),
    refundReference: text('refund_reference'),
    approval: jsonb('approval'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    payload: jsonb('payload').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'sale_returns_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    index('sale_returns_sale_idx').on(t.tenantId, t.saleId),
    index('sale_returns_shift_idx').on(t.tenantId, t.shiftId),
    index('sale_returns_business_date_idx').on(t.tenantId, t.branchId, t.businessDate),
    tenantIsolation(),
  ],
);

export const saleReturnLines = pgTable(
  'sale_return_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    returnId: uuid('return_id').notNull(),
    lineNo: integer('line_no').notNull(),
    saleLineNo: integer('sale_line_no').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    name: text('name').notNull(),
    qty: bigint('qty', { mode: 'number' }).notNull(),
    baseQty: bigint('base_qty', { mode: 'number' }).notNull(),
    taxRateId: uuid('tax_rate_id'),
    grossExTaxMinor: bigint('gross_ex_tax_minor', { mode: 'number' }).notNull(),
    discountExTaxMinor: bigint('discount_ex_tax_minor', { mode: 'number' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'sale_return_lines_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.returnId], foreignColumns: [saleReturns.tenantId, saleReturns.id] }),
    unique('sale_return_lines_line_unique').on(t.tenantId, t.returnId, t.lineNo),
    tenantIsolation(),
  ],
);

/**
 * The store's customers (09 › customers). Every till pulls them; a till may add one (the
 * `customer` document, whose id becomes the customer's). What a customer owes is not stored here:
 * it is the sum of the 1200 journal lines that name them (party_type customer).
 */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone'),
    taxNumber: text('tax_number'),
    address: text('address'),
    notes: text('notes'),
    /** Base currency; null is no limit */
    creditLimitMinor: bigint('credit_limit_minor', { mode: 'number' }),
    /** retail or wholesale: the price the till sells to them at */
    priceTier: text('price_tier').notNull().default('retail'),
    /** The till document that created it, when a till did */
    createdByDoc: uuid('created_by_doc'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'customers_pkey', columns: [t.tenantId, t.id] }),
    index('customers_phone_idx').on(t.tenantId, t.phone),
    index('customers_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

/** A payment a customer made toward what they owe (RCV, 08 › سند قبض), stored once from its document. */
export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    number: text('number').notNull(),
    businessDate: date('business_date').notNull(),
    deviceTime: timestamp('device_time', { withTimezone: true }).notNull(),
    customerId: uuid('customer_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    shiftLinked: boolean('shift_linked').notNull().default(false),
    cashierId: uuid('cashier_id').notNull(),
    currency: text('currency').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    payload: jsonb('payload').notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'receipts_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }),
    index('receipts_customer_idx').on(t.tenantId, t.customerId),
    index('receipts_shift_idx').on(t.tenantId, t.shiftId),
    index('receipts_business_date_idx').on(t.tenantId, t.branchId, t.businessDate),
    tenantIsolation(),
  ],
);

// ─── Purchases and stock value (08 › فاتورة شراء، الجرد; 10 › الكلفة والربح) ─────────────

/** The store's suppliers. What the store owes each is the 2100 lines that name them. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    phone: text('phone'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: 'suppliers_pkey', columns: [t.tenantId, t.id] }), tenantIsolation()],
);

/** «PUR-2026-000001», «PAY-…», «STK-…»: the dashboard's own documents, numbered per year with no gaps. */
export const documentSequences = pgTable(
  'document_sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    series: text('series').notNull(),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'document_sequences_pkey', columns: [t.tenantId, t.series, t.year] }),
    tenantIsolation(),
  ],
);

/** A purchase from a supplier: goods into a branch at what they cost. Never changed once posted. */
export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    branchId: uuid('branch_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    businessDate: date('business_date').notNull(),
    /** credit, cash, bank */
    payment: text('payment').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'purchases_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    foreignKey({ columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }),
    unique('purchases_number_unique').on(t.tenantId, t.number),
    index('purchases_date_idx').on(t.tenantId, t.businessDate),
    tenantIsolation(),
  ],
);

export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    purchaseId: uuid('purchase_id').notNull(),
    lineNo: integer('line_no').notNull(),
    variantId: uuid('variant_id').notNull(),
    name: text('name').notNull(),
    qty: bigint('qty', { mode: 'number' }).notNull(),
    costMinor: bigint('cost_minor', { mode: 'number' }).notNull(),
    /** «رقم الدفعة» and «تاريخ الانتهاء» as received (03 › الصيدليات: الدفعة والصلاحية) */
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date'),
  },
  (t) => [
    primaryKey({ name: 'purchase_lines_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.purchaseId], foreignColumns: [purchases.tenantId, purchases.id] }),
    unique('purchase_lines_line_unique').on(t.tenantId, t.purchaseId, t.lineNo),
    index('purchase_lines_variant_idx').on(t.tenantId, t.variantId),
    tenantIsolation(),
  ],
);

/** Money paid to a supplier toward what the store owes them. */
export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    businessDate: date('business_date').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    /** cash (from the safe), bank */
    method: text('method').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'supplier_payments_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.supplierId], foreignColumns: [suppliers.tenantId, suppliers.id] }),
    tenantIsolation(),
  ],
);

/**
 * What each variant's stock in each branch is worth (packages/core › costing.ts): its quantity and
 * total value, and the last average known while there was some. The sum of value_minor is what
 * account 1300 holds (integrity check stock_value_ledger).
 */
export const stockValues = pgTable(
  'stock_values',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    qty: bigint('qty', { mode: 'number' }).notNull().default(0),
    valueMinor: bigint('value_minor', { mode: 'number' }).notNull().default(0),
    refQty: bigint('ref_qty', { mode: 'number' }).notNull().default(0),
    refValueMinor: bigint('ref_value_minor', { mode: 'number' }).notNull().default(0),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'stock_values_pkey', columns: [t.tenantId, t.branchId, t.variantId] }),
    tenantIsolation(),
  ],
);

/** The cost each sold or returned line went at, once: what the cost of sales entry posted. */
export const movementCosts = pgTable(
  'movement_costs',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    docId: uuid('doc_id').notNull(),
    lineNo: integer('line_no').notNull(),
    branchId: uuid('branch_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    businessDate: date('business_date').notNull(),
    /** sale (out), return (back) */
    kind: text('kind').notNull(),
    /** Signed like the stock: a sale's cost is negative value out */
    costMinor: bigint('cost_minor', { mode: 'number' }).notNull(),
    /** The entry that posted it (null when it cost nothing) */
    entryId: uuid('entry_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'movement_costs_pkey', columns: [t.tenantId, t.docId, t.lineNo] }),
    tenantIsolation(),
  ],
);

/** A count of the shelves: what was there, what the books said, and the difference posted. */
export const stocktakes = pgTable(
  'stocktakes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    number: text('number').notNull(),
    branchId: uuid('branch_id').notNull(),
    businessDate: date('business_date').notNull(),
    note: text('note'),
    lines: jsonb('lines').notNull(),
    diffValueMinor: bigint('diff_value_minor', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'stocktakes_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    tenantIsolation(),
  ],
);

// ─── Accounting (09 › المحاسبة; 10 › دليل الحسابات الافتراضي، القيود التلقائية) ──────

/**
 * The chart of accounts of a store. Seeded at sign-up by accounts_seed() (migration 0012), which
 * holds the chart of tab 10; an optional module's account (2210, 2550…) is added by
 * account_ensure() the first time something posts to it. The parent is an explicit field, not the
 * number's prefix. A group (6100, 6500, 1110 with its drawers) is never posted to.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    parentCode: text('parent_code'),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    /** asset, liability, equity, revenue, expense */
    type: text('type').notNull(),
    /** debit or credit: the side a normal balance sits on (4200 and 3160 are debit, 1290 credit) */
    normalSide: text('normal_side').notNull(),
    /** balance_sheet, trading, profit_loss (10 › الحساب الختامي) */
    finalAccount: text('final_account').notNull(),
    isGroup: boolean('is_group').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    /** A single-currency account (a drawer in dollars); null takes any currency */
    currency: text('currency'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'accounts_pkey', columns: [t.tenantId, t.id] }),
    unique('accounts_code_unique').on(t.tenantId, t.code),
    foreignKey({
      name: 'accounts_parent_fk',
      columns: [t.tenantId, t.parentCode],
      foreignColumns: [t.tenantId, t.code],
    }),
    tenantIsolation(),
  ],
);

/** The last entry number given per store and year: numbers have no gaps (10 › رقم القيد). */
export const journalSequences = pgTable(
  'journal_sequences',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'journal_sequences_pkey', columns: [t.tenantId, t.id] }),
    unique('journal_sequences_year_unique').on(t.tenantId, t.year),
    tenantIsolation(),
  ],
);

/**
 * Numbers a restore stepped over (task M0-8). A database restored from a backup has forgotten
 * everything numbered after the backup was taken: entry numbers already shown in a report, and
 * device codes of tills linked since, which still hold their tokens and number their documents
 * with that code. Handing those numbers out again would make one number mean two things, so
 * restore_counters_jump() moves each counter past a margin and records the range here:
 *   journal      entry numbers `from_number`…`to_number` of `year` (never posted, on purpose)
 *   device_code  codes `from_number`…`to_number` of the branch `branch_id` (never given again)
 * The integrity check accepts a journal range recorded here; any other gap is still an error.
 */
export const counterJumps = pgTable(
  'counter_jumps',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** journal, device_code */
    counter: text('counter').notNull(),
    year: integer('year'),
    branchId: uuid('branch_id'),
    fromNumber: integer('from_number').notNull(),
    toNumber: integer('to_number').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'counter_jumps_pkey', columns: [t.tenantId, t.id] }),
    index('counter_jumps_counter_idx').on(t.tenantId, t.counter),
    tenantIsolation(),
  ],
);

/**
 * A posted entry: never changed nor deleted; a correction is a reversing entry (10 › قواعد
 * الضمان). One automatic entry per document (unique by source), balanced in the base currency,
 * which the database checks itself.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id'),
    year: integer('year').notNull(),
    seq: integer('seq').notNull(),
    /** «2026-0000154»: year and its gap-free sequence */
    number: text('number').notNull(),
    /** The event's date, as printed on the document */
    entryDate: date('entry_date').notNull(),
    /** The ledger's date; differs only when a document lands in a locked period (phase 2) */
    postingDate: date('posting_date').notNull(),
    /** auto, manual, reversal */
    kind: text('kind').notNull(),
    /** sale, shift_close, cash_movement, manual, reversal */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceNumber: text('source_number'),
    memo: text('memo').notNull(),
    baseCurrency: text('base_currency').notNull(),
    /** Σ debits = Σ credits */
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    reversesId: uuid('reverses_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'journal_entries_pkey', columns: [t.tenantId, t.id] }),
    unique('journal_entries_number_unique').on(t.tenantId, t.year, t.seq),
    unique('journal_entries_source_unique').on(t.tenantId, t.sourceType, t.sourceId, t.kind),
    foreignKey({ columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }),
    index('journal_entries_date_idx').on(t.tenantId, t.entryDate),
    tenantIsolation(),
  ],
);

/**
 * The lines of an entry, inserted in one statement with it. debit/credit are in the base
 * currency; amount_minor is the line's own currency, signed (+ debit, − credit), so a dollar
 * drawer keeps its dollars. shift_id is the drawer's shift; party is a customer or a staff member.
 */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    entryId: uuid('entry_id').notNull(),
    lineNo: integer('line_no').notNull(),
    accountId: uuid('account_id').notNull(),
    debitMinor: bigint('debit_minor', { mode: 'number' }).notNull().default(0),
    creditMinor: bigint('credit_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    rate: jsonb('rate'),
    branchId: uuid('branch_id'),
    shiftId: uuid('shift_id'),
    /** customer, user */
    partyType: text('party_type'),
    partyId: uuid('party_id'),
    memo: text('memo'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'journal_lines_pkey', columns: [t.tenantId, t.id] }),
    unique('journal_lines_line_unique').on(t.tenantId, t.entryId, t.lineNo),
    foreignKey({
      columns: [t.tenantId, t.entryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }),
    foreignKey({ columns: [t.tenantId, t.accountId], foreignColumns: [accounts.tenantId, accounts.id] }),
    index('journal_lines_account_idx').on(t.tenantId, t.accountId),
    index('journal_lines_shift_idx').on(t.tenantId, t.shiftId),
    tenantIsolation(),
  ],
);

/**
 * Automatic promotions (packages/core › promotions.ts): set on the dashboard, pulled by every till,
 * applied there to each line. Stopping one archives it.
 */
export const promotions = pgTable(
  'promotions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    percentBp: integer('percent_bp'),
    buyQty: integer('buy_qty'),
    getQty: integer('get_qty'),
    scope: text('scope').notNull(),
    categoryIds: uuid('category_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    productIds: uuid('product_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    daysOfWeek: integer('days_of_week')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    fromTime: text('from_time'),
    toTime: text('to_time'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'promotions_pkey', columns: [t.tenantId, t.id] }),
    index('promotions_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

/**
 * What the owner did with a cheque waiting in 1160 (services/cheques.ts): cashed into the bank or
 * bounced back onto the customer's account. The cheque itself is its payment (invoice_payments or
 * receipts with method cheque); this row is written once, with the journal entry it posted.
 */
export const chequeActions = pgTable(
  'cheque_actions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** sale (an invoice's payment) or receipt (a customer's payment) */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    /** The payment's number inside its sale; 1 for a receipt */
    paymentNo: integer('payment_no').notNull(),
    action: text('action').notNull(),
    actionDate: date('action_date').notNull(),
    note: text('note'),
    entryId: uuid('entry_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'cheque_actions_pkey', columns: [t.tenantId, t.id] }),
    unique('cheque_actions_payment_unique').on(t.tenantId, t.sourceType, t.sourceId, t.paymentNo),
    tenantIsolation(),
  ],
);

/**
 * A piece known by its serial number or IMEI (03 › الإلكترونيات): received in stock by a purchase,
 * sold by a sale line that names it. One row per number in the store.
 */
export const serials = pgTable(
  'serials',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    variantId: uuid('variant_id').notNull(),
    serial: text('serial').notNull(),
    /** in_stock or sold */
    status: text('status').notNull(),
    purchaseId: uuid('purchase_id'),
    saleId: uuid('sale_id'),
    soldOn: date('sold_on'),
    warrantyUntil: date('warranty_until'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'serials_pkey', columns: [t.tenantId, t.id] }),
    unique('serials_serial_unique').on(t.tenantId, t.serial),
    index('serials_variant_idx').on(t.tenantId, t.variantId),
    tenantIsolation(),
  ],
);

/**
 * Exchange vouchers (03 › الملابس: قسيمة الاستبدال): a return refunded as a voucher makes one, its
 * code the return's number; sales that spend it add to what was redeemed. Pulled by every till.
 */
export const vouchers = pgTable(
  'vouchers',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    returnId: uuid('return_id').notNull(),
    currency: text('currency').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    redeemedMinor: bigint('redeemed_minor', { mode: 'number' }).notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    changeXid: changeXid(),
  },
  (t) => [
    primaryKey({ name: 'vouchers_pkey', columns: [t.tenantId, t.id] }),
    unique('vouchers_code_unique').on(t.tenantId, t.code),
    index('vouchers_change_xid_idx').on(t.tenantId, t.changeXid, t.id),
    tenantIsolation(),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Pictures a store uploads (09 › uploads; 03 › الألبسة: صور القطع). Resized in the browser before
 * they come (the full picture at most 1600 px, a thumbnail at 400), checked by their first bytes,
 * and kept in the database, so the daily backup and the restore carry them with everything else.
 * Served by their id under the store's id, without sign-in: product pictures go on the shop's
 * public pages, and an id cannot be guessed.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind').notNull(),
    contentType: text('content_type').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    data: bytea('data').notNull(),
    thumb: bytea('thumb').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'uploads_pkey', columns: [t.tenantId, t.id] }),
    index('uploads_sha256_idx').on(t.tenantId, t.sha256),
    tenantIsolation(),
  ],
);

/** A product's pictures, in order; one may belong to an option value (a colour) of its pieces. */
export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id').notNull(),
    uploadId: uuid('upload_id').notNull(),
    /** «أحمر»: shown when that value is chosen; null for the product as a whole */
    optionValue: text('option_value'),
    sortOrder: integer('sort_order').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'product_images_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }),
    foreignKey({ columns: [t.tenantId, t.uploadId], foreignColumns: [uploads.tenantId, uploads.id] }),
    unique('product_images_upload_unique').on(t.tenantId, t.productId, t.uploadId),
    index('product_images_product_idx').on(t.tenantId, t.productId, t.sortOrder),
    tenantIsolation(),
  ],
);

/**
 * The store's online shop (26 › المتجر الإلكتروني): its own link (`slug`, unique across the
 * platform), off until the owner turns it on, the WhatsApp number orders go to, and how the goods
 * reach the customer. Found by its link without sign-in through shop_find_by_slug().
 */
export const onlineStores = pgTable(
  'online_stores',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    slug: text('slug').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    whatsapp: text('whatsapp'),
    delivery: boolean('delivery').notNull().default(true),
    pickup: boolean('pickup').notNull().default(true),
    /** «التوصيل داخل المدينة خلال يوم، 10,000 ل.س» */
    note: text('note'),
    showOutOfStock: boolean('show_out_of_stock').notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('online_stores_slug_unique').on(t.slug), tenantIsolation()],
);

/**
 * An order from the online shop (26 › حياة الطلب): what the customer put in the cart at the
 * server's prices, saved before WhatsApp opens, so it waits in the orders box even if the message
 * is never sent. Numbered ONL-000001 per store.
 */
export const onlineOrders = pgTable(
  'online_orders',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    seq: integer('seq').notNull(),
    number: text('number').notNull(),
    /** pending, accepted, rejected, done */
    status: text('status').notNull().default('pending'),
    /** whatsapp (the only one yet), shop */
    source: text('source').notNull().default('whatsapp'),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    /** delivery or pickup */
    fulfilment: text('fulfilment').notNull(),
    address: text('address'),
    note: text('note'),
    currency: text('currency').notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    lines: jsonb('lines').$type<OnlineOrderLine[]>().notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'online_orders_pkey', columns: [t.tenantId, t.id] }),
    unique('online_orders_seq_unique').on(t.tenantId, t.seq),
    index('online_orders_status_idx').on(t.tenantId, t.status, t.createdAt),
    tenantIsolation(),
  ],
);

export interface OnlineOrderLine {
  variantId: string;
  productId: string;
  name: string;
  label: string | null;
  qty: number;
  priceMinor: number;
  totalMinor: number;
}
