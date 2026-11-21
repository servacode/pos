import { describe, expect, it } from 'vitest';
import { firstName, formatDays, formatNumber } from './format';

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
    expect(firstName('د. سامر المصري')).toBe('سامر');
    expect(firstName('م. أبو خالد')).toBe('أبو خالد');
  });

  it('keeps «أبو», «أم» and «عبد» with the word after them', () => {
    expect(firstName('أبو سامر الحلبي')).toBe('أبو سامر');
    expect(firstName('أم خالد')).toBe('أم خالد');
    expect(firstName('عبد الله العلي')).toBe('عبد الله');
    expect(firstName('عبدالله العلي')).toBe('عبدالله');
    // Nothing after the prefix: the prefix alone is all there is
    expect(firstName('أبو')).toBe('أبو');
  });
});

describe('formatNumber negatives', () => {
  it('keeps a negative as one isolated unit with a true minus', () => {
    const text = formatNumber(-1250);
    expect(text.startsWith('⁦')).toBe(true);
    expect(text.endsWith('⁩')).toBe(true);
    expect(text).toContain('−');
    expect(text.replace(/[⁦⁩]/g, '')).toMatch(/^−?.*1,250$/);
  });
  it('leaves a positive alone', () => {
    expect(formatNumber(1250)).toBe('1,250');
  });
});
