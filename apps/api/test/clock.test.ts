import { describe, expect, it } from 'vitest';
import { ManualClock, systemClock } from '../src/clock';

describe('clock', () => {
  it('a manual clock only moves when told to', () => {
    const clock = new ManualClock('2026-01-31T22:30:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-01-31T22:30:00.000Z');
    clock.advance(90 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-02-01T00:00:00.000Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().getUTCFullYear()).toBe(2027);
  });

  it('returns a fresh Date each time, so callers cannot move it by mutating the result', () => {
    const clock = new ManualClock();
    clock.now().setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('the system clock follows real time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });
});
