import { sql } from 'drizzle-orm';
import {
  type ControlledRegisterBalance,
  type ControlledRegisterQuery,
  type ControlledRegisterResponse,
  type ControlledRegisterRow,
} from '@serva/core';
import { withTenant, type Database } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';

/**
 * «سجل الأدوية المراقبة» (03 › الصيدليات): every stock movement of a controlled item, read from
 * the documents that made it (a sale, a return, a receipt, a count…), so nothing is kept twice.
 * Each row carries the batch and the prescription of its document, and the item's balance after
 * it. The register is checked against the stock now: a difference is shown, never hidden.
 */
export function controlledRegister(
  db: Database,
  auth: AccessClaims,
  query: ControlledRegisterQuery,
): Promise<ControlledRegisterResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'pharmacy.controlled');
    const rows = await tx.execute<{
      date: string;
      variant_id: string;
      item: string;
      kind: string;
      document: string | null;
      batch_no: string | null;
      rx: {
        ref?: string | null;
        doctor?: string | null;
        patientName?: string | null;
        patientId?: string | null;
      } | null;
      qty: string;
      balance: string;
    }>(sql`
      with mv as (
        select m.variant_id, m.kind, m.doc_id, m.line_no, m.qty, m.business_date, m.created_at, m.id,
               sum(m.qty) over (partition by m.variant_id order by m.business_date, m.created_at, m.id) as balance,
               trim(p.name_ar || ' ' || coalesce(v.label, '')) as item
        from stock_movements m
        join variants v on v.tenant_id = m.tenant_id and v.id = m.variant_id
        join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
        where p.controlled
      )
      select mv.business_date::text as date, mv.variant_id, mv.item, mv.kind, mv.qty, mv.balance,
             coalesce(i.number, r.number, pu.number) as document,
             coalesce(
               (select l ->> 'batchNo' from jsonb_array_elements(i.payload -> 'lines') l
                 where (l ->> 'lineNo')::int = mv.line_no),
               (select l ->> 'batchNo' from jsonb_array_elements(ri.payload -> 'lines') l
                 where (l ->> 'lineNo')::int = rl.sale_line_no),
               pl.batch_no) as batch_no,
             coalesce(i.payload -> 'prescription', ri.payload -> 'prescription') as rx
      from mv
      left join invoices i on mv.kind = 'sale' and i.id = mv.doc_id
      left join sale_returns r on mv.kind = 'return' and r.id = mv.doc_id
      left join sale_return_lines rl on rl.return_id = r.id and rl.line_no = mv.line_no
      left join invoices ri on ri.id = r.sale_id
      left join purchases pu on mv.kind = 'purchase' and pu.id = mv.doc_id
      left join purchase_lines pl on pl.purchase_id = pu.id and pl.line_no = mv.line_no
      where mv.business_date between ${query.from}::date and ${query.to}::date
      order by mv.business_date, mv.created_at, mv.id`);

    const result: ControlledRegisterRow[] = rows.map((r) => {
      const qty = Number(r.qty);
      return {
        date: r.date,
        variantId: r.variant_id,
        item: r.item,
        batchNo: r.batch_no,
        kind: r.kind,
        document: r.document,
        prescriptionRef: r.rx?.ref ?? null,
        doctor: r.rx?.doctor ?? null,
        patientName: r.rx?.patientName ?? null,
        patientId: r.rx?.patientId ?? null,
        qtyIn: qty > 0 ? qty : 0,
        qtyOut: qty < 0 ? -qty : 0,
        balance: Number(r.balance),
      };
    });

    // The whole history against what the shelves hold now, item by item
    const totals = await tx.execute<{
      variant_id: string;
      item: string;
      register_qty: string;
      stock_qty: string;
    }>(sql`
      select v.id as variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as item,
             coalesce((select sum(m.qty) from stock_movements m where m.variant_id = v.id), 0) as register_qty,
             coalesce((select sum(s.qty) from stock_levels s where s.variant_id = v.id), 0) as stock_qty
      from variants v
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      where p.controlled and p.type = 'stock'
      order by item`);
    const balances: ControlledRegisterBalance[] = totals.map((t) => ({
      variantId: t.variant_id,
      item: t.item,
      registerQty: Number(t.register_qty),
      stockQty: Number(t.stock_qty),
      matches: Number(t.register_qty) === Number(t.stock_qty),
    }));
    return {
      from: query.from,
      to: query.to,
      rows: result,
      balances,
      matches: balances.every((b) => b.matches),
    };
  });
}
