import { describe, expect, it } from 'vitest';
import { countWord, pieces, registeredAdjective, rows } from './plural';

describe('Arabic counted words', () => {
  it('takes the plural for three to ten and the singular after', () => {
    expect(pieces(1)).toBe('قطعة');
    expect(pieces(2)).toBe('قطعتان');
    expect(pieces(5)).toBe('قطع');
    expect(pieces(10)).toBe('قطع');
    expect(pieces(12)).toBe('قطعة');
    expect(rows(3)).toBe('صفوف');
    expect(countWord(2.5, { one: 'كيلو', few: 'كيلوات' })).toBe('كيلو');
    expect(countWord(2, { one: 'كيلو', few: 'كيلوات' })).toBe('كيلو');
  });
});

describe('registeredAdjective', () => {
  it('agrees with the counted person', () => {
    expect([1, 2, 5, 12].map(registeredAdjective)).toEqual(['مسجَّل', 'مسجَّلان', 'مسجَّلون', 'مسجَّلاً']);
    expect(registeredAdjective(1.5)).toBe('مسجَّل');
  });
});
