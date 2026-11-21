/** The date chips of the reports: «اليوم / أمس / هالأسبوع / هالشهر» as a range of ISO days. */

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month';

export interface DayRange {
  from: string;
  to: string;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'هالأسبوع',
  month: 'هالشهر',
};

export const PERIOD_KEYS: readonly PeriodKey[] = ['today', 'yesterday', 'week', 'month'];

/** `day` (YYYY-MM-DD) moved by `n` days, a plain calendar step */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The week starts on Saturday here: the days from the last Saturday to `today` */
function weekStart(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((weekday + 1) % 7));
}

/** The range a chip stands for, up to the store's `today` (a week or month so far, not a whole one) */
export function periodRange(key: PeriodKey, today: string): DayRange {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: weekStart(today), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/** The chip a range matches, or null for a range picked by hand */
export function periodOf(range: DayRange, today: string): PeriodKey | null {
  return (
    PERIOD_KEYS.find((key) => {
      const r = periodRange(key, today);
      return r.from === range.from && r.to === range.to;
    }) ?? null
  );
}
