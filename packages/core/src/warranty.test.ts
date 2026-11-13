import { describe, expect, it } from 'vitest';
import {
  WARRANTY_NEXT,
  WARRANTY_STATUSES,
  warrantyClaimInput,
  warrantyListQuery,
  warrantyLookupQuery,
  warrantyStatusInput,
} from './contracts/warranty';

describe('the warranty contracts', () => {
  it('takes a serial of three characters or more and a fault', () => {
    expect(warrantyLookupQuery.safeParse({ serial: ' IMEI001 ' }).data).toEqual({ serial: 'IMEI001' });
    expect(warrantyLookupQuery.safeParse({ serial: 'ab' }).success).toBe(false);
    expect(warrantyClaimInput.safeParse({ serial: 'IMEI001', issue: 'الشاشة' }).success).toBe(true);
    expect(warrantyClaimInput.safeParse({ serial: 'IMEI001', issue: '  ' }).success).toBe(false);
    expect(
      warrantyClaimInput.safeParse({ serial: 'IMEI001', issue: 'x', receivedOn: '2026-13-40' }).success,
    ).toBe(false);
  });

  it('asks where a claim was sent when it is sent, and nowhere else', () => {
    const base = { version: 1 };
    expect(warrantyStatusInput.safeParse({ ...base, status: 'sent' }).success).toBe(false);
    expect(warrantyStatusInput.safeParse({ ...base, status: 'sent', sentTo: '  ' }).success).toBe(false);
    expect(warrantyStatusInput.safeParse({ ...base, status: 'sent', sentTo: 'الوكيل' }).success).toBe(true);
    expect(warrantyStatusInput.safeParse({ ...base, status: 'ready' }).success).toBe(true);
    expect(warrantyStatusInput.safeParse({ ...base, status: 'received' }).success).toBe(false);
  });

  it('lists the open claims unless asked for all', () => {
    expect(warrantyListQuery.parse({})).toEqual({ status: 'open' });
    expect(warrantyListQuery.parse({ status: 'all' })).toEqual({ status: 'all' });
  });

  it('never goes back: each status leads only forward', () => {
    expect(WARRANTY_NEXT.delivered).toEqual([]);
    for (const [i, status] of WARRANTY_STATUSES.entries()) {
      for (const next of WARRANTY_NEXT[status]) expect(WARRANTY_STATUSES.indexOf(next)).toBeGreaterThan(i);
    }
  });
});
