import { sql } from 'drizzle-orm';
import type { Transaction } from '@serva/db';
import { postEntry } from './posting';

/**
 * Past returns of credit sales that the books paid back from the drawer (before «إلى حساب الزبون»
 * existed): the candidates, and, when asked, one correcting manual entry each, Dr 1110 Cr 1200 for the
 * customer, dated `today`. Unique by the return it corrects, so a second run posts nothing. The
 * script scripts/correct-credit-returns.ts is the only caller; it is opt-in and never run by itself.
 */

/**
 * When «إلى حساب الزبون» went live (the commit that added it, 2026-11-12 09:13 +03). Nothing in a
 * stored return tells an old till's cash refund from a deliberate cash refund made since: the
 * payload, the engine version (always 1.0.0) and the refund method are the same. Only the time the
 * return was made at the till separates them, so only returns made before this are candidates; the
 * owner can move it with --before when a till kept running the old version for longer.
 */
export const ACCOUNT_REFUND_LIVE_AT = new Date('2026-11-12T06:13:44.000Z');

type Candidate = {
  id: string;
  sale_id: string;
  number: string;
  sale_number: string;
  branch_id: string;
  currency: string;
  total_minor: string;
  customer_id: string;
  customer_name: string | null;
  credit_minor: string;
  corrected: boolean;
};

export interface CorrectionItem {
  returnId: string;
  returnNumber: string;
  saleNumber: string;
  customerId: string;
  customerName: string | null;
  currency: string;
  amountMinor: number;
}

export async function correctCreditReturns(
  tx: Transaction,
  tenantId: string,
  options: { apply: boolean; today: string; only?: string[] | undefined; before?: Date | undefined },
): Promise<{ items: CorrectionItem[]; posted: number }> {
  const { apply, today, only, before = ACCOUNT_REFUND_LIVE_AT } = options;
  const rows = await tx.execute<Candidate>(sql`
    select r.id, r.sale_id, r.number, r.sale_number, r.branch_id, r.currency, r.total_minor::text,
           i.customer_id, i.customer_name,
           (select coalesce(sum(p.base_amount_minor), 0) from invoice_payments p
             where p.tenant_id = i.tenant_id and p.invoice_id = i.id and p.method = 'credit')::text as credit_minor,
           exists (select 1 from journal_entries e where e.tenant_id = r.tenant_id
                     and e.source_type = 'manual' and e.kind = 'manual' and e.source_id = r.id) as corrected
    from sale_returns r
    join invoices i on i.tenant_id = r.tenant_id and i.id = r.sale_id
    where r.tenant_id = ${tenantId} and r.refund_method = 'cash' and i.customer_id is not null
      and r.device_time < ${before.toISOString()}::timestamptz
      and exists (select 1 from invoice_payments p where p.tenant_id = i.tenant_id
                    and p.invoice_id = i.id and p.method = 'credit')
    order by r.sale_id, r.business_date, r.device_time, r.id`);
  // Per sale, in order: the credit left to take back, less what earlier returns already took
  const left = new Map<string, number>();
  const plan: { row: Candidate; amount: number }[] = [];
  for (const row of rows) {
    const key = row.sale_id;
    const room = left.get(key) ?? Number(row.credit_minor);
    const amount = Math.min(Number(row.total_minor), room);
    left.set(key, room - amount);
    if (amount > 0 && !row.corrected && (!only || only.includes(row.id))) plan.push({ row, amount });
  }
  const items: CorrectionItem[] = [];
  let posted = 0;
  for (const { row, amount } of plan) {
    items.push({
      returnId: row.id,
      returnNumber: row.number,
      saleNumber: row.sale_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      currency: row.currency,
      amountMinor: amount,
    });
    if (!apply) continue;
    const id = await postEntry(tx, {
      tenantId,
      branchId: row.branch_id,
      date: today,
      sourceType: 'manual',
      sourceId: row.id,
      sourceNumber: row.number,
      kind: 'manual',
      memo: `تصحيح مرتجع ${row.number} عن الفاتورة ${row.sale_number}: خُفّض من دين الزبون بدل الرد نقداً`,
      baseCurrency: row.currency,
      lines: [
        {
          account: { cash: '1110', currency: row.currency },
          baseMinor: amount,
          currency: row.currency,
          amountMinor: amount,
          rate: null,
        },
        {
          account: { code: '1200' },
          baseMinor: -amount,
          currency: row.currency,
          amountMinor: -amount,
          rate: null,
          party: { type: 'customer', id: row.customer_id },
        },
      ],
    });
    if (id) posted += 1;
  }
  return { items, posted };
}
