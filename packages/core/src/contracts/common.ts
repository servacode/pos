import { z } from 'zod';
import { CURRENCY_CODES } from '../currencies';
import { parseRate } from '../money';
import { toLatinDigits } from '../text';

/**
 * Building blocks shared by the catalog and document contracts (17 › المبادئ: المال والكميات).
 * Money is an integer of minor units with its currency id next to it, quantities are integers in
 * thousandths (1 piece = 1000), percentages are basis points, and exchange rates are decimal
 * strings. No float ever crosses the wire.
 */

export const uuidSchema = z.uuid();

/** An amount in minor units of its currency (z.int() is a safe integer); negative only where a field says so. */
export const minorSchema = z.int();
export const nonNegativeMinorSchema = z.int().nonnegative();
export const positiveMinorSchema = z.int().positive();

/** A quantity in thousandths (0.250 kg = 250), greater than zero. */
export const qtySchema = z.int().positive();

/** Basis points, 0–10000 (15% = 1500). */
export const bpSchema = z.int().min(0).max(10_000);

/** A currency a store trades in (the new pound or the dollar; the old pound is history only). */
export const currencyCodeSchema = z.enum(CURRENCY_CODES);

/**
 * A direct exchange rate between two currencies, quoted ≥ 1 with ≤ 6 decimals: one `unit` is worth
 * `rate` units of `quote` (pounds per dollar: { unit: 'USD', quote: 'SYP', rate: '130' }). The same
 * shape as money.ts ExchangeRate, so it goes straight into convert().
 */
export const exchangeRateSchema = z
  .object({
    unit: currencyCodeSchema,
    quote: currencyCodeSchema,
    rate: z.string().max(32),
  })
  .superRefine((value, ctx) => {
    if (value.unit === value.quote) {
      ctx.addIssue({ code: 'custom', path: ['quote'], message: 'a rate needs two different currencies' });
    }
    try {
      parseRate(value.rate);
    } catch (error) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: (error as Error).message });
    }
  });

/** money.ts ExchangeRate between two trading currencies. */
export type TradeRate = z.output<typeof exchangeRateSchema>;

export const isoTimeSchema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();

/** Record version for optimistic locking (17 › التعديل المتزامن): a mismatch answers 409 stale_version. */
export const versionSchema = z.int().nonnegative();

/** A short free text typed by a person (a reason, a note), trimmed. */
export const shortTextSchema = (max: number) => z.string().trim().min(1).max(max);

/** Digits typed on an Arabic keyboard («١٢٣») are read as Latin digits. */
export const latinDigits = (value: string) => toLatinDigits(value).trim();

/** Every list answer (17 › القوائم): `?cursor=&limit=` up to 200, and `{ items, nextCursor }`. */
export interface ListResponse<T> {
  items: T[];
  /** Pass back as `cursor` for the next page; null on the last page */
  nextCursor: string | null;
}

export const LIST_MAX_LIMIT = 200;

export const listPageQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(50),
};
