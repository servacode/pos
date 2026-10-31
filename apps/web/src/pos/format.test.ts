import { describe, expect, it } from 'vitest';
import { dateText } from './format';

describe('dateText', () => {
  it('writes the year without a thousands separator, in both digit sets', () => {
    const ms = new Date(2026, 9, 31, 12).getTime();
    expect(dateText(ms)).toMatch(/ 2026$/);
    expect(dateText(ms, 'arab')).toMatch(/ ٢٠٢٦$/);
  });
});
