import { getCurrency, type CurrencyId } from './currencies';
import { stripBidiControls, toLatinDigits } from './text';

/**
 * Money is always an integer number of minor units (12.50 USD = 1250).
 * Quantities are integers in thousandths (0.250 kg = 250), percentages are basis points (15% = 1500),
 * and exchange rates are direct decimal strings (≥ 1, up to RATE_SCALE decimals). All arithmetic is integer
 * (BigInt where products can grow) and every rounding goes through roundDiv (half away from zero).
 */

/** Quantities are stored in thousandths: 1 piece = 1000. */
export const QTY_SCALE = 1000;

/** Exchange rates carry at most this many decimal places ("13000.125"). */
export const RATE_SCALE = 6;

const RATE_ONE = 10n ** BigInt(RATE_SCALE);

const BP_SCALE = 10_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PARSE_SCALE = 18;

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${String(value)}`);
  }
}

/** Converts a BigInt result back to a number, refusing anything outside the safe integer range. */
function toSafeNumber(value: bigint, name: string): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return Number(value);
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** Integer division rounding half away from zero. The single rounding rule for all money math. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('roundDiv: denominator must be positive');
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator; // same sign as numerator
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twiceRemainder < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

/** round(minor × bp / 10000), e.g. 15% of 2.31 = applyBasisPoints(231, 1500) = 35. */
export function applyBasisPoints(minor: number, bp: number): number {
  assertSafeInteger(minor, 'minor');
  assertSafeInteger(bp, 'bp');
  return toSafeNumber(roundDiv(BigInt(minor) * BigInt(bp), BP_SCALE), 'applyBasisPoints result');
}

/** Rounds to the nearest multiple of `step` (half away from zero), e.g. cash rounding to 0.05. */
export function roundToStep(minor: number, step: number): number {
  assertSafeInteger(minor, 'minor');
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw new RangeError(`step must be a positive safe integer, got ${String(step)}`);
  }
  const s = BigInt(step);
  return toSafeNumber(roundDiv(BigInt(minor), s) * s, 'roundToStep result');
}

/** Sums minor amounts exactly, throwing if the total leaves the safe integer range. */
export function sumMinor(values: readonly number[]): number {
  let total = 0n;
  for (const [i, value] of values.entries()) {
    assertSafeInteger(value, `values[${i}]`);
    total += BigInt(value);
  }
  return toSafeNumber(total, 'sum');
}

/**
 * Splits `total` across `weights` with the largest-remainder method; the shares always sum exactly to
 * `total`. Leftover units go to the largest fractional remainder, then the larger weight, then the smaller
 * key. `keys` are stable unique ids such as invoice line numbers (spec 10: «الترتيب برقم السطر الثابت»): with
 * them each weight gets the same share whatever the order of the arrays. Without keys the index is the key.
 * All-zero weights split as evenly as possible (the smallest keys get the extra units).
 * A negative total is allocated as the mirror image of the positive one.
 */
export function allocate(total: number, weights: readonly number[], keys?: readonly number[]): number[] {
  assertSafeInteger(total, 'total');
  for (const [i, weight] of weights.entries()) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`weights[${i}] must be a non-negative safe integer, got ${String(weight)}`);
    }
  }
  if (keys !== undefined) {
    if (keys.length !== weights.length) {
      throw new RangeError(`allocate: expected one key per weight (${weights.length}), got ${keys.length}`);
    }
    for (const [i, key] of keys.entries()) assertSafeInteger(key, `keys[${i}]`);
    if (new Set(keys).size !== keys.length) throw new RangeError('allocate: keys must be unique');
  }
  if (total === 0) return weights.map(() => 0);
  if (weights.length === 0) throw new RangeError('allocate: cannot split a non-zero total across no weights');

  const sign = total < 0 ? -1n : 1n;
  const amount = BigInt(Math.abs(total));
  const weightSum = weights.reduce((acc, weight) => acc + BigInt(weight), 0n);
  const keyOf = (index: number) => keys?.[index] ?? index;

  let shares: bigint[];
  let remainders: bigint[];
  if (weightSum === 0n) {
    // Equal weights: every remainder ties, so the keys alone decide who gets the extra units.
    const count = BigInt(weights.length);
    shares = weights.map(() => amount / count);
    remainders = weights.map(() => 0n);
  } else {
    remainders = [];
    shares = weights.map((weight) => {
      const product = amount * BigInt(weight);
      remainders.push(product % weightSum);
      return product / weightSum;
    });
  }
  // Remainders share the denominator weightSum, so they compare directly.
  const order = weights
    .map((weight, index) => ({ index, weight, remainder: remainders[index] ?? 0n, key: keyOf(index) }))
    .sort((a, b) => {
      if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
      if (a.weight !== b.weight) return b.weight - a.weight;
      return a.key < b.key ? -1 : 1; // keys are unique, so never equal
    });
  let leftover = amount - shares.reduce((acc, share) => acc + share, 0n);
  for (const { index } of order) {
    if (leftover === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return shares.map((share) => Number(share * sign));
}

const DECIMAL_PATTERN = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/;

interface DecimalParts {
  negative: boolean;
  intDigits: string;
  fracDigits: string;
}

/** Normalizes Arabic digits, separators (٫ decimal, ٬ thousands) and «−», then splits a decimal string. */
function splitDecimal(input: string): DecimalParts {
  if (typeof input !== 'string') throw new RangeError('decimal input must be a string');
  const normalized = stripBidiControls(toLatinDigits(input)).trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  const intPart = match?.[2] ?? '';
  const fracPart = match?.[3] ?? '';
  if (!match || (intPart === '' && fracPart === '')) {
    throw new RangeError(`invalid decimal number ${JSON.stringify(input)}`);
  }
  return {
    negative: match[1] === '-',
    intDigits: intPart.replaceAll(',', '') || '0',
    fracDigits: fracPart,
  };
}

/**
 * Parses a decimal string ("1,234.5", "١٢٫٥", "-0.25") into an integer scaled by 10^scale, rounding half
 * away from zero beyond `scale`. Thousands separators must group by three. Throws RangeError when invalid.
 */
export function parseDecimal(input: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_PARSE_SCALE) {
    throw new RangeError(`scale must be an integer between 0 and ${MAX_PARSE_SCALE}, got ${String(scale)}`);
  }
  const { negative, intDigits, fracDigits } = splitDecimal(input);
  let magnitude = BigInt(intDigits + fracDigits.slice(0, scale).padEnd(scale, '0'));
  if ((fracDigits[scale] ?? '0') >= '5') magnitude += 1n;
  return negative ? -magnitude : magnitude;
}

/**
 * Parses a direct exchange rate into an integer scaled by 10^RATE_SCALE. It must have ≤ 6 decimals and be
 * ≥ 1: a rate is always entered as units of the weaker currency per one unit of the stronger (pounds per
 * dollar), never inverted, because an inverse rounded to six places is off by up to 0.1%.
 */
export function parseRate(rate: string): bigint {
  const { fracDigits } = splitDecimal(rate);
  if (fracDigits.replace(/0+$/, '').length > RATE_SCALE) {
    throw new RangeError(`exchange rate ${JSON.stringify(rate)} has more than ${RATE_SCALE} decimal places`);
  }
  const scaled = parseDecimal(rate, RATE_SCALE);
  if (scaled <= 0n)
    throw new RangeError(`exchange rate must be greater than zero, got ${JSON.stringify(rate)}`);
  if (scaled < RATE_ONE) {
    throw new RangeError(
      `exchange rate ${JSON.stringify(rate)} is inverted: enter how many units of the weaker currency ` +
        'one unit of the stronger buys (e.g. pounds per dollar)',
    );
  }
  return scaled;
}

/** Parses a user-entered amount ("12.50", "١٬٢٥٠") into minor units of `currency`. */
export function toMinor(amount: string, currency: CurrencyId): number {
  const { decimals } = getCurrency(currency);
  return toSafeNumber(parseDecimal(amount, decimals), 'amount');
}

export interface FormatMoneyOptions {
  /** 'latn' (default): 1,250.00 — 'arab': ١٬٢٥٠٫٠٠ */
  digits?: 'latn' | 'arab';
  /** Append the currency symbol after a space (default true). */
  symbol?: boolean;
  /** Drop the fraction when it is all zeros (1,250 instead of 1,250.00). */
  trimZeros?: boolean;
}

const ARABIC_CHARS: Record<string, string> = {
  '0': '٠',
  '1': '١',
  '2': '٢',
  '3': '٣',
  '4': '٤',
  '5': '٥',
  '6': '٦',
  '7': '٧',
  '8': '٨',
  '9': '٩',
  ',': '٬',
  '.': '٫',
};

/** Formats minor units for display, e.g. formatMoney(125000, 'SYP') → "1,250.00 ل.س". Locale-independent. */
export function formatMoney(minor: number, currency: CurrencyId, opts: FormatMoneyOptions = {}): string {
  assertSafeInteger(minor, 'minor');
  const { decimals, symbolAr } = getCurrency(currency);
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals);

  let text = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (fracPart !== '' && !(opts.trimZeros && /^0+$/.test(fracPart))) text += `.${fracPart}`;
  if (minor < 0) text = `-${text}`;
  if (opts.digits === 'arab') text = text.replace(/[\d,.]/g, (ch) => ARABIC_CHARS[ch] ?? ch);
  if (opts.symbol ?? true) text += ` ${symbolAr}`;
  return text;
}

/**
 * The one direct rate stored per currency pair: one `unit` is worth `rate` units of `quote`, quoted so the
 * rate is ≥ 1 (pounds per dollar: { unit: 'USD', quote: 'SYP', rate: '130' }). The reverse direction
 * divides by the same rate; there is no inverted rate.
 */
export interface ExchangeRate {
  unit: CurrencyId;
  quote: CurrencyId;
  rate: string;
}

/** The fixed rate between two currencies (1 new pound = 100 old), or undefined when their rate floats. */
export function fixedRate(a: CurrencyId, b: CurrencyId): ExchangeRate | undefined {
  const ofA = getCurrency(a).fixedRate;
  if (ofA?.unit === b) return { unit: b, quote: a, rate: ofA.rate };
  const ofB = getCurrency(b).fixedRate;
  if (ofB?.unit === a) return { unit: a, quote: b, rate: ofB.rate };
  return undefined;
}

function resolveRate(from: CurrencyId, to: CurrencyId, rate: ExchangeRate | undefined): ExchangeRate {
  const fixed = fixedRate(from, to);
  if (rate === undefined) {
    if (fixed) return fixed;
    throw new RangeError(`an exchange rate is needed to convert ${from} to ${to}`);
  }
  const samePair = (rate.unit === from && rate.quote === to) || (rate.unit === to && rate.quote === from);
  if (!samePair) {
    throw new RangeError(`a ${rate.unit}/${rate.quote} rate cannot convert ${from} to ${to}`);
  }
  if (fixed && (rate.unit !== fixed.unit || parseRate(rate.rate) !== parseRate(fixed.rate))) {
    throw new RangeError(`${fixed.quote} is fixed at ${fixed.rate} per ${fixed.unit}`);
  }
  return rate;
}

/**
 * Converts minor units of `from` into minor units of `to` with the pair's direct rate: unit → quote
 * multiplies (12.50 $ at 130 = 1,625.00 ل.س), quote → unit divides (162,500.00 ل.س at 13,000 = 12.50 $
 * exactly). Pairs with a fixed ratio (old ↔ new pound) need no rate, and a rate given for them must match.
 * The same currency returns the amount unchanged.
 */
export function convert(minor: number, from: CurrencyId, to: CurrencyId, rate?: ExchangeRate): number {
  assertSafeInteger(minor, 'minor');
  const source = getCurrency(from);
  const target = getCurrency(to);
  if (from === to) return minor;
  const pair = resolveRate(from, to, rate);
  const scaled = parseRate(pair.rate);
  const toQuote = pair.unit === from;
  const numerator = BigInt(minor) * (toQuote ? scaled : RATE_ONE) * pow10(target.decimals);
  const denominator = pow10(source.decimals) * (toQuote ? RATE_ONE : scaled);
  return toSafeNumber(roundDiv(numerator, denominator), 'converted amount');
}

/** round(unitPrice × qty / 1000): the gross of a line before any discount. */
export function lineGross(unitPriceMinor: number, qtyThousandths: number): number {
  assertSafeInteger(unitPriceMinor, 'unitPriceMinor');
  assertSafeInteger(qtyThousandths, 'qtyThousandths');
  return toSafeNumber(
    roundDiv(BigInt(unitPriceMinor) * BigInt(qtyThousandths), BigInt(QTY_SCALE)),
    'line gross',
  );
}
