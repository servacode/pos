import { describe, expect, it } from 'vitest';
import { ageDebt, bucketOf, emptyAgeing } from './ageing';

describe('debt ageing', () => {
  it('puts a debt in the bucket of its age', () => {
    expect([0, 30, 31, 60, 61, 90, 91].map(bucketOf)).toEqual([
      'd0_30',
      'd0_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'd90_plus',
    ]);
  });
  it('settles the oldest debt first', () => {
    const lines = [
      { date: '2026-06-01', debitMinor: 1000, creditMinor: 0 },
      { date: '2026-09-20', debitMinor: 500, creditMinor: 0 },
      { date: '2026-10-01', debitMinor: 0, creditMinor: 1200 },
      { date: '2026-11-10', debitMinor: 300, creditMinor: 0 },
    ];
    // owes 600: the 300 of 3 days ago and 300 of the 500 of 54 days ago
    expect(ageDebt(lines, '2026-11-13')).toEqual({ d0_30: 300, d31_60: 300, d61_90: 0, d90_plus: 0 });
  });
  it('ages nothing for a customer who owes nothing or is owed', () => {
    expect(ageDebt([], '2026-11-13')).toEqual(emptyAgeing());
    const paid = [
      { date: '2026-01-01', debitMinor: 100, creditMinor: 0 },
      { date: '2026-02-01', debitMinor: 0, creditMinor: 150 },
    ];
    expect(ageDebt(paid, '2026-11-13')).toEqual(emptyAgeing());
  });
  it('treats debts of one day alike', () => {
    const lines = [
      { date: '2026-11-01', debitMinor: 100, creditMinor: 0 },
      { date: '2026-11-01', debitMinor: 200, creditMinor: 0 },
    ];
    expect(ageDebt(lines, '2026-11-13').d0_30).toBe(300);
  });
  it('keeps a whole old debt in the last bucket', () => {
    expect(ageDebt([{ date: '2026-01-01', debitMinor: 700, creditMinor: 0 }], '2026-11-13').d90_plus).toBe(
      700,
    );
    expect(ageDebt([{ date: '2026-11-20', debitMinor: 700, creditMinor: 0 }], '2026-11-13').d0_30).toBe(700);
  });
});
