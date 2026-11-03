import { sql } from 'drizzle-orm';
import { stockBack, stockOut, type StockValue } from '@serva/core';
import { movementCosts, stockValues, withTenant, type Database, type Transaction } from '@serva/db';
import { postEntry, type DraftLine } from './posting';

/**
 * The cost of what was sold (10 › الكلفة والربح; packages/core › costing.ts). Sales and returns are
 * processed from the tills with no cost (a till never holds one); here each sold or returned line
 * is costed once, at its branch's running average by value, in the order of the day: business date,
 * then the time it reached the server. One entry per branch and day of the run: Dr 5100 cost of
 * sales, Cr 1300 inventory (the other way for returns). movement_costs keeps each line's cost so
 * it is never costed twice.
 *
 * It runs after every push (in its own transaction: a failure never loses a sale, it is costed on
 * the next run), and before a purchase or a count, so they meet stock that is up to date. A store
 * that never entered a purchase has nothing valued: its lines cost nothing and post nothing.
 */

/** A list of ids as a Postgres uuid[] (a JS array would be sent as a record) */
export const uuidArray = (ids: readonly string[]) =>
  ids.length === 0
    ? sql`'{}'::uuid[]`
    : sql`array[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]`;

export type StockKey = `${string}|${string}`;
export const stockKey = (branchId: string, variantId: string): StockKey => `${branchId}|${variantId}`;

/** The stock values of these branch–variant pairs, locked for this transaction. */
export async function loadValues(
  tx: Transaction,
  tenantId: string,
  keys: StockKey[],
): Promise<Map<StockKey, StockValue>> {
  const out = new Map<StockKey, StockValue>();
  if (keys.length === 0) return out;
  const branches = [...new Set(keys.map((k) => k.split('|')[0]!))];
  const variants = [...new Set(keys.map((k) => k.split('|')[1]!))];
  const rows = await tx.execute<{
    branch_id: string;
    variant_id: string;
    qty: string;
    value_minor: string;
    ref_qty: string;
    ref_value_minor: string;
  }>(sql`
    select branch_id, variant_id, qty::text, value_minor::text, ref_qty::text, ref_value_minor::text
    from stock_values
    where tenant_id = ${tenantId} and branch_id = any(${uuidArray(branches)}) and variant_id = any(${uuidArray(variants)})
    for update`);
  for (const r of rows) {
    out.set(stockKey(r.branch_id, r.variant_id), {
      qty: Number(r.qty),
      valueMinor: Number(r.value_minor),
      refQty: Number(r.ref_qty),
      refValueMinor: Number(r.ref_value_minor),
    });
  }
  return out;
}

export async function saveValues(
  tx: Transaction,
  tenantId: string,
  values: Map<StockKey, StockValue>,
): Promise<void> {
  for (const [key, v] of values) {
    const [branchId, variantId] = key.split('|') as [string, string];
    await tx
      .insert(stockValues)
      .values({
        tenantId,
        branchId,
        variantId,
        qty: v.qty,
        valueMinor: v.valueMinor,
        refQty: v.refQty,
        refValueMinor: v.refValueMinor,
      })
      .onConflictDoUpdate({
        target: [stockValues.tenantId, stockValues.branchId, stockValues.variantId],
        set: {
          qty: v.qty,
          valueMinor: v.valueMinor,
          refQty: v.refQty,
          refValueMinor: v.refValueMinor,
          updatedAt: sql`now()`,
        },
      });
  }
}

const EMPTY: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };

async function baseCurrency(tx: Transaction): Promise<string> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return row?.base ?? 'SYP';
}

/** Dr 5100 / Cr 1300 for `costMinor` (negative swaps them), in the base currency. */
export function costLines(costMinor: number, currency: string, counter = '5100', memo?: string): DraftLine[] {
  const line = (code: string, baseMinor: number): DraftLine => ({
    account: { code },
    baseMinor,
    currency,
    amountMinor: baseMinor,
    rate: null,
    memo: memo ?? null,
  });
  return [line(counter, costMinor), line('1300', -costMinor)];
}

/** Costs every sold or returned line not costed yet. Returns how many lines it costed. */
export async function costPending(tx: Transaction, tenantId: string): Promise<number> {
  const pending = await tx.execute<{
    doc_id: string;
    line_no: number;
    branch_id: string;
    variant_id: string;
    qty: string;
    kind: 'sale' | 'return';
    business_date: string;
  }>(sql`
    select m.doc_id, m.line_no, m.branch_id, m.variant_id, m.qty::text, m.kind, m.business_date::text
    from stock_movements m
    where m.tenant_id = ${tenantId} and m.kind in ('sale', 'return')
      and not exists (
        select 1 from movement_costs c
        where c.tenant_id = m.tenant_id and c.doc_id = m.doc_id and c.line_no = m.line_no)
    order by m.business_date, m.created_at, m.doc_id, m.line_no
    limit 5000`);
  if (pending.length === 0) return 0;

  const values = await loadValues(
    tx,
    tenantId,
    pending.map((p) => stockKey(p.branch_id, p.variant_id)),
  );
  const costs: { row: (typeof pending)[number]; costMinor: number }[] = [];
  for (const row of pending) {
    const key = stockKey(row.branch_id, row.variant_id);
    const now = values.get(key) ?? EMPTY;
    const qty = Number(row.qty);
    if (qty < 0) {
      const out = stockOut(now, -qty);
      values.set(key, out.after);
      costs.push({ row, costMinor: out.costMinor });
    } else {
      const back = stockBack(now, qty);
      values.set(key, back.after);
      costs.push({ row, costMinor: -back.valueMinor });
    }
  }
  await saveValues(tx, tenantId, values);

  // One entry per branch and business day
  const currency = await baseCurrency(tx);
  const groups = new Map<string, typeof costs>();
  for (const c of costs) {
    const key = `${c.row.branch_id}|${c.row.business_date}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [key, list] of groups) {
    const [branchId, date] = key.split('|') as [string, string];
    const total = list.reduce((sum, c) => sum + c.costMinor, 0);
    const [ids] = await tx.execute<{ id: string }>(sql`select uuid_generate_v7() as id`);
    const entryId = await postEntry(tx, {
      tenantId,
      branchId,
      date,
      sourceType: 'cost_of_sales',
      sourceId: ids!.id,
      sourceNumber: null,
      memo: `كلفة المبيعات ليوم ${date}`,
      baseCurrency: currency,
      lines: costLines(total, currency),
    });
    await tx.insert(movementCosts).values(
      list.map((c) => ({
        tenantId,
        docId: c.row.doc_id,
        lineNo: c.row.line_no,
        branchId,
        variantId: c.row.variant_id,
        businessDate: date,
        kind: c.row.kind,
        costMinor: c.costMinor,
        entryId,
      })),
    );
  }
  return pending.length;
}

/** costPending for one store in its own transaction (after a push), never throwing. */
export async function costAfterPush(
  db: Database,
  tenantId: string,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await withTenant(db, tenantId, (tx) => costPending(tx, tenantId));
  } catch (error) {
    onError(error);
  }
}
