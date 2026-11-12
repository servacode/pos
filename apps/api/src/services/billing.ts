import { sql } from 'drizzle-orm';
import type {
  PaymentMethodInfo,
  PlanRow,
  PlatformLoginResponse,
  PlatformPayment,
  PlatformSettings,
  PlatformStore,
  SubscriptionInvoice,
  SubscriptionPage,
  SubscriptionPayment,
} from '@serva/core';
import { DEFAULT_GRACE_DAYS, lifecycleOf } from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { PasswordHasher } from '../auth/passwords';
import { requirePermission } from '../auth/permissions';
import {
  PLATFORM_TOKEN_TTL_SECONDS,
  signPlatformToken,
  type AccessClaims,
  type PlatformClaims,
  type TokenKeys,
} from '../auth/tokens';
import { AppError } from '../errors';

/**
 * The store's subscription and the platform panel (packages/core › contracts/billing.ts). The
 * store opens an invoice and reports a payment through two narrow database functions; the platform
 * team confirms it, sets plans and prices, and edits the payment instructions through platform_*
 * functions, each of which keeps its own audit row (migration 0019).
 */

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'validation_failed', message, fields);

function fromDb(error: unknown): never {
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
  const message = `${error instanceof Error ? error.message : ''} ${cause?.message ?? ''}`;
  if (message.includes('a payment is already waiting')) {
    throw new AppError(409, 'conflict', 'أرسلت دفعة لهذه الفاتورة وهي بانتظار التأكيد.');
  }
  if (message.includes('no open invoice')) throw badRequest('هذه الفاتورة ليست مفتوحة للدفع.');
  if (message.includes('unknown plan') || message.includes('has no price')) {
    throw badRequest('هذه الباقة غير متاحة للاشتراك.', { planCode: 'اختر باقة أخرى' });
  }
  if (message.includes('no pending payment')) throw badRequest('هذه الدفعة ليست بانتظار التأكيد.');
  if (message.includes('unknown store')) throw new AppError(404, 'not_found', 'هذا المتجر غير موجود.');
  throw error;
}

type PlanDb = {
  code: string;
  name: string;
  is_free: boolean;
  price_monthly_minor: string | null;
  price_yearly_minor: string | null;
  trial_days: number | null;
  is_active: boolean;
  limits: Record<string, number | null>;
};

const planRow = (p: PlanDb): PlanRow => ({
  code: p.code,
  name: p.name,
  isFree: p.is_free,
  priceMonthlyMinor: p.price_monthly_minor === null ? null : Number(p.price_monthly_minor),
  priceYearlyMinor: p.price_yearly_minor === null ? null : Number(p.price_yearly_minor),
  trialDays: p.trial_days,
  isActive: p.is_active,
  limits: p.limits ?? {},
});

async function plans(tx: Transaction | Database): Promise<PlanRow[]> {
  const rows = await tx.execute<PlanDb>(sql`
    select code, name, is_free, price_monthly_minor::text, price_yearly_minor::text, trial_days, is_active, limits
    from plans order by sort_order, code`);
  return rows.map(planRow);
}

async function settings(tx: Transaction | Database): Promise<{ methods: PaymentMethodInfo[]; rate: string }> {
  const [row] = await tx.execute<{ payment_methods: PaymentMethodInfo[]; syp_per_usd: string }>(
    sql`select payment_methods, syp_per_usd::text from platform_settings where id = 1`,
  );
  return { methods: row?.payment_methods ?? [], rate: row?.syp_per_usd ?? '0' };
}

// ─── The store ───────────────────────────────────────────────────────────────

