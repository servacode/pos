import { sql } from 'drizzle-orm';
import { convert, roundDiv, type CurrencyCode, type PurchaseCurrencyCode, type TradeRate } from '@serva/core';
import type { Transaction } from '@serva/db';
import { AppError } from '../errors';

/**
 * Purchasing in dollars (round 36, decision 11). The pieces stay in the base currency (the stock, its
 * cost and the cost of sales never see a dollar); what a dollar invoice adds is the supplier's debt, kept
 * in dollars on its 2100 lines next to the base-currency value the books gave it, and the exchange
 * difference when that debt is paid at another rate (account 6510, «فروقات صرف محققة»).
 *
 * The books' value of a supplier's dollar debt is the sum of the base amounts of its dollar lines; the
 * rate of that debt is their average, so a part-payment takes its share of it and the rest keeps its rate.
 * A payment's difference is then what it cost at the rate of the day less the books' value of the dollars
 * it settled: positive is a loss (a debit), negative a gain (a credit).
 */

const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/** The terms of a dollar document: its rate (a quote of the dollar in the base currency) */
export interface UsdTerms {
  currency: 'USD';
  rate: TradeRate;
}

/** The latest rate of the dollar in the base currency, or null when none was ever set */
export async function storeUsdRate(tx: Transaction, base: CurrencyCode): Promise<TradeRate | null> {
  const [row] = await tx.execute<{ unit: string; quote: string; rate: string }>(sql`
    select unit, quote, rate::text from exchange_rates
    where unit = 'USD' and quote = ${base}
    order by effective_at desc, id desc limit 1`);
  return row ? ({ unit: 'USD', quote: base, rate: row.rate } as TradeRate) : null;
}

/**
 * The dollar terms of a purchase, payment or return, or null for the base currency. A dollar document
 * needs the dollar enabled in the store and a pound base; its rate is the one typed, else the store's.
 */
export async function usdTerms(
  tx: Transaction,
  base: CurrencyCode,
  input: { currency?: PurchaseCurrencyCode | undefined; rate?: string | undefined },
): Promise<UsdTerms | null> {
  if (!input.currency || input.currency === base) return null;
  if (input.currency !== 'USD' || base === 'USD') {
    throw invalid({ currency: 'هذه العملة غير متاحة للشراء في هذا المتجر' });
  }
  const [settings] = await tx.execute<{ enabled: string[] }>(
    sql`select enabled_currencies as enabled from tenant_settings`,
  );
  if (!settings?.enabled.includes('USD')) {
    throw invalid({ currency: 'فعّل الدولار من إعدادات المتجر أولاً' });
  }
  const rate: TradeRate | null = input.rate
    ? ({ unit: 'USD', quote: base, rate: input.rate } as TradeRate)
    : await storeUsdRate(tx, base);
  if (!rate) throw invalid({ rate: 'اكتب سعر الدولار اليوم' });
  return { currency: 'USD', rate };
}

/** Dollars (cents) at the rate, in the base currency: the same conversion the till uses */
export const usdToBase = (usdMinor: number, terms: UsdTerms, base: CurrencyCode): number =>
  convert(usdMinor, 'USD', base, terms.rate);

/** What a supplier is owed in dollars (cents, negative: an advance) and what the books value that at */
export async function supplierUsd(
  tx: Transaction,
  supplierId: string,
  base: CurrencyCode,
): Promise<{ usdMinor: number; bookMinor: number }> {
  if (base === 'USD') return { usdMinor: 0, bookMinor: 0 };
  const [row] = await tx.execute<{ usd: string | null; book: string | null }>(sql`
    select sum(-l.amount_minor)::text as usd, sum(l.credit_minor - l.debit_minor)::text as book
    from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where a.code = '2100' and l.party_type = 'supplier' and l.party_id = ${supplierId} and l.currency = 'USD'`);
  return { usdMinor: Number(row?.usd ?? 0), bookMinor: Number(row?.book ?? 0) };
}

/**
 * What `usdMinor` dollars paid to a supplier take off the books' value of its dollar debt. Settling the
 * whole debt takes the whole of it; part of it, its share (half away from zero); dollars beyond the debt
 * (an advance) are valued at the rate of the payment, so they never make a difference of their own.
 */
export function bookValueOfPayment(
  usdMinor: number,
  owed: { usdMinor: number; bookMinor: number },
  paidBaseMinor: (usd: number) => number,
): number {
  if (owed.usdMinor <= 0) return paidBaseMinor(usdMinor);
  if (usdMinor === owed.usdMinor) return owed.bookMinor;
  if (usdMinor < owed.usdMinor) {
    return Number(roundDiv(BigInt(owed.bookMinor) * BigInt(usdMinor), BigInt(owed.usdMinor)));
  }
  return owed.bookMinor + paidBaseMinor(usdMinor - owed.usdMinor);
}
