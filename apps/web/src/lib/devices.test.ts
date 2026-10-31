import { describe, expect, it } from 'vitest';
import {
  deviceTypeLabel,
  documentsCount,
  formatCountdown,
  formatPairingCode,
  formatSince,
  formatStoreCode,
} from './devices';

describe('device helpers', () => {
  it('formats the pairing code as XXXX-XXXX from anything typed', () => {
    expect(formatPairingCode('k7q')).toBe('K7Q');
    expect(formatPairingCode('k7qm4')).toBe('K7QM-4');
    expect(formatPairingCode(' k7-qm ٤tzp extra')).toBe('K7QM-4TZP');
  });

  it('keeps six Latin digits of the store code', () => {
    expect(formatStoreCode('٤٨٢ 130 99')).toBe('482130');
  });

  it('counts down in minutes and seconds, never below zero', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(65_400)).toBe('1:06');
    expect(formatCountdown(-5)).toBe('0:00');
  });

  it('says how long ago in Arabic with Latin digits', () => {
    const now = Date.parse('2026-10-31T12:00:00.000Z');
    expect(formatSince('2026-10-31T11:59:30.000Z', now)).toBe('الآن');
    expect(formatSince('2026-10-31T11:55:00.000Z', now)).toBe('قبل 5 دقائق');
    expect(formatSince('2026-10-31T09:00:00.000Z', now)).toBe('قبل 3 ساعات');
    expect(formatSince('2026-10-20T09:00:00.000Z', now)).toMatch(/20/);
  });

  it('counts documents with the Arabic plural', () => {
    expect([1, 2, 3, 11, 100].map(documentsCount)).toEqual([
      'مستند واحد',
      'مستندان',
      '3 مستندات',
      '11 مستنداً',
      '100 مستند',
    ]);
  });

  it('names the kind and platform', () => {
    expect(deviceTypeLabel('cashier', 'browser')).toBe('جهاز كاشير · متصفح');
    expect(deviceTypeLabel('android_pos', 'android')).toBe('كاشير أندرويد بطابعة · أندرويد');
  });
});
