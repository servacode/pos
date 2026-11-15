import type { ShiftSummary } from '@serva/core';
import { listShifts } from './api';
import { useReport, type ReportState } from './useReport';

/** The day before `day` (YYYY-MM-DD) */
export function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The clock hour (0-23) in the store's time zone */
export function hourIn(timeZone: string, now = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(
      now,
    );
    const hour = Number.parseInt(parts, 10);
    return Number.isNaN(hour) ? 12 : hour;
  } catch {
    return 12;
  }
}

/** Before this hour a day is too young to be measured against a whole yesterday */
export const EARLY_HOUR = 10;

export interface OpenFromYesterday {
  count: number;
  netMinor: number;
}

/** What shifts opened yesterday and still open sold: null when none is still open */
export function openFromYesterday(
  shifts: readonly ShiftSummary[] | undefined | null,
): OpenFromYesterday | null {
  const open = (shifts ?? []).filter((s) => s.status === 'open');
  if (open.length === 0) return null;
  return {
    count: open.reduce((sum, s) => sum + s.salesCount, 0),
    netMinor: open.reduce((sum, s) => sum + s.salesTotalMinor - s.returnsTotalMinor, 0),
  };
}

/**
 * A shift opened before midnight and not closed yet keeps selling into the new day: the figures it
 * holds are yesterday's invoices. Asked only while the day is young (before noon) and only by those
 * who see sales.
 */
export function useOpenShiftFromYesterday(
  enabled: boolean,
  today: string,
  timeZone: string,
  cache?: 'home',
): { note: OpenFromYesterday | null; state: ReportState<{ items: ShiftSummary[] }> } {
  const young = enabled && hourIn(timeZone) < 12;
  const yesterday = dayBefore(today);
  const state = useReport(
    young ? `shifts:${yesterday}` : null,
    () => listShifts({ branchId: null, date: yesterday }),
    cache ? { cache } : undefined,
  );
  return { note: young ? openFromYesterday(state.data?.items) : null, state };
}
