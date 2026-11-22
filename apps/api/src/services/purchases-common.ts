import { asc, eq, sql } from 'drizzle-orm';
import { roundDiv, type CurrencyCode } from '@serva/core';
import { branches, documentSequences, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { AppError } from '../errors';
import { uuidArray } from './costing';
import { type DraftLine } from './posting';

/**
 * Suppliers, purchases, payments to suppliers, counts, the stock's value and the profit
 * (packages/core › contracts/purchases.ts). Entered on the dashboard; every document is posted
 * once, in the same transaction as its stock, and never changed.
 *
 * - purchase:   Dr 1300 inventory; Cr 2100 for the supplier (on account), 1120 the safe (cash) or
 *               1130 the bank. Pieces sold before they were bought are settled to 5100 here.
 * - payment:    Dr 2100 for the supplier; Cr 1120 or 1130.
 * - count:      a shortage Dr 6300 / Cr 1300 at the running average; a surplus the other way.
 */

export const newId = createUuidV7();
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} غير موجود.`);
export const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/**
 * Round 62: a supplier's invoice with a cash discount and extra charges (freight). The posting stays the plain
 * purchase: the delta (charges less discount) is spread over the lines' costs in proportion to what each cost, in
 * the invoice's currency, with the remainder going to the largest lines first so the lines add up to the net exactly.
 * Returns the net cost of every line (never below zero), or an error text for the field.
 */
export function spreadAdjustment(
  costs: readonly number[],
  discountMinor: number,
  chargesMinor: number,
): { costs: number[] } | { error: string; field: 'discountMinor' | 'chargesMinor' } {
  const gross = costs.reduce((sum, c) => sum + c, 0);
  if (discountMinor > gross) return { error: 'الخصم أكبر من مجموع الفاتورة', field: 'discountMinor' };
  const delta = chargesMinor - discountMinor;
  if (delta === 0) return { costs: [...costs] };
  if (gross === 0) return { error: 'اكتب كلفة الأصناف أولاً ثم أضف الرسوم', field: 'chargesMinor' };
  const shares = costs.map((c) => roundDiv(BigInt(c) * BigInt(Math.abs(delta)), BigInt(gross)));
  let left = BigInt(Math.abs(delta)) - shares.reduce((sum, s) => sum + s, 0n);
  // The remainder (a few units either way) goes one unit at a time to the dearest lines
  const order = costs.map((_, i) => i).sort((a, b) => costs[b]! - costs[a]! || a - b);
  const step = left >= 0n ? 1n : -1n;
  for (let k = 0; left !== 0n; k = (k + 1) % order.length) {
    shares[order[k]!] = shares[order[k]!]! + step;
    left -= step;
  }
  const sign = delta > 0 ? 1 : -1;
  const net = costs.map((c, i) => c + sign * Number(shares[i]!));
  if (net.some((c) => c < 0)) return { error: 'الخصم أكبر من كلفة بعض الأصناف', field: 'discountMinor' };
  return { costs: net };
}

/** Round 44: one writer at a time per client-made document id (the retry of a dropped request waits for the first) */
export async function documentLock(tx: Transaction, kind: string, id: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${kind}:${id}`}, 0))`);
}

export async function baseCurrency(tx: Transaction): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return (row?.base ?? 'SYP') as CurrencyCode;
}

export async function branchOf(tx: Transaction, branchId: string | undefined): Promise<string> {
  const [row] = branchId
    ? await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId))
    : await tx
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.kind, 'store'))
        .orderBy(asc(branches.code))
        .limit(1);
  if (!row) throw invalid({ branchId: 'الفرع غير موجود' });
  return row.id;
}

/** The next number of a dashboard series this year: «PUR-2026-000001». */
export async function nextNumber(
  tx: Transaction,
  tenantId: string,
  series: string,
  date: string,
): Promise<string> {
  const year = Number(date.slice(0, 4));
  const [row] = await tx
    .insert(documentSequences)
    .values({ tenantId, series, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.tenantId, documentSequences.series, documentSequences.year],
      set: { lastNumber: sql`${documentSequences.lastNumber} + 1` },
    })
    .returning({ n: documentSequences.lastNumber });
  return `${series}-${year}-${String(row!.n).padStart(6, '0')}`;
}

/** Names of these variants (product and label), only for stocked products of this store. */
export async function stockedVariants(tx: Transaction, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select v.id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name
    from variants v join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    where v.id = any(${uuidArray(ids)}) and p.type = 'stock'`);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The day a supplier invoice falls due, as the books stand now: the latest correction of it (round 64: purchase_due_changes,
 * a null date clears it), else the date it was posted with. Written for a query that names the invoice `p`; the
 * purchase list and detail, the due list and the statement all share this one meaning.
 */
export const effectiveDue = sql`(case when exists (
    select 1 from purchase_due_changes c where c.tenant_id = p.tenant_id and c.purchase_id = p.id
  ) then (
    select c.due_date from purchase_due_changes c where c.tenant_id = p.tenant_id and c.purchase_id = p.id
    order by c.created_at desc, c.id desc limit 1
  ) else p.due_date end)`;

// A supplier's balance is the sum of its 2100 lines in the base currency. The lines kept in dollars (round 36,
// decision 11) also give the dollars owed (the amounts, signed like the lines) and what the books value them at.
export const supplierBalances = sql`
  select l.party_id as supplier_id, sum(l.credit_minor - l.debit_minor) as balance,
         coalesce(sum(-l.amount_minor) filter (where l.currency = 'USD' and l.currency <> st.base_currency), 0) as usd_balance,
         coalesce(sum(l.credit_minor - l.debit_minor) filter (where l.currency = 'USD' and l.currency <> st.base_currency), 0) as usd_book
  from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  cross join (select base_currency from tenant_settings limit 1) st
  where a.code = '2100' and l.party_type = 'supplier'
  group by l.party_id`;

export const PAY_ACCOUNT = (payment: 'cash' | 'bank', currency: string): DraftLine['account'] =>
  payment === 'cash' ? { cash: '1120', currency } : { code: '1130' };
