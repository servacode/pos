/** Deterministic PRNG (mulberry32) for property-style tests. Test-only; not exported from the package. */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Integer in [min, max], inclusive. */
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return { next, int };
}
