import { CURRENCIES, type CurrencyCode } from './currencies';
import { toLatinDigits } from './text';

/**
 * Money is always an integer number of minor units (12.50 USD = 1250).
 * Quantities are integers in thousandths (0.250 kg = 250), percentages are basis points (15% = 1500),
 * and exchange rates are decimal strings with up to RATE_SCALE decimals. All arithmetic is integer
 * (BigInt where products can grow) and every rounding goes through roundDiv (half away from zero).
 */

/** Quantities are stored in thousandths: 1 piece = 1000. */
export const QTY_SCALE = 1000;

/** Exchange rates carry at most this many decimal places ("0.000077"). */
export const RATE_SCALE = 6;

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

function currencyInfo(currency: CurrencyCode) {
  if (!Object.hasOwn(CURRENCIES, currency)) {
    throw new RangeError(`unknown currency ${JSON.stringify(currency)}`);
  }
  return CURRENCIES[currency];
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
 * `total`. Leftover units go to the largest fractional remainder, then the larger weight, then the lower
 * index. All-zero weights split as evenly as possible (earlier indexes get the extra units).
 * A negative total is allocated as the mirror image of the positive one.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertSafeInteger(total, 'total');
  for (const [i, weight] of weights.entries()) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`weights[${i}] must be a non-negative safe integer, got ${String(weight)}`);
    }
  }
  if (total === 0) return weights.map(() => 0);
  if (weights.length === 0) throw new RangeError('allocate: cannot split a non-zero total across no weights');

  const sign = total < 0 ? -1n : 1n;
  const amount = BigInt(Math.abs(total));
  const weightSum = weights.reduce((acc, weight) => acc + BigInt(weight), 0n);

  let shares: bigint[];
  if (weightSum === 0n) {
    const count = BigInt(weights.length);
    const base = amount / count;
    const extra = amount % count;
    shares = weights.map((_, i) => base + (BigInt(i) < extra ? 1n : 0n));
  } else {
    const remainders: bigint[] = [];
    shares = weights.map((weight) => {
      const product = amount * BigInt(weight);
      remainders.push(product % weightSum);
      return product / weightSum;
    });
    // Remainders share the denominator weightSum, so they compare directly.
    const order = weights
      .map((weight, index) => ({ index, weight, remainder: remainders[index] ?? 0n }))
      .sort((a, b) => {
        if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
        if (a.weight !== b.weight) return b.weight - a.weight;
        return a.index - b.index;
      });
    let leftover = amount - shares.reduce((acc, share) => acc + share, 0n);
    for (const { index } of order) {
      if (leftover === 0n) break;
      shares[index] = (shares[index] ?? 0n) + 1n;
      leftover -= 1n;
    }
  }
  return shares.map((share) => Number(share * sign));
}

const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;
const DECIMAL_PATTERN = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/;

interface DecimalParts {
  negative: boolean;
  intDigits: string;
  fracDigits: string;
}

/** Normalizes Arabic digits and separators (٫ decimal, ٬ thousands) and splits a decimal string. */
function splitDecimal(input: string): DecimalParts {
  if (typeof input !== 'string') throw new RangeError('decimal input must be a string');
  const normalized = toLatinDigits(input)
    .replace(BIDI_MARKS, '')
    .trim()
    .replaceAll('٫', '.')
    .replaceAll('٬', ',');
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

/** Parses an exchange rate into an integer scaled by 10^RATE_SCALE. It must be > 0 with ≤ 6 decimals. */
export function parseRate(rate: string): bigint {
  const { fracDigits } = splitDecimal(rate);
  if (fracDigits.replace(/0+$/, '').length > RATE_SCALE) {
    throw new RangeError(`exchange rate ${JSON.stringify(rate)} has more than ${RATE_SCALE} decimal places`);
  }
  const scaled = parseDecimal(rate, RATE_SCALE);
  if (scaled <= 0n)
    throw new RangeError(`exchange rate must be greater than zero, got ${JSON.stringify(rate)}`);
  return scaled;
}

/** Parses a user-entered amount ("12.50", "١٬٢٥٠") into minor units of `currency`. */
export function toMinor(amount: string, currency: CurrencyCode): number {
  const { decimals } = currencyInfo(currency);
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
export function formatMoney(minor: number, currency: CurrencyCode, opts: FormatMoneyOptions = {}): string {
  assertSafeInteger(minor, 'minor');
  const { decimals, symbolAr } = currencyInfo(currency);
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
 * Converts minor units of `from` into minor units of `to`. `rate` is how many units of `to` one unit of
 * `from` buys (USD→SYP "13000", SYP→USD "0.000077"). Same currency returns the amount unchanged.
 */
export function convert(minor: number, from: CurrencyCode, to: CurrencyCode, rate: string): number {
  assertSafeInteger(minor, 'minor');
  const source = currencyInfo(from);
  const target = currencyInfo(to);
  if (from === to) return minor;
  const numerator = BigInt(minor) * parseRate(rate) * pow10(target.decimals);
  const denominator = pow10(source.decimals) * pow10(RATE_SCALE);
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
