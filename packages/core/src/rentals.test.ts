import { describe, expect, it } from 'vitest';
import {
  plusDays,
  plusMonths,
  contractState,
  daysBetween,
  nextVisitDay,
  rentalCharge,
  rentalDays,
  rentalOverdue,
  visitDays,
} from './rentals';

describe('days', () => {
  it('counts and adds whole days', () => {
    expect(daysBetween('2026-11-10', '2026-11-13')).toBe(3);
    expect(daysBetween('2026-11-13', '2026-11-10')).toBe(-3);
    expect(plusDays('2026-11-28', 5)).toBe('2026-12-03');
  });
  it('adds months, keeping the last day of a short month', () => {
    expect(plusMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(plusMonths('2026-11-13', 3)).toBe('2027-02-13');
    expect(plusMonths('2026-03-15', -4)).toBe('2025-11-15');
  });
});

describe('rental charge', () => {
  it('counts the same day as one day', () => {
    expect(rentalDays('2026-11-10', '2026-11-10')).toBe(1);
    expect(rentalDays('2026-11-10', '2026-11-09')).toBe(1);
    expect(rentalDays('2026-11-10', '2026-11-14')).toBe(4);
  });
  it('charges by the day, the started week or the started month', () => {
    expect(rentalCharge('2026-11-10', '2026-11-14', 'day', 5000)).toBe(20000);
    expect(rentalCharge('2026-11-10', '2026-11-17', 'week', 30000)).toBe(30000);
    expect(rentalCharge('2026-11-10', '2026-11-18', 'week', 30000)).toBe(60000);
    expect(rentalCharge('2026-11-10', '2026-12-10', 'month', 90000)).toBe(90000);
    expect(rentalCharge('2026-11-10', '2026-12-11', 'month', 90000)).toBe(180000);
    expect(rentalCharge('2026-11-10', '2026-11-10', 'month', 90000)).toBe(90000);
  });
  it('is overdue only while out and past the due day', () => {
    expect(rentalOverdue('out', '2026-11-12', '2026-11-13')).toBe(true);
    expect(rentalOverdue('out', '2026-11-13', '2026-11-13')).toBe(false);
    expect(rentalOverdue('returned', '2026-11-01', '2026-11-13')).toBe(false);
  });
});

describe('maintenance schedule', () => {
  const c = { startDate: '2026-01-15', endDate: '2026-12-31', visitEveryMonths: 3, cancelled: false };
  it('lists the visit days up to the end', () => {
    expect(visitDays(c)).toEqual(['2026-04-15', '2026-07-15', '2026-10-15']);
  });
  it('gives the next visit after those made, or none', () => {
    expect(nextVisitDay(c, 0)).toBe('2026-04-15');
    expect(nextVisitDay(c, 2)).toBe('2026-10-15');
    expect(nextVisitDay(c, 3)).toBeNull();
    expect(nextVisitDay({ ...c, cancelled: true }, 0)).toBeNull();
  });
  it('is active, ending in its last 30 days, ended or cancelled', () => {
    expect(contractState(c, '2026-06-01')).toBe('active');
    expect(contractState(c, '2026-12-01')).toBe('ending');
    expect(contractState(c, '2026-12-31')).toBe('ending');
    expect(contractState(c, '2027-01-01')).toBe('ended');
    expect(contractState({ ...c, cancelled: true }, '2026-06-01')).toBe('cancelled');
  });
});
