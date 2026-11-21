import type { Ageing } from '../ageing';
import type { CurrencyCode } from '../currencies';

/**
 * Debt ageing (10 › الذمم): each customer's balance split by the age of the debt, read from the
 * ledger lines of 1200 and nothing else.
 *
 *   GET /v1/reports/debt-ageing?asOf=YYYY-MM-DD   → DebtAgeingReport   (customers.view)
 */

export interface DebtAgeingRow {
  customerId: string;
  name: string;
  phone: string | null;
  /** What the customer owes, base currency: the sum of the four buckets */
  balanceMinor: number;
  buckets: Ageing;
}

export interface DebtAgeingReport {
  asOf: string;
  baseCurrency: CurrencyCode;
  items: DebtAgeingRow[];
  totals: Ageing & { balanceMinor: number };
}