async function storePage(tx: Transaction): Promise<SubscriptionPage> {
  const [sub] = await tx.execute<{
    status: SubscriptionPage['status'];
    code: string;
    name: string;
    billing_cycle: SubscriptionPage['billingCycle'];
    trial_ends_at: string | null;
    current_period_end: string | null;
    grace_ends_at: string | null;
  }>(sql`
    select s.status, p.code, p.name, s.billing_cycle, s.trial_ends_at, s.current_period_end, s.grace_ends_at
    from subscriptions s join plans p on p.id = s.plan_id limit 1`);
  if (!sub) throw new AppError(404, 'not_found', 'لا اشتراك لهذا المتجر.');
  const invoices = await tx.execute<{
    id: string;
    number: string;
    code: string;
    name: string;
    billing_cycle: SubscriptionInvoice['billingCycle'];
    usd_minor: string;
    syp_minor: string;
    status: SubscriptionInvoice['status'];
    created_at: string;
  }>(sql`
    select i.id, i.number, p.code, p.name, i.billing_cycle, i.usd_minor::text, i.syp_minor::text, i.status, i.created_at
    from subscription_invoices i join plans p on p.id = i.plan_id
    order by i.created_at desc limit 50`);
  const payments = await tx.execute<{
    id: string;
    number: string;
    invoice_id: string;
    method: string;
    transaction_ref: string;
    amount_minor: string;
    currency: SubscriptionPayment['currency'];
    status: SubscriptionPayment['status'];
    submitted_at: string;
    reason: string | null;
  }>(sql`
    select id, number, invoice_id, method, transaction_ref, amount_minor::text, currency, status, submitted_at, reason
    from subscription_payments order by submitted_at desc limit 50`);
  const { methods, rate } = await settings(tx);
  return {
    status: sub.status,
    planCode: sub.code,
    planName: sub.name,
    billingCycle: sub.billing_cycle,
    trialEndsAt: iso(sub.trial_ends_at),
    currentPeriodEnd: iso(sub.current_period_end),
    graceEndsAt: iso(sub.grace_ends_at),
    plans: (await plans(tx)).filter((p) => p.isActive && !p.isFree && p.priceMonthlyMinor !== null),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      planCode: i.code,
      planName: i.name,
      billingCycle: i.billing_cycle,
      usdMinor: Number(i.usd_minor),
      sypMinor: Number(i.syp_minor),
      status: i.status,
      createdAt: iso(i.created_at)!,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      number: p.number,
      invoiceId: p.invoice_id,
      method: p.method,
      transactionRef: p.transaction_ref,
      amountMinor: Number(p.amount_minor),
      currency: p.currency,
      status: p.status,
      submittedAt: iso(p.submitted_at)!,
      reason: p.reason,
    })),
    paymentMethods: methods.filter((m) => m.enabled),
    sypPerUsd: rate,
  };
}

export async function subscriptionPage(db: Database, auth: AccessClaims): Promise<SubscriptionPage> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'subscription.manage');
    return storePage(tx);
  });
}

export async function openInvoice(
  db: Database,
  auth: AccessClaims,
  input: { planCode: string; billingCycle: 'monthly' | 'yearly' },
  now: Date,
): Promise<SubscriptionInvoice> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'subscription.manage');
    const [row] = await tx
      .execute<{ id: string }>(
        sql`select subscription_invoice_open(${input.planCode}, ${input.billingCycle}::billing_cycle, ${now.toISOString()}::timestamptz) as id`,
      )
      .catch(fromDb);
    const page = await storePage(tx);
    return page.invoices.find((i) => i.id === row!.id)!;
  });
}

export async function reportPayment(
  db: Database,
  auth: AccessClaims,
  input: {
    invoiceId: string;
    method: string;
    transactionRef: string;
    amountMinor: number;
    currency: 'USD' | 'SYP';
  },
  now: Date,
): Promise<SubscriptionPayment> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'subscription.manage');
    const [row] = await tx
      .execute<{ id: string }>(
        sql`select subscription_payment_submit(${input.invoiceId}::uuid, ${input.method}, ${input.transactionRef},
              ${input.amountMinor}::bigint, ${input.currency}, ${auth.userId}::uuid, ${now.toISOString()}::timestamptz) as id`,
      )
      .catch(fromDb);
    const page = await storePage(tx);
    return page.payments.find((p) => p.id === row!.id)!;
  });
}

// ─── The platform ────────────────────────────────────────────────────────────

