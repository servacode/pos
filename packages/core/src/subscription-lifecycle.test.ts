import { describe, expect, it } from 'vitest';
import {
  acceptsDocumentMadeAt,
  lifecycleOf,
  OFFLINE_TOLERANCE_MS,
  type SubscriptionFacts,
} from './subscription-lifecycle';

const D = 86_400_000;
const at = (iso: string) => new Date(iso);
const facts = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  status: 'active',
  trialEndsAt: null,
  currentPeriodEnd: at('2026-11-10T12:00:00.000Z'),
  graceEndsAt: null,
  updatedAt: at('2026-10-10T12:00:00.000Z'),
  graceDays: 7,
  ...over,
});
const END = at('2026-11-10T12:00:00.000Z');
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe('lifecycleOf', () => {
  it('is active on the last instant of the period and in grace one millisecond later', () => {
    expect(lifecycleOf(facts(), END)).toMatchObject({ state: 'active', readOnly: false, daysLeft: 0 });
    expect(lifecycleOf(facts(), plus(END, 1))).toMatchObject({
      state: 'grace',
      readOnly: false,
      daysLeft: 7,
    });
  });

  it('keeps selling through the 7 grace days and is read-only one millisecond after', () => {
    const graceEnd = plus(END, 7 * D);
    expect(lifecycleOf(facts(), graceEnd)).toMatchObject({ state: 'grace', readOnly: false, daysLeft: 0 });
    const after = lifecycleOf(facts(), plus(graceEnd, 1));
    expect(after).toMatchObject({ state: 'read_only', readOnly: true });
    expect(after.writeUntil).toEqual(graceEnd);
  });

  it('counts a trial like a period and uses the plan grace days', () => {
    const t = facts({
      status: 'trialing',
      trialEndsAt: END,
      currentPeriodEnd: at('2030-01-01T00:00:00Z'),
      graceDays: 3,
    });
    expect(lifecycleOf(t, plus(END, -2 * D)).state).toBe('trialing');
    expect(lifecycleOf(t, plus(END, 2 * D)).state).toBe('grace');
    expect(lifecycleOf(t, plus(END, 3 * D + 1)).state).toBe('read_only');
  });

  it('days are 24 hours: the same instant gives the same answer in any time zone', () => {
    // Midnight in Damascus (+03:00) and the same instant written in UTC and in New York
    const damascus = at('2026-11-11T00:00:00+03:00');
    const utc = at('2026-11-10T21:00:00Z');
    const newYork = at('2026-11-10T16:00:00-05:00');
    for (const end of [damascus, utc, newYork]) {
      const f = facts({ currentPeriodEnd: end });
      expect(lifecycleOf(f, at('2026-11-11T00:00:00+03:00')).state).toBe('active');
      expect(lifecycleOf(f, at('2026-11-11T00:00:00.001+03:00')).state).toBe('grace');
      expect(lifecycleOf(f, at('2026-11-18T00:00:00+03:00')).state).toBe('grace');
      expect(lifecycleOf(f, at('2026-11-18T00:00:00.001+03:00')).state).toBe('read_only');
    }
  });

  it('a reported payment gives 72 hours even after the grace, and a rejection (null) takes them back', () => {
    const lapsed = at('2026-12-01T00:00:00Z'); // well past end + 7 days
    expect(lifecycleOf(facts(), lapsed).readOnly).toBe(true);
    const reported = facts({ graceEndsAt: plus(lapsed, 72 * 3_600_000) });
    const during = lifecycleOf(reported, plus(lapsed, 71 * 3_600_000));
    expect(during).toMatchObject({ state: 'grace', readOnly: false, provisional: true });
    expect(lifecycleOf(reported, plus(lapsed, 72 * 3_600_000 + 1)).readOnly).toBe(true);
    expect(lifecycleOf(facts({ graceEndsAt: null }), plus(lapsed, 1)).readOnly).toBe(true);
  });

  it('a stored suspension is read-only at once, except during a provisional activation', () => {
    const now = at('2026-11-01T00:00:00Z'); // inside the paid period
    const s = lifecycleOf(facts({ status: 'suspended', updatedAt: at('2026-10-31T00:00:00Z') }), now);
    expect(s).toMatchObject({ state: 'read_only', readOnly: true });
    expect(s.writeUntil).toEqual(at('2026-10-31T00:00:00Z'));
    const paying = facts({ status: 'suspended', graceEndsAt: plus(now, 72 * 3_600_000) });
    expect(lifecycleOf(paying, now).readOnly).toBe(false);
  });

  it('a subscription with no end never expires', () => {
    const f = facts({ currentPeriodEnd: null });
    expect(lifecycleOf(f, at('2099-01-01T00:00:00Z'))).toMatchObject({
      state: 'active',
      readOnly: false,
      daysLeft: null,
    });
  });
});

describe('acceptsDocumentMadeAt', () => {
  const readOnly = lifecycleOf(facts(), at('2026-12-01T00:00:00Z'));
  const cutOff = plus(END, 7 * D);

  it('takes everything while the store sells', () => {
    expect(acceptsDocumentMadeAt(lifecycleOf(facts(), END), at('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('takes what was made before the cut-off, and up to 24 hours after it, once read-only', () => {
    expect(acceptsDocumentMadeAt(readOnly, plus(cutOff, -D))).toBe(true);
    expect(acceptsDocumentMadeAt(readOnly, plus(cutOff, OFFLINE_TOLERANCE_MS))).toBe(true);
    expect(acceptsDocumentMadeAt(readOnly, plus(cutOff, OFFLINE_TOLERANCE_MS + 1))).toBe(false);
  });
});
