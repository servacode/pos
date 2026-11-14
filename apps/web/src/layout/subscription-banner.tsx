import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { MeResponse, TillSubscription } from '@serva/core';
import { Banner, type BannerTone, cn, WarningIcon } from '@serva/ui';
import { apiFetch } from '../lib/api';
import { formatDays } from '../lib/format';

/**
 * What the subscription's state tells the person (07 › دورة حياة الاشتراك). The server derives the
 * state from the dates (`lifecycle`, `readOnly`, days left); this only words it:
 *
 *   trial or period ending within 3 days → a quiet warning with the days left
 *   grace (period over, still selling)   → a warning, «ادفع الآن», the days of grace left
 *   read-only (grace over)               → an alert that says what still works and how to come back
 */

/** Days before the end when the warning starts */
export const ENDING_SOON_DAYS = 3;

export interface SubscriptionFacts {
  lifecycle: TillSubscription['lifecycle'];
  readOnly: boolean;
  /** Days until the period ends, or until selling stops once in grace; null when unlimited */
  daysLeft: number | null;
}

export interface BannerSpec {
  tone: BannerTone;
  title: string;
  detail: string;
  /** read-only: the page of the owner, and the words of the cashier */
  kind: 'ending' | 'grace' | 'read_only';
}

type Fmt = MeResponse['settings']['numberFormat'];

export function bannerFor(facts: SubscriptionFacts, numberFormat: Fmt = 'latn'): BannerSpec | null {
  const left = facts.daysLeft;
  const days = left === null ? '' : formatDays(left, numberFormat);
  if (facts.readOnly || facts.lifecycle === 'read_only') {
    return {
      kind: 'read_only',
      tone: 'danger',
      title: 'المتجر الآن للقراءة والتصدير فقط',
      detail:
        'انتهى الاشتراك ومهلة السماح. تستطيع عرض بياناتك وتصديرها، ولا بيع ولا تعديل حتى يتجدد الاشتراك. لا شيء محذوف، وكل شيء يعود فور الدفع.',
    };
  }
  if (facts.lifecycle === 'grace') {
    return {
      kind: 'grace',
      tone: 'warning',
      title: 'انتهى اشتراكك وأنت في مهلة السماح',
      detail:
        left === null
          ? 'ادفع الآن ليبقى البيع شغّالاً.'
          : left <= 0
            ? 'ينتهي البيع اليوم، ثم يصير المتجر للقراءة فقط. ادفع الآن.'
            : `باقي ${days} على البيع، ثم يصير المتجر للقراءة فقط. ادفع الآن.`,
    };
  }
  if (
    (facts.lifecycle === 'trialing' || facts.lifecycle === 'active') &&
    left !== null &&
    left <= ENDING_SOON_DAYS
  ) {
    const what = facts.lifecycle === 'trialing' ? 'تجربتك المجانية' : 'اشتراكك';
    return {
      kind: 'ending',
      tone: 'warning',
      title: left <= 0 ? `تنتهي ${what} اليوم` : `تنتهي ${what} خلال ${days}`,
      detail: 'اختر باقة وادفع ليبقى متجرك شغّالاً دون انقطاع.',
    };
  }
  return null;
}

/** The facts the admin app has, from /v1/me */
export const factsOfMe = (s: MeResponse['subscription']): SubscriptionFacts => ({
  lifecycle: s.lifecycle,
  readOnly: s.readOnly,
  daysLeft: s.graceDaysLeft ?? s.daysLeft,
});

/** The bar at the top of every admin page. `canPay`: the person holds subscription.manage. */
export function SubscriptionBanner({
  subscription,
  numberFormat,
  canPay,
  className,
}: {
  subscription: MeResponse['subscription'];
  numberFormat: Fmt;
  canPay: boolean;
  className?: string;
}) {
  const spec = bannerFor(factsOfMe(subscription), numberFormat);
  if (!spec) return null;
  return (
    <Banner
      tone={spec.tone}
      title={spec.title}
      className={className}
      action={
        canPay ? (
          <Link
            to="/subscription"
            className="inline-flex min-h-10 items-center rounded-control bg-surface px-3 text-sm font-semibold text-ink shadow-sm"
          >
            ادفع الآن
          </Link>
        ) : null
      }
    >
      <span className="font-normal">
        {spec.detail}
        {canPay ? null : ' اطلب من مالك المتجر أو مديره أن يدفع من صفحة الاشتراك.'}
      </span>
    </Banner>
  );
}

// ── The till ─────────────────────────────────────────────────────────────────────────────────────

const TILL_KEY = 'serva.till.subscription';
/** How often the till asks again while it is open and online */
const TILL_REFRESH_MS = 10 * 60_000;

function readKept(): TillSubscription | null {
  try {
    const raw = globalThis.localStorage?.getItem(TILL_KEY);
    return raw ? (JSON.parse(raw) as TillSubscription) : null;
  } catch {
    return null;
  }
}

/**
 * The till's view of the subscription: asked with the device token, kept on the device so it shows
 * the last known state offline. A failed request keeps what it had; it never blocks selling (the
 * server decides what it accepts).
 */
export function useTillSubscription(token: string | null | undefined): TillSubscription | null {
  const [state, setState] = useState<TillSubscription | null>(readKept);
  useEffect(() => {
    if (!token) return;
    let current = true;
    const ask = () =>
      apiFetch<TillSubscription>('/v1/device/subscription', { authorization: `Device ${token}` }).then(
        (fresh) => {
          if (!current) return;
          setState(fresh);
          try {
            globalThis.localStorage?.setItem(TILL_KEY, JSON.stringify(fresh));
          } catch {
            // Storage blocked: the answer holds for this session only.
          }
        },
        () => undefined,
      );
    void ask();
    const timer = window.setInterval(() => void ask(), TILL_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [token]);
  return state;
}

/**
 * A chip in the till's status bar (the kit keeps banners out of the sale screen): the same words,
 * short. The cashier cannot pay, so it says who can.
 */
export function SubscriptionChip({
  subscription,
  className,
}: {
  subscription: TillSubscription | null;
  className?: string;
}): ReactNode {
  const spec = subscription ? bannerFor(subscription) : null;
  if (!spec) return null;
  const text =
    spec.kind === 'read_only'
      ? 'الاشتراك منتهٍ: للقراءة فقط. أخبر المالك'
      : spec.kind === 'grace'
        ? 'الاشتراك منتهٍ: مهلة السماح. أخبر المالك'
        : spec.title;
  return (
    <span
      role={spec.kind === 'read_only' ? 'alert' : 'status'}
      title={spec.detail}
      className={cn(
        'inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold',
        spec.tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-warning-soft text-warning-ink',
        className,
      )}
    >
      <WarningIcon size={16} className="shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}
