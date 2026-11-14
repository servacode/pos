import { sql } from 'drizzle-orm';
import { ageDebt, emptyAgeing, type DebtAgeingReport, type DebtAgeingRow } from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { baseCurrencyOf, storeToday } from './contracts-common';

/**
 * Debt ageing (packages/core › contracts/ageing.ts): read-only, from the journal lines of 1200 that
 * name a customer. A payment settles the oldest debt first (core › ageing.ts).
 */
export function debtAgeing(
  db: Database,
  auth: AccessClaims,
  asOf: string | undefined,
): Promise<DebtAgeingReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const day = asOf ?? (await storeToday(tx, auth.tenantId));
    const lines = await tx.execute<{
      customer_id: string;
      name: string;
      phone: string | null;
      date: string;
      debit: string;
      credit: string;
    }>(sql`
      select l.party_id as customer_id, c.name, c.phone, e.entry_date::text as date,
             l.debit_minor::text as debit, l.credit_minor::text as credit
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      join customers c on c.tenant_id = l.tenant_id and c.id = l.party_id
      where a.code = '1200' and l.party_type = 'customer' and e.entry_date <= ${day}::date
      order by l.party_id, e.entry_date`);
    const byCustomer = new Map<
      string,
      {
        name: string;
        phone: string | null;
        lines: { date: string; debitMinor: number; creditMinor: number }[];
      }
    >();
    for (const l of lines) {
      const entry = byCustomer.get(l.customer_id) ?? { name: l.name, phone: l.phone, lines: [] };
      entry.lines.push({ date: l.date, debitMinor: Number(l.debit), creditMinor: Number(l.credit) });
      byCustomer.set(l.customer_id, entry);
    }
    const totals = { ...emptyAgeing(), balanceMinor: 0 };
    const items: DebtAgeingRow[] = [];
    for (const [customerId, c] of byCustomer) {
      const buckets = ageDebt(c.lines, day);
      const balanceMinor = buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90_plus;
      if (balanceMinor <= 0) continue;
      items.push({ customerId, name: c.name, phone: c.phone, balanceMinor, buckets });
      totals.d0_30 += buckets.d0_30;
      totals.d31_60 += buckets.d31_60;
      totals.d61_90 += buckets.d61_90;
      totals.d90_plus += buckets.d90_plus;
      totals.balanceMinor += balanceMinor;
    }
    items.sort((a, b) => b.balanceMinor - a.balanceMinor || a.name.localeCompare(b.name, 'ar'));
    return { asOf: day, baseCurrency: await baseCurrencyOf(tx, auth.tenantId), items, totals };
  });
}
