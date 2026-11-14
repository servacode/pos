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

describe('warranty dates and labels', () => {
  it('adds months like the database: same day, or the last day of a shorter month', async () => {
    const { addMonthsIso, dmy, warrantyUntilText, serialLabel } = await import('./contracts/warranty');
    expect(addMonthsIso('2026-10-30', 12)).toBe('2027-10-30');
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsIso('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsIso('2026-03-10', 0)).toBe('2026-03-10');
    expect(dmy('2027-10-30')).toBe('30/10/2027');
    expect(warrantyUntilText('2027-10-30')).toBe('الكفالة حتى 30/10/2027');
    expect(serialLabel(['electronics'])).toBe('IMEI');
    expect(serialLabel(['medical_supplies'])).toBe('الرقم التسلسلي');
    expect(serialLabel(undefined)).toBe('الرقم التسلسلي');
  });

  it('asks for the customer by sector unless the store decided', async () => {
    const { warrantyAsksCustomer } = await import('./contracts/till');
    expect(warrantyAsksCustomer(null, ['electronics'])).toBe(true);
    expect(warrantyAsksCustomer(undefined, ['medical_supplies'])).toBe(true);
    expect(warrantyAsksCustomer({}, ['clothing'])).toBe(false);
    expect(warrantyAsksCustomer({}, undefined)).toBe(false);
    expect(warrantyAsksCustomer({ warrantyAskCustomer: false }, ['electronics'])).toBe(false);
    expect(warrantyAsksCustomer({ warrantyAskCustomer: null }, ['electronics'])).toBe(true);
    expect(warrantyAsksCustomer({ warrantyAskCustomer: true }, ['clothing'])).toBe(true);
  });
});
