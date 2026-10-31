import { describe, expect, it } from 'vitest';
import {
  dayReportQuery,
  journalQuery,
  shiftListQuery,
  syncEvidenceQuery,
  trialBalanceQuery,
} from './accounting';

const BRANCH = '0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a01';

describe('accounting and report queries', () => {
  it('takes a date and an optional branch for the day report', () => {
    expect(dayReportQuery.parse({ date: '2026-10-30' })).toEqual({ date: '2026-10-30' });
    expect(dayReportQuery.parse({ date: '2026-10-30', branchId: BRANCH }).branchId).toBe(BRANCH);
    expect(dayReportQuery.safeParse({}).success).toBe(false);
    expect(dayReportQuery.safeParse({ date: '30/10/2026' }).success).toBe(false);
    expect(dayReportQuery.safeParse({ date: '2026-10-30', branchId: 'main' }).success).toBe(false);
  });

  it('pages the journal 50 at a time by default, up to 200', () => {
    expect(journalQuery.parse({})).toEqual({ limit: 50 });
    expect(journalQuery.parse({ limit: '200', from: '2026-01-01' })).toEqual({
      limit: 200,
      from: '2026-01-01',
    });
    expect(journalQuery.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('needs both ends of the trial balance, and the device of the evidence screen', () => {
    expect(trialBalanceQuery.safeParse({ from: '2026-10-01' }).success).toBe(false);
    expect(trialBalanceQuery.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(syncEvidenceQuery.safeParse({ date: '2026-10-30' }).success).toBe(false);
    expect(syncEvidenceQuery.safeParse({ deviceId: BRANCH }).success).toBe(true);
    expect(shiftListQuery.parse({})).toEqual({});
  });
});
