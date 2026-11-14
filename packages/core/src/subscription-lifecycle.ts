/**
 * The effective state of a store's subscription, derived from its dates alone (07 › دورة حياة
 * الاشتراك). One pure function, used by the API for every decision (write gate, sync push, /v1/me,
 * the platform list), so no cron has to move a store from one state to the next: the answer is
 * the same whenever and wherever it is asked.
 *
 *   trialing / active : now is on or before the end of the trial or the paid period
 *   grace             : the period ended, the grace days (plans.grace_days, 7 by default) or the
 *                       72-hour provisional activation after a reported payment are not over:
 *                       the store still sells, with a warning bar
 *   read_only         : both are over (or the platform suspended the subscription): the store
 *                       reads and exports everything, and sells and edits nothing. Nothing is deleted.
 *
 * Every date is an instant (UTC). A "day" is 24 hours, never a calendar day, so the answer does
 * not depend on the server's or the store's time zone: a period ending at 21:00 UTC (midnight in
 * Damascus) ends at that instant everywhere. Ends are inclusive: at the exact end the store is
 * still in its period, one millisecond later it is not.
 */
const DAY_MS = 86_400_000;

/** Used when the plan does not say (plans.grace_days defaults to 7) */
export const DEFAULT_GRACE_DAYS = 7;

/**
 * Offline sales made before the cut-off must never be lost (07 › لا إيقاف في منتصف وردية): once a
 * store is read-only, a synced document is still accepted when it was made on the device before
 * the end of the grace plus this tolerance (24 hours, the same as an open shift's). Its time is the
 * device clock corrected by the offset the device announced.
 */
export const OFFLINE_TOLERANCE_MS = DAY_MS;

export type LifecycleState = 'trialing' | 'active' | 'grace' | 'read_only';

export interface SubscriptionFacts {
  /** The stored status (subscriptions.status) */
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  /** Set by a reported payment to now + 72 hours (provisional activation) */
  graceEndsAt: Date | null;
  /** When the row last changed: the cut-off for a store suspended by hand inside its period */
  updatedAt: Date | null;
  graceDays: number;
}

export interface Lifecycle {
  state: LifecycleState;
  readOnly: boolean;
  /** End of the trial or paid period; null when the subscription has none */
  endsAt: Date | null;
  /** Last instant of selling (end of grace); null when there is no limit */
  writeUntil: Date | null;
  /** True while only a reported payment keeps the store selling (72-hour provisional activation) */
  provisional: boolean;
  /** Whole days (rounded up) until the period ends, or until selling stops once in grace; null when unlimited */
  daysLeft: number | null;
}

const latest = (a: Date | null, b: Date | null): Date | null =>
  a && b ? (a.getTime() >= b.getTime() ? a : b) : (a ?? b);
const earliest = (a: Date | null, b: Date | null): Date | null =>
  a && b ? (a.getTime() <= b.getTime() ? a : b) : (a ?? b);
const days = (to: Date, now: Date) => Math.max(0, Math.ceil((to.getTime() - now.getTime()) / DAY_MS));

