import { sql } from 'drizzle-orm';
import type { PartyStatementLine } from '@serva/core';
import type { Transaction } from '@serva/db';
import { uuidArray } from './costing';
import { effectiveDue } from './purchases';

type PurchaseExtra = NonNullable<PartyStatementLine['purchase']>;

/**
 * Round 64: what the paper of each supplier invoice on a statement says (the day it falls due as corrected, the discount, the
 * extra charges, the supplier's own number), so the statement agrees with the paper, not only with the closing balance. It
 * only reads; the statement's lines and balances are the journal's, unchanged.
 */
export async function purchaseExtras(
  tx: Transaction,
  lines: { sourceType: string; sourceId: string }[],
): Promise<Map<string, PurchaseExtra>> {
  const ids = [...new Set(lines.filter((l) => l.sourceType === 'purchase').map((l) => l.sourceId))];
  const out = new Map<string, PurchaseExtra>();
  if (ids.length === 0) return out;
  const rows = await tx.execute<{
    id: string;
    due: string | null;
    discount: string | null;
    charges: string | null;
    reference: string | null;
  }>(sql`
    select p.id, (${effectiveDue})::text as due, p.discount_minor::text as discount, p.charges_minor::text as charges, p.reference
    from purchases p
    where p.id = any(${uuidArray(ids)})`);
  for (const r of rows) {
    out.set(r.id, {
      dueDate: r.due,
      ...(r.discount !== null ? { discountMinor: Number(r.discount) } : {}),
      ...(r.charges !== null ? { chargesMinor: Number(r.charges) } : {}),
      reference: r.reference,
    });
  }
  return out;
}
