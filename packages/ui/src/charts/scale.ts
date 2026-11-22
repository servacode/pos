/** A value axis: its ends and the clean numbers marked on it. */
export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

const STEPS = [1, 2, 2.5, 5] as const;

/** Rounds away float noise (0.1 + 0.2) so a tick prints as the number it means. */
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

/**
 * A rounded axis around the data (marks-and-anatomy › ticks): the finest step of 1, 2, 2.5 or
 * 5 × 10ⁿ that needs at most `count + 1` intervals, so the top tick sits just over the highest
 * value. It always holds zero, so bars and areas grow from a real baseline. For whole numbers
 * (amounts in minor units, counts) a step is never a fraction, so a money formatter never meets one.
 */
export function niceScale(low: number, high: number, count = 4, integer = false): Scale {
  const min = Math.min(0, Number.isFinite(low) ? low : 0);
  let max = Math.max(0, Number.isFinite(high) ? high : 0);
  if (max === min) max = min + 1;
  const power = 10 ** Math.floor(Math.log10((max - min) / count));
  let step = power * 10;
  search: for (const scale of [power / 10, power, power * 10]) {
    for (const factor of STEPS) {
      const candidate = clean(factor * scale);
      if (integer && !Number.isInteger(candidate)) continue;
      if (Math.ceil(clean(max / candidate)) - Math.floor(clean(min / candidate)) <= count + 1) {
        step = candidate;
        break search;
      }
    }
  }
  const lo = clean(Math.floor(clean(min / step)) * step);
  const hi = clean(Math.ceil(clean(max / step)) * step);
  const ticks: number[] = [];
  const steps = Math.round((hi - lo) / step);
  for (let index = 0; index <= steps; index += 1) ticks.push(clean(lo + index * step));
  return { min: lo, max: hi, ticks };
}