export function lifecycleOf(facts: SubscriptionFacts, now: Date): Lifecycle {
  const endsAt =
    facts.status === 'trialing' ? (facts.trialEndsAt ?? facts.currentPeriodEnd) : facts.currentPeriodEnd;
  const graceDays = Math.max(0, facts.graceDays);
  const afterGrace = endsAt ? new Date(endsAt.getTime() + graceDays * DAY_MS) : null;
  const writeUntil = latest(afterGrace, facts.graceEndsAt);
  const t = now.getTime();
  const provisional = facts.graceEndsAt !== null && t <= facts.graceEndsAt.getTime();

  if (facts.status === 'suspended') {
    // Suspended by the platform. A reported payment still switches it on for 72 hours.
    if (provisional) {
      return {
        state: 'grace',
        readOnly: false,
        endsAt,
        writeUntil: facts.graceEndsAt,
        provisional,
        daysLeft: days(facts.graceEndsAt!, now),
      };
    }
    return {
      state: 'read_only',
      readOnly: true,
      endsAt,
      writeUntil: earliest(writeUntil, facts.updatedAt),
      provisional: false,
      daysLeft: 0,
    };
  }

  if (!endsAt) {
    // Nothing to expire (a free, unlimited or hand-set subscription)
    const state = facts.status === 'trialing' ? 'trialing' : facts.status === 'past_due' ? 'grace' : 'active';
    return { state, readOnly: false, endsAt: null, writeUntil: null, provisional: false, daysLeft: null };
  }

  if (t <= endsAt.getTime()) {
    const state: LifecycleState =
      facts.status === 'past_due' ? 'grace' : facts.status === 'trialing' ? 'trialing' : 'active';
    return { state, readOnly: false, endsAt, writeUntil, provisional: false, daysLeft: days(endsAt, now) };
  }
  if (writeUntil && t <= writeUntil.getTime()) {
    // Over the period, inside the grace days or the provisional activation
    const byPayment = provisional && t > (afterGrace?.getTime() ?? 0);
    return {
      state: 'grace',
      readOnly: false,
      endsAt,
      writeUntil,
      provisional: byPayment,
      daysLeft: days(writeUntil, now),
    };
  }
  return { state: 'read_only', readOnly: true, endsAt, writeUntil, provisional: false, daysLeft: 0 };
}

/** The provisional activation a reported payment gives (subscription_payment_submit) */
export const PROVISIONAL_MS = 72 * 3_600_000;

/** What the sync gate needs to know of a reported payment */
export interface PaymentFact {
  status: string;
  submittedAt: Date;
  decidedAt: Date | null;
}

/** A stretch of time in which the store was writable only because a payment had been reported */
export interface WritableWindow {
  from: Date;
  until: Date;
}

/**
 * The provisional windows the store's payments gave, from the payments themselves (the one place
 * that keeps them after a rejection clears grace_ends_at): from the report to 72 hours later, cut
 * short at the rejection. A report made after an earlier payment was rejected gave no window
 * (the database function refuses it too).
 */
export function provisionalWindows(payments: readonly PaymentFact[]): WritableWindow[] {
  const windows: WritableWindow[] = [];
  for (const p of payments) {
    const barred = payments.some(
      (q) =>
        q !== p &&
        q.status === 'rejected' &&
        q.decidedAt !== null &&
        q.decidedAt.getTime() <= p.submittedAt.getTime(),
    );
    if (barred) continue;
    let until = p.submittedAt.getTime() + PROVISIONAL_MS;
    if (p.status === 'rejected' && p.decidedAt) until = Math.min(until, p.decidedAt.getTime());
    windows.push({ from: p.submittedAt, until: new Date(until) });
  }
  return windows;
}

/**
 * Whether the server still takes a document a device made at `deviceTime` (its clock, already
 * corrected by its offset). Everything is taken while the store sells; once it is read-only, only
 * what was made before the cut-off plus the tolerance, or while a reported payment had switched
 * the store on (`windows`: sold then, pushed after the window closed or the payment was rejected).
 */
export function acceptsDocumentMadeAt(
  life: Lifecycle,
  deviceTime: Date,
  windows: readonly WritableWindow[] = [],
): boolean {
  if (!life.readOnly) return true;
  const t = deviceTime.getTime();
  if (windows.some((w) => t >= w.from.getTime() && t <= w.until.getTime() + OFFLINE_TOLERANCE_MS)) {
    return true;
  }
  if (!life.writeUntil) return false;
  return t <= life.writeUntil.getTime() + OFFLINE_TOLERANCE_MS;
}

/** What a till (device sign-in, no user) is told about the subscription: GET /v1/device/subscription */
export interface TillSubscription {
  lifecycle: LifecycleState;
  readOnly: boolean;
  /** Whole days until the period ends, or until selling stops once in grace; null when unlimited */
  daysLeft: number | null;
  writeUntil: string | null;
}
