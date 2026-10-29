import { describe, expect, it } from 'vitest';
import { firstName, formatDays } from './format';

describe('formatDays', () => {
  it.each([
    [1, 'يوم واحد'],
    [2, 'يومان'],
    [5, '5 أيام'],
    [12, '12 يوماً'],
    [100, '100 يوم'],
  ])('formats %i days', (count, expected) => {
    expect(formatDays(count)).toBe(expected);
  });

  it('respects Arabic-Indic digits', () => {
    expect(formatDays(12, 'arab')).toBe('١٢ يوماً');
  });
});

describe('firstName', () => {
  it('returns the first word of a full name', () => {
    expect(firstName('  أحمد الخطيب ')).toBe('أحمد');
  });
});
