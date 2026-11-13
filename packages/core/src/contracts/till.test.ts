import { describe, expect, it } from 'vitest';
import {
  CLOTHING_RETURN_DAYS,
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
