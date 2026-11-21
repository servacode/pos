import { describe, expect, it } from 'vitest';
import { medianPrice, OLD_POUND_MEDIAN } from './oldPound';
import type { PreparedRow } from './mapping';

const rows = (prices: (string | null)[]): PreparedRow[] =>
  prices.map((price, i) => ({ line: i + 2, values: { price } }) as unknown as PreparedRow);

describe('the old-pound hint', () => {
  it('takes the median of the prices, ignoring blanks', () => {
    expect(medianPrice(rows(['20,000', '50000', null, '69000']))).toBe(50_000);
    expect(medianPrice(rows([]))).toBe(0);
  });

  it('warns above a hundred thousand and not below', () => {
    expect(medianPrice(rows(['250000', '300000', '90000']))).toBeGreaterThan(OLD_POUND_MEDIAN);
    expect(medianPrice(rows(['2500', '3000']))).toBeLessThan(OLD_POUND_MEDIAN);
  });
});
