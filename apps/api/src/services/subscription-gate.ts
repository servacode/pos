import { sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_GRACE_DAYS,
  lifecycleOf,
  type Lifecycle,
  type SubscriptionFacts,
  type TillSubscription,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import { AppError } from '../errors';

/**
 * Where the subscription's lifecycle (packages/core › subscription-lifecycle) is applied to the
 * store's rows: the write gate for the admin API and the devices, and the plan limits. The state is
 * derived from dates on every call, so nothing has to run in the background.
 */

export const readOnlyError = () =>
  new AppError(
    402,
    'subscription_read_only',
    'انتهى اشتراك المتجر وانتهت مهلة السماح، فالمتجر الآن للقراءة والتصدير فقط. بياناتك محفوظة كاملة، وتعود للعمل فور الدفع من صفحة الاشتراك.',
  );

type FactsRow = {
  status: SubscriptionFacts['status'];
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_ends_at: string | null;
  updated_at: string | null;
  grace_days: number | null;
  limits: Record<string, number | null> | null;
};

const date = (v: string | null) => (v === null ? null : new Date(v));

/** The store's subscription facts and plan limits, read inside the store's own transaction. */
export async function readFacts(
  tx: Transaction,
): Promise<{ facts: SubscriptionFacts; limits: Record<string, number | null> } | null> {
  const [row] = await tx.execute<FactsRow>(sql`
    select s.status, s.trial_ends_at, s.current_period_end, s.grace_ends_at, s.updated_at, p.grace_days, p.limits
    from subscriptions s join plans p on p.id = s.plan_id limit 1`);
  if (!row) return null;
  return {
    facts: {
      status: row.status,
      trialEndsAt: date(row.trial_ends_at),
      currentPeriodEnd: date(row.current_period_end),
      graceEndsAt: date(row.grace_ends_at),
      updatedAt: date(row.updated_at),
      graceDays: row.grace_days ?? DEFAULT_GRACE_DAYS,
    },
    limits: row.limits ?? {},
  };
}

/** A store with no subscription row (never started) is left alone: there is nothing to enforce. */
export async function lifecycleInTx(tx: Transaction, now: Date): Promise<Lifecycle | null> {
  const found = await readFacts(tx);
  return found ? lifecycleOf(found.facts, now) : null;
}

export async function lifecycleOfStore(db: Database, tenantId: string, now: Date): Promise<Lifecycle | null> {
  return withTenant(db, tenantId, (tx) => lifecycleInTx(tx, now));
}

/** What the till shows in its status bar (GET /v1/device/subscription) */
export async function tillSubscription(
  db: Database,
  tenantId: string,
  now: Date,
  enforce: boolean,
): Promise<TillSubscription> {
  const life = await lifecycleOfStore(db, tenantId, now);
  if (!life) return { lifecycle: 'active', readOnly: false, daysLeft: null, writeUntil: null };
  return {
    lifecycle: life.state,
    readOnly: enforce && life.readOnly,
    daysLeft: life.daysLeft,
    writeUntil: life.writeUntil?.toISOString() ?? null,
  };
}

/** Refuses a write of a read-only store with 402 subscription_read_only. */
export async function assertStoreWritable(
  db: Database,
  tenantId: string,
  now: Date,
  enforce: boolean,
): Promise<void> {
  if (!enforce) return;
  const life = await lifecycleOfStore(db, tenantId, now);
  if (life?.readOnly) throw readOnlyError();
}

// ─── Plan limits ─────────────────────────────────────────────────────────────

type LimitKind = 'users' | 'registers' | 'branches';

const LIMIT_TEXT: Record<LimitKind, { count: SQL; message: (limit: number) => string }> = {
  users: {
    count: sql`select count(*)::int as n from users where status = 'active'`,
    message: (n) =>
      `وصلت باقتك إلى حدّها: ${n} مستخدمين فعّالين. أوقف مستخدماً أو انتقل إلى باقة أعلى من صفحة الاشتراك.`,
  },
  registers: {
    count: sql`select count(*)::int as n from devices where status = 'active' and revoked_at is null`,
    message: (n) =>
      `وصلت باقتك إلى حدّها: ${n} أجهزة كاشير فعّالة. أوقف جهازاً أو انتقل إلى باقة أعلى من صفحة الاشتراك.`,
  },
  branches: {
    count: sql`select count(*)::int as n from branches where is_active`,
    message: (n) => `وصلت باقتك إلى حدّها: ${n} فروع. انتقل إلى باقة أعلى من صفحة الاشتراك.`,
  },
};

/**
 * Refuses to ADD one more of `kind` when the plan's limit is already reached (null or missing
 * limit = unlimited). Rows over the limit that already exist, for example after a downgrade, are
 * never touched: only new ones are refused. Call it inside the transaction that inserts.
 */
export async function assertWithinPlanLimit(tx: Transaction, kind: LimitKind): Promise<void> {
  const found = await readFacts(tx);
  const limit = found?.limits[kind];
  if (limit === null || limit === undefined) return;
  const [row] = await tx.execute<{ n: number }>(LIMIT_TEXT[kind].count);
  if ((row?.n ?? 0) >= limit) {
    throw new AppError(403, 'plan_limit_reached', LIMIT_TEXT[kind].message(limit));
  }
}