const signInFailed = () => new AppError(401, 'invalid_credentials', 'البريد أو كلمة السر غير صحيحة.');

export async function platformLogin(
  db: Database,
  passwords: PasswordHasher,
  keys: TokenKeys,
  input: { email: string; password: string },
  now: Date,
): Promise<PlatformLoginResponse> {
  const [user] = await db.execute<{
    id: string;
    full_name: string;
    password_hash: string;
    role: PlatformClaims['role'];
    status: 'active' | 'disabled';
  }>(sql`select * from platform_user_for_login(${input.email})`);
  if (!user || user.status !== 'active') {
    await passwords.verifyAgainstDummy(input.password);
    throw signInFailed();
  }
  if (!(await passwords.verify(user.password_hash, input.password))) throw signInFailed();
  const token = await signPlatformToken({ platformUserId: user.id, role: user.role }, keys, now);
  return {
    token,
    expiresAt: new Date(now.getTime() + PLATFORM_TOKEN_TTL_SECONDS * 1000).toISOString(),
    user: { id: user.id, fullName: user.full_name, role: user.role },
  };
}

/**
 * The stored status says what the platform team set; the dates say what is true now (nothing moves
 * a store to past_due or suspended in the background). The list shows the truth: a store past its
 * period but inside its grace is «past_due», one beyond it is «suspended» (read-only).
 */
function effectiveStatus(
  r: {
    status: PlatformStore['status'];
    trial_ends_at: string | null;
    current_period_end: string | null;
    grace_ends_at: string | null;
    updated_at: string | null;
    grace_days: number | null;
  },
  now: Date,
): PlatformStore['status'] {
  if (!r.status) return r.status;
  const d = (v: string | null) => (v === null ? null : new Date(v));
  const life = lifecycleOf(
    {
      status: r.status,
      trialEndsAt: d(r.trial_ends_at),
      currentPeriodEnd: d(r.current_period_end),
      graceEndsAt: d(r.grace_ends_at),
      updatedAt: d(r.updated_at),
      graceDays: r.grace_days ?? DEFAULT_GRACE_DAYS,
    },
    now,
  );
  if (life.readOnly) return r.status === 'cancelled' ? 'cancelled' : 'suspended';
  if (life.state === 'grace') return 'past_due';
  return r.status === 'past_due' ? 'active' : r.status;
}

export async function platformStores(
  db: Database,
  now: Date = new Date(),
): Promise<{ items: PlatformStore[] }> {
  const rows = await db.execute<{
    tenant_id: string;
    name: string;
    store_code: string;
    owner_phone: string | null;
    created_at: string;
    tenant_status: PlatformStore['tenantStatus'];
    plan_code: string | null;
    plan_name: string | null;
    status: PlatformStore['status'];
    billing_cycle: PlatformStore['billingCycle'];
    trial_ends_at: string | null;
    current_period_end: string | null;
    grace_ends_at: string | null;
    pending_payments: string;
    last_sale: string | null;
    grace_days: number | null;
    updated_at: string | null;
  }>(sql`
    select s.*, p.grace_days, sub.updated_at
    from platform_stores() s
    left join subscriptions sub on sub.tenant_id = s.tenant_id
    left join plans p on p.id = sub.plan_id`);
  return {
    items: rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      storeCode: r.store_code,
      ownerPhone: r.owner_phone,
      createdAt: iso(r.created_at)!,
      tenantStatus: r.tenant_status,
      planCode: r.plan_code,
      planName: r.plan_name,
      status: effectiveStatus(r, now),
      billingCycle: r.billing_cycle,
      trialEndsAt: iso(r.trial_ends_at),
      currentPeriodEnd: iso(r.current_period_end),
      graceEndsAt: iso(r.grace_ends_at),
      pendingPayments: Number(r.pending_payments),
      lastSale: r.last_sale ? String(r.last_sale).slice(0, 10) : null,
    })),
  };
}

