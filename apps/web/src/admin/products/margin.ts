/** The share of the price that is profit, whole percent: (price - cost) / price. Null when there is no price. */
export function marginPercent(priceMinor: number, costMinor: number): number | null {
  if (priceMinor <= 0) return null;
  return Math.round(((priceMinor - costMinor) / priceMinor) * 100);
}
