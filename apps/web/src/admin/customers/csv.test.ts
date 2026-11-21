import { describe, expect, it } from 'vitest';
import { customersCsv } from './csv';

describe('customersCsv', () => {
  it('starts with a real byte-order mark, not the letters FEFF', () => {
    const text = customersCsv([], 'SYP');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.startsWith('FEFF')).toBe(false);
  });
});