export async function platformPayments(
  db: Database,
  status: string | null,
): Promise<{ items: PlatformPayment[] }> {
  const rows = await db.execute<{
    id: string;
    tenant_id: string;
    store_name: string;
    number: string;
    invoice_number: string;
    plan_name: string;
    billing_cycle: PlatformPayment['billingCycle'];
    method: string;
    transaction_ref: string;
    amount_minor: string;
    currency: PlatformPayment['currency'];
    invoice_usd_minor: string;
    invoice_syp_minor: string;
    status: PlatformPayment['status'];
    submitted_at: string;
    reason: string | null;
  }>(sql`select * from platform_payments(${status})`);
  return {
    items: rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      storeName: r.store_name,
      number: r.number,
      invoiceNumber: r.invoice_number,
      planName: r.plan_name,
      billingCycle: r.billing_cycle,
      method: r.method,
      transactionRef: r.transaction_ref,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      invoiceUsdMinor: Number(r.invoice_usd_minor),
      invoiceSypMinor: Number(r.invoice_syp_minor),
      status: r.status,
      submittedAt: iso(r.submitted_at)!,
      reason: r.reason,
    })),
  };
}

/** Only the general manager and the platform accountant touch money; support reads. */
function mayDecide(claims: PlatformClaims): void {
  if (claims.role === 'support') throw new AppError(403, 'forbidden', 'هذا الإجراء للمدير أو المحاسب.');
}

export async function decidePayment(
  db: Database,
  claims: PlatformClaims,
  paymentId: string,
  confirm: boolean,
  reason: string | null,
  now: Date,
): Promise<{ tenantId: string | null }> {
  mayDecide(claims);
  // Whose payment it is, to release that store's held documents once it can write again
  const pending = await platformPayments(db, 'pending');
  const tenantId = pending.items.find((p) => p.id === paymentId)?.tenantId ?? null;
  await db
    .execute(
      sql`select platform_payment_decide(${paymentId}::uuid, ${claims.platformUserId}::uuid, ${confirm}, ${reason}, ${now.toISOString()}::timestamptz)`,
    )
    .catch(fromDb);
  return { tenantId };
}

export async function setSubscription(
  db: Database,
  claims: PlatformClaims,
  tenantId: string,
  input: { planCode: string; status: string; currentPeriodEnd: string },
  now: Date,
): Promise<void> {
  mayDecide(claims);
  await db
    .execute(
      sql`select platform_subscription_set(${tenantId}::uuid, ${input.planCode}, ${input.status}::subscription_status,
            ${input.currentPeriodEnd}::timestamptz, ${claims.platformUserId}::uuid, ${now.toISOString()}::timestamptz)`,
    )
    .catch(fromDb);
}

export const platformPlans = async (db: Database) => ({ items: await plans(db) });

export async function savePlan(
  db: Database,
  claims: PlatformClaims,
  code: string,
  input: {
    name: string;
    priceMonthlyMinor: number | null;
    priceYearlyMinor: number | null;
    trialDays: number | null;
    isActive: boolean;
  },
): Promise<void> {
  if (claims.role !== 'super_admin') throw new AppError(403, 'forbidden', 'الباقات والأسعار للمدير العام.');
  await db
    .execute(
      sql`select platform_plan_save(${code}, ${input.name}, ${input.priceMonthlyMinor}::bigint, ${input.priceYearlyMinor}::bigint,
            ${input.trialDays}::integer, ${input.isActive}, ${claims.platformUserId}::uuid)`,
    )
    .catch(fromDb);
}

export async function platformSettings(db: Database): Promise<PlatformSettings> {
  const { methods, rate } = await settings(db);
  return { paymentMethods: methods, sypPerUsd: rate };
}

export async function savePlatformSettings(
  db: Database,
  claims: PlatformClaims,
  input: PlatformSettings,
): Promise<void> {
  if (claims.role !== 'super_admin')
    throw new AppError(403, 'forbidden', 'طرق الدفع وسعر الصرف للمدير العام.');
  await db.execute(
    sql`select platform_settings_save(${JSON.stringify(input.paymentMethods)}::jsonb, ${input.sypPerUsd}::numeric, ${claims.platformUserId}::uuid)`,
  );
}
