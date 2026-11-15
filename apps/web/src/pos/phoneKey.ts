import { toLatinDigits } from '@serva/core/text';

/**
 * A phone as digits without the country code or the leading zero: «0933 333 333», «+963 933 333 333»
 * and «933333333» all give «933333333». What the cashier types and what is stored then always meet.
 */
export function phoneKey(text: string): string {
  return toLatinDigits(text)
    .replace(/\D/g, '')
    .replace(/^(00963|963|0)/, '');
}
