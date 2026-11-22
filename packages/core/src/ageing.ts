/**
 * Debt ageing (10 › الذمم): how old what a customer owes is. A payment settles the oldest debt
 * first, so what is still owed is made of the newest debits, each aged from its day.
 */

export const AGEING_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export const AGEING_LABELS: Record<AgeingBucket, string> = {
  d0_30: '0-30 يوماً',
  d31_60: '31-60 يوماً',
  d61_90: '61-90 يوماً',
  d90_plus: 'أكثر من 90 يوماً',
};

export interface AgeingLine {
  /** «YYYY-MM-DD» */
  date: string;
  debitMinor: number;
  creditMinor: number;
}

export type Ageing = Record<AgeingBucket, number>;

export const emptyAgeing = (): Ageing => ({ d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

export const bucketOf = (ageDays: number): AgeingBucket =>
  ageDays <= 30 ? 'd0_30' : ageDays <= 60 ? 'd31_60' : ageDays <= 90 ? 'd61_90' : 'd90_plus';

const dayNumber = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

/**
 * What a customer owes split by the age of the debt on `asOf`. A balance of zero or less (the store
 * owes them) has nothing to age and gives all zeros.
 */
export function ageDebt(lines: readonly AgeingLine[], asOf: string): Ageing {
  const result = emptyAgeing();
  let owed = lines.reduce((sum, l) => sum + l.debitMinor - l.creditMinor, 0);
  const debits = lines.filter((l) => l.debitMinor > 0).toSorted((a, b) => b.date.localeCompare(a.date));
  for (const debit of debits) {
    if (owed <= 0) break;
    const part = Math.min(owed, debit.debitMinor);
    result[bucketOf(Math.max(0, dayNumber(asOf) - dayNumber(debit.date)))] += part;
    owed -= part;
  }
  return result;
}
