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
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [tenantIsolation(sql`id`)],
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
 * rep's phone, a waiter's device, a price checker, a kitchen screen, a branch hub. The minimum for
 * sync now; pairing, approval and licences (17 › الأجهزة) add to it.
 *
 * The 3-digit code goes into every document number the device issues (INV-001-002-0000154). It is
 * reserved at activation and never reused in its branch, so a re-activated device gets a new one.
 * The device token is stored only as a hash and found through device_find_by_token_hash().
 */
export const devices = pgTable(
  'devices',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** cashier, android_pos, rep_phone, waiter, price_checker, kitchen_screen, call_screen, hub */
    kind: text('kind').notNull().default('cashier'),
    /** browser, windows, android, ios */
    platform: text('platform').notNull().default('browser'),
    /** sha256 of the device token; null until activated */
    tokenHash: text('token_hash'),
    /** Public key of the device's own key pair (pairing, licences) */
    publicKey: text('public_key'),
    /** Revoked (lost or stolen): documents after its last announced number are quarantined */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
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
    unique('devices_branch_code_unique').on(t.tenantId, t.branchId, t.code),
    uniqueIndex('devices_token_hash_unique')
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
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
    pinHash: text('pin_hash'),
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
