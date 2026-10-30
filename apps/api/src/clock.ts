/**
 * The server's source of time. Every rule that depends on "now" (session expiry, trial days,
 * token lifetimes, rate-limit windows, codes) reads it from here, so tests can move time.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to. For tests and time-travel scenarios. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date | string = '2026-10-30T09:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(date: Date | string): void {
    this.current = new Date(date).getTime();
  }
}

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
