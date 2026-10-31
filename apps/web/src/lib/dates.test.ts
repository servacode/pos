import { describe, expect, it } from 'vitest';
import { dayText, isoDay, monthStart, zonedClock, zonedDateTime } from './dates';

describe('store dates', () => {
  it("takes the day in the store's time zone, not the browser's", () => {
    // 22:30 UTC on 30 October is already 31 October in Damascus (UTC+3).
    expect(isoDay(Date.parse('2026-10-30T22:30:00Z'), 'Asia/Damascus')).toBe('2026-10-31');
    expect(isoDay(Date.parse('2026-10-30T20:59:00Z'), 'Asia/Damascus')).toBe('2026-10-30');
  });

  it('writes the day and the time as the receipts do, years without a separator', () => {
    expect(dayText('2026-10-31')).toBe('31 تشرين الأول 2026');
    expect(dayText('2026-01-05', 'arab')).toBe('٥ كانون الثاني ٢٠٢٦');
    expect(zonedClock('2026-10-31T13:05:00Z', 'Asia/Damascus')).toBe('4:05 م');
    expect(zonedClock('2026-10-30T21:00:00Z', 'Asia/Damascus')).toBe('12:00 ص');
    expect(zonedDateTime('2026-10-31T05:00:00Z', 'Asia/Damascus')).toBe('31 تشرين الأول 2026، 8:00 ص');
  });

  it('finds the first day of the month', () => {
    expect(monthStart('2026-10-31')).toBe('2026-10-01');
  });
});
