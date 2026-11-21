/**
 * Device rentals and maintenance contracts (03 › الأدوات الطبية: التأجير وعقود الصيانة). Days are
 * «YYYY-MM-DD» strings in the store's own calendar; nothing here reads the clock.
 */

export const RENTAL_RATE_UNITS = ['day', 'week', 'month'] as const;
export type RentalRateUnit = (typeof RENTAL_RATE_UNITS)[number];

export const RENTAL_RATE_LABELS: Record<RentalRateUnit, string> = {
  day: 'باليوم',
  week: 'بالأسبوع',
  month: 'بالشهر',
};

const DAY_MS = 86_400_000;
const utc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const text = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole days from `from` to `to` (negative when `to` is earlier) */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** «2026-11-13» + 5 → «2026-11-18» */
export function plusDays(day: string, days: number): string {
  return text(utc(day) + days * DAY_MS);
}

/** «2026-01-31» + 1 month → «2026-02-28»: the day stays, or the month's last day when it has fewer */
export function plusMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return text(Date.UTC(year, month, Math.min(d, last)));
}

/** The days a rental ran: the same day is one, never less than one */
export function rentalDays(start: string, end: string): number {
  return Math.max(1, daysBetween(start, end));
}

/**
 * What a rental costs when the piece is back on `end`: the days it ran, counted in whole rate
 * periods (a started week is a week; a month is 30 days), times the rate.
 */
export function rentalCharge(start: string, end: string, unit: RentalRateUnit, rateMinor: number): number {
  const days = rentalDays(start, end);
  const periods = unit === 'day' ? days : Math.ceil(days / (unit === 'week' ? 7 : 30));
  return periods * rateMinor;
}

/** A rental still out past the day it was due */
export function rentalOverdue(status: string, expectedReturn: string, today: string): boolean {
  return status === 'out' && expectedReturn < today;
}

/** How many months before its end a maintenance contract starts to ask for renewal */
export const RENEWAL_NOTICE_DAYS = 30;

export interface ContractTerms {
  startDate: string;
  endDate: string;
  visitEveryMonths: number;
  cancelled: boolean;
}

/** The days visits are due: every N months from the start, up to the end of the contract */
export function visitDays(c: Pick<ContractTerms, 'startDate' | 'endDate' | 'visitEveryMonths'>): string[] {
  const days: string[] = [];
  for (let day = plusMonths(c.startDate, c.visitEveryMonths); day <= c.endDate;) {
    days.push(day);
    day = plusMonths(c.startDate, (days.length + 1) * c.visitEveryMonths);
  }
  return days;
}

/** The day the next visit is due, given how many were made; null when all are done */
export function nextVisitDay(c: ContractTerms, made: number): string | null {
  if (c.cancelled) return null;
  return visitDays(c)[made] ?? null;
}

export type ContractState = 'active' | 'ending' | 'ended' | 'cancelled';

/** «ending» is the last 30 days: the renewal reminder */
export function contractState(c: ContractTerms, today: string): ContractState {
  if (c.cancelled) return 'cancelled';
  if (c.endDate < today) return 'ended';
  return daysBetween(today, c.endDate) <= RENEWAL_NOTICE_DAYS ? 'ending' : 'active';
}
