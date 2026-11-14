import { describe, expect, it } from 'vitest';
import {
  acceptsDocumentMadeAt,
  lifecycleOf,
  OFFLINE_TOLERANCE_MS,
  PROVISIONAL_MS,
  provisionalWindows,
  type PaymentFact,
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

describe('provisional windows of reported payments', () => {
  const P = at('2026-11-20T09:00:00.000Z');
  const pay = (status: string, submittedAt: Date, decidedAt: Date | null = null): PaymentFact => ({
    status,
    submittedAt,
    decidedAt,
  });
  const suspended = lifecycleOf(
    facts({ status: 'suspended', updatedAt: at('2026-11-01T00:00:00Z') }),
    at('2026-12-01T00:00:00Z'),
  );

  it('a report gives 72 hours from the report; a rejection cuts it short', () => {
    expect(provisionalWindows([])).toEqual([]);
    expect(provisionalWindows([pay('pending', P)])).toEqual([{ from: P, until: plus(P, PROVISIONAL_MS) }]);
    expect(provisionalWindows([pay('rejected', P, plus(P, 3_600_000))])).toEqual([
      { from: P, until: plus(P, 3_600_000) },
    ]);
    // Rejected after the 72 hours ran out: the window is still the 72 hours
    expect(provisionalWindows([pay('rejected', P, plus(P, 5 * D))])).toEqual([
      { from: P, until: plus(P, PROVISIONAL_MS) },
    ]);
    expect(provisionalWindows([pay('confirmed', P, plus(P, D))])).toEqual([
      { from: P, until: plus(P, PROVISIONAL_MS) },
    ]);
  });

  it('a report made after an earlier rejection gave no window', () => {
    const first = pay('rejected', P, plus(P, D));
    const later = pay('pending', plus(P, 2 * D));
    expect(provisionalWindows([first, later])).toEqual([{ from: P, until: plus(P, D) }]);
    // A rejection with no decision time cannot bar anyone
    expect(provisionalWindows([pay('rejected', P), later]).map((w) => w.from)).toEqual([
      P,
      later.submittedAt,
    ]);
    // A rejection decided later than the other report does not bar it
    const decidedLater = pay('rejected', plus(P, 2 * D), plus(P, 3 * D));
    expect(provisionalWindows([pay('pending', P), decidedLater]).map((w) => w.from)).toEqual([
      P,
      decidedLater.submittedAt,
    ]);
  });

  it('a sale made inside a window is taken after it closed; one made before the report is not', () => {
    const windows = provisionalWindows([pay('rejected', P, plus(P, D))]);
    expect(suspended.readOnly).toBe(true);
    expect(acceptsDocumentMadeAt(suspended, plus(P, 3_600_000))).toBe(false);
    expect(acceptsDocumentMadeAt(suspended, plus(P, 3_600_000), windows)).toBe(true);
    expect(acceptsDocumentMadeAt(suspended, plus(P, D + OFFLINE_TOLERANCE_MS), windows)).toBe(true);
    expect(acceptsDocumentMadeAt(suspended, plus(P, D + OFFLINE_TOLERANCE_MS + 1), windows)).toBe(false);
    expect(acceptsDocumentMadeAt(suspended, plus(P, -1), windows)).toBe(false);
  });
});

describe('lifecycleOf: every status and the edges', () => {
  it('names the state by status while the period runs', () => {
    expect(lifecycleOf(facts({ status: 'trialing', trialEndsAt: END }), END).state).toBe('trialing');
    expect(lifecycleOf(facts({ status: 'past_due' }), END).state).toBe('grace');
    expect(lifecycleOf(facts({ status: 'cancelled' }), END).state).toBe('active');
  });

  it('a trial with no trial end falls back to the period end', () => {
    const life = lifecycleOf(facts({ status: 'trialing', trialEndsAt: null }), plus(END, 1));
    expect(life).toMatchObject({ state: 'grace', endsAt: END });
  });

  it('nothing to expire: never read-only, whatever the status', () => {
    const none = { currentPeriodEnd: null, trialEndsAt: null };
    for (const [status, state] of [
      ['trialing', 'trialing'],
      ['past_due', 'grace'],
      ['active', 'active'],
    ] as const) {
      expect(lifecycleOf(facts({ ...none, status }), END)).toMatchObject({
        state,
        readOnly: false,
        writeUntil: null,
        daysLeft: null,
      });
    }
  });

  it('negative grace days count as none', () => {
    expect(lifecycleOf(facts({ graceDays: -3 }), plus(END, 1))).toMatchObject({ state: 'read_only' });
  });

  it('suspended by hand: read-only at once, cut off when the row changed if that came first', () => {
    const changed = at('2026-11-01T00:00:00.000Z');
    const life = lifecycleOf(facts({ status: 'suspended', updatedAt: changed }), changed);
    expect(life).toMatchObject({ state: 'read_only', readOnly: true, daysLeft: 0 });
    expect(life.writeUntil).toEqual(changed);
    // Without a period, the change time is the cut-off on its own.
    const noPeriod = lifecycleOf(
      facts({ status: 'suspended', currentPeriodEnd: null, updatedAt: changed }),
      changed,
    );
    expect(noPeriod.writeUntil).toEqual(changed);
  });

  it('suspended, then a payment reported: sells for the 72 hours, then stops again', () => {
    const reported = at('2026-11-20T00:00:00.000Z');
    const grace = plus(reported, 72 * 3_600_000);
    const on = lifecycleOf(facts({ status: 'suspended', graceEndsAt: grace }), reported);
    expect(on).toMatchObject({ state: 'grace', readOnly: false, provisional: true, daysLeft: 3 });
    expect(lifecycleOf(facts({ status: 'suspended', graceEndsAt: grace }), plus(grace, 1)).readOnly).toBe(
      true,
    );
  });

  it('a reported payment inside the grace days is not counted as provisional yet', () => {
    const life = lifecycleOf(facts({ graceEndsAt: plus(END, 3 * D) }), plus(END, D));
    expect(life).toMatchObject({ state: 'grace', provisional: false });
  });

  it('a read-only store with no cut-off takes nothing made offline', () => {
    const life = { ...lifecycleOf(facts(), plus(END, 30 * D)), writeUntil: null };
    expect(acceptsDocumentMadeAt(life, END)).toBe(false);
  });
});
