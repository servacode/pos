import { describe, expect, it } from 'vitest';
import {
  cashNotesOf,
  CLOTHING_RETURN_DAYS,
  DEFAULT_CASH_NOTES,
  DEFAULT_RETURN_DAYS,
  DEFAULT_TILL_SETTINGS,
  returnWindowDays,
  tillSettingsSchema,
} from './till';

describe('returnWindowDays', () => {
  it('uses the store own number first', () => {
    expect(returnWindowDays({ returnWindowDays: 14 }, ['clothing'])).toBe(14);
  });
  it('gives clothing 30 days and everything else 7 when none is set', () => {
    expect(returnWindowDays(null, ['clothing'])).toBe(CLOTHING_RETURN_DAYS);
    expect(returnWindowDays({ returnWindowDays: null }, ['clothing', 'cosmetics'])).toBe(30);
    expect(returnWindowDays(undefined, ['supermarket'])).toBe(DEFAULT_RETURN_DAYS);
    expect(returnWindowDays(null, undefined)).toBe(7);
    expect(returnWindowDays(null, ['medical_supplies'])).toBe(30);
  });
});

describe('cash notes', () => {
  const base = { returnWindowDays: null, cardApprovalRequired: false };
  const parse = (cashNotes: unknown) => tillSettingsSchema.safeParse({ ...base, cashNotes }).success;
  it('accepts positive whole values per currency and refuses the rest', () => {
    expect(parse({ SYP: [1000, 500, 10], USD: [1] })).toBe(true);
    expect(parse({})).toBe(true);
    expect(parse({ SYP: [] })).toBe(false);
    expect(parse({ SYP: [0] })).toBe(false);
    expect(parse({ SYP: [-5] })).toBe(false);
    expect(parse({ SYP: [2.5] })).toBe(false);
    expect(parse({ SYP: [500, 500] })).toBe(false);
    expect(parse({ SYP: [1_000_001] })).toBe(false);
    expect(parse({ SYP: Array.from({ length: 21 }, (_, i) => i + 1) })).toBe(false);
    expect(parse({ EUR: [5] })).toBe(false);
    expect(tillSettingsSchema.safeParse(base).success).toBe(true);
  });
  it('reads a currency list sorted high to low, null when unset', () => {
    expect(cashNotesOf({ cashNotes: { SYP: [10, 500, 100] } }, 'SYP')).toEqual([500, 100, 10]);
    expect(cashNotesOf({ cashNotes: { SYP: [10] } }, 'USD')).toBeNull();
    expect(cashNotesOf({ cashNotes: { SYP: [] } }, 'SYP')).toBeNull();
    expect(cashNotesOf(null, 'SYP')).toBeNull();
    expect(cashNotesOf(undefined, 'SYP')).toBeNull();
    expect(cashNotesOf({}, 'SYP')).toBeNull();
  });
});

describe('tillSettingsSchema', () => {
  it('defaults to no card approval requirement and accepts a window of 1 to 365 days', () => {
    expect(DEFAULT_TILL_SETTINGS.cardApprovalRequired).toBe(false);
    expect(tillSettingsSchema.safeParse({ returnWindowDays: 365, cardApprovalRequired: true }).success).toBe(
      true,
    );
    expect(tillSettingsSchema.safeParse({ returnWindowDays: 0, cardApprovalRequired: true }).success).toBe(
      false,
    );
    expect(tillSettingsSchema.safeParse({ returnWindowDays: 1.5, cardApprovalRequired: true }).success).toBe(
      false,
    );
    expect(
      tillSettingsSchema.safeParse({ returnWindowDays: null, cardApprovalRequired: false }).success,
    ).toBe(true);
  });
});

describe('the built-in cash notes', () => {
  it('are the new-pound notes, high to low', () => {
    expect(DEFAULT_CASH_NOTES.SYP).toEqual([500, 200, 100, 50, 25, 10, 5]);
    expect([...DEFAULT_CASH_NOTES.SYP!].sort((a, b) => b - a)).toEqual(DEFAULT_CASH_NOTES.SYP);
  });
});
