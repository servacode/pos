import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  allocateFefo,
  businessDateOf,
  sameBatch,
  type BatchAllocation,
  type BatchBlockInput,
  type BatchBlockResult,
  type ExpiryResponse,
  type RecallResponse,
  type StockBatch,
} from '@serva/core';
import { batchBlocks, batchMovements, withTenant, type Database, type Transaction } from '@serva/db';
import type { SyncFlag } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { uuidArray } from './costing';

/**
 * The batch ledger (03 › الصيدليات: الدفعة والصلاحية): a parallel, append-only record of which batch
 * each piece came from and went to. It never changes stock levels, costing or postings; it answers
 * "what is left of batch X here", "who got batch X" and "which batches are about to expire".
 * A batch is an item, a number ('' when it has none) and an expiry (null when it has none).
 */

const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/** One ledger row to write: signed base units */
export interface LedgerRow {
  variantId: string;
  batchNo: string | null;
  expiry: string | null;
  qty: number;
  lineNo: number;
  allocNo?: number;
}

export interface LedgerScope {
  tenantId: string;
  branchId: string;
  kind: string;
  docId: string;
  date: string;
}

export async function recordBatchMovements(
  tx: Transaction,
  scope: LedgerScope,
  rows: readonly LedgerRow[],
): Promise<void> {
  const live = rows.filter((r) => r.qty !== 0);
  if (live.length === 0) return;
  await tx
    .insert(batchMovements)
    .values(
      live.map((r) => ({
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        variantId: r.variantId,
        batchNo: r.batchNo ?? '',
        expiryDate: r.expiry,
        qty: r.qty,
        kind: scope.kind,
        docId: scope.docId,
        lineNo: r.lineNo,
        allocNo: r.allocNo ?? 0,
        businessDate: scope.date,
      })),
    )
    .onConflictDoNothing();
}

/** The till's list on the stock level rows and the item's nearest expiry, from the ledger (SQL functions of 0059). */
export async function refreshBatches(
  tx: Transaction,
  branchIds: readonly string[],
  variantIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return;
  await tx.execute(
    sql`select refresh_batch_cache(app_current_tenant(), ${uuidArray([...new Set(branchIds)])}, ${uuidArray(ids)})`,
  );
  await tx.execute(sql`select refresh_variant_expiry(app_current_tenant(), ${uuidArray(ids)})`);
}

/** What each item has left of each batch in a branch (negative balances included), blocked ones marked. */
export async function batchPool(
  tx: Transaction,
  branchId: string,
  variantIds: readonly string[],
): Promise<Map<string, StockBatch[]>> {
  const pool = new Map<string, StockBatch[]>();
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return pool;
  const rows = await tx.execute<{
    variant_id: string;
    batch_no: string | null;
    expiry: string | null;
    qty: string;
    blocked: boolean;
  }>(sql`
    select m.variant_id, nullif(m.batch_no, '') as batch_no, m.expiry_date::text as expiry, sum(m.qty)::text as qty,
           exists (select 1 from batch_blocks b where b.variant_id = m.variant_id and b.batch_no = m.batch_no
                   and b.released_at is null) as blocked
    from batch_movements m
    where m.branch_id = ${branchId} and m.variant_id = any(${uuidArray(ids)})
    group by m.variant_id, m.batch_no, m.expiry_date
    having sum(m.qty) <> 0`);
  for (const r of rows) {
    const list = pool.get(r.variant_id) ?? [];
    list.push({ batchNo: r.batch_no, expiry: r.expiry, qty: Number(r.qty), blocked: r.blocked });
    pool.set(r.variant_id, list);
  }
  return pool;
}

// ─── Sales ────────────────────────────────────────────────────────────────────

interface SaleLineBatches {
  lineNo: number;
  variantId: string;
  baseQty: number;
  batchNo?: string | null | undefined;
  batchExpiry?: string | null | undefined;
  batches?: readonly BatchAllocation[] | undefined;
}

/**
 * A sale's batches into the ledger. The till's allocations are taken as printed (never refused):
 * one that goes past the batch's balance is flagged batch_over_balance, one on a blocked or
 * expired batch is flagged batch_blocked. A line with no batch (an older till, or an item the till
 * knew no batches of) is taken first-expiry-first from what the branch holds, as far as it covers.
 */
export async function recordSaleBatches(
  tx: Transaction,
  scope: Omit<LedgerScope, 'kind'>,
  lines: readonly SaleLineBatches[],
): Promise<SyncFlag[]> {
  const live = lines.filter((l) => l.baseQty > 0);
  const pool = await batchPool(
    tx,
    scope.branchId,
    live.map((l) => l.variantId),
  );
  const flags = new Set<SyncFlag>();
  const rows: LedgerRow[] = [];
  const touched: string[] = [];
  for (const line of live) {
    const held = pool.get(line.variantId) ?? [];
    const given: readonly BatchAllocation[] = line.batches?.length
      ? line.batches
      : line.batchNo
        ? [{ batchNo: line.batchNo, expiry: line.batchExpiry ?? null, qty: line.baseQty }]
        : [];
    let allocations: readonly BatchAllocation[] = given;
    if (given.length === 0) {
      if (held.length === 0) continue;
      const auto = allocateFefo(held, line.baseQty, scope.date);
      allocations = auto.allocations;
      pool.set(line.variantId, auto.remaining);
    } else {
      for (const a of given) {
        const at = held.find((b) => sameBatch(b, a));
        if (!at || at.qty < a.qty) flags.add('batch_over_balance');
        if (at?.blocked || (a.expiry && a.expiry < scope.date)) flags.add('batch_blocked');
        if (at) at.qty -= a.qty;
        else held.push({ batchNo: a.batchNo, expiry: a.expiry, qty: -a.qty });
      }
      pool.set(line.variantId, held);
    }
    allocations.forEach((a, n) =>
      rows.push({
        variantId: line.variantId,
        batchNo: a.batchNo,
        expiry: a.expiry,
        qty: -a.qty,
        lineNo: line.lineNo,
        allocNo: n,
      }),
    );
    if (allocations.length > 0) touched.push(line.variantId);
  }
  await recordBatchMovements(tx, { ...scope, kind: 'sale' }, rows);
  await refreshBatches(tx, [scope.branchId], touched);
  return [...flags];
}

/**
 * A return puts the pieces back on the batches the sale line took them from. The line's batches
 * are filled from the last backwards, so what earlier returns of the same line already put back
 * (`before`) is skipped first. Pure; returns what goes back on each batch.
 */
export function returnShares(
  allocations: readonly BatchAllocation[],
  before: number,
  qty: number,
): BatchAllocation[] {
  const out: BatchAllocation[] = [];
  let skip = before;
  let left = qty;
  for (const a of [...allocations].reverse()) {
    const free = Math.max(0, a.qty - skip);
    skip = Math.max(0, skip - a.qty);
    const put = Math.min(left, free);
    if (put > 0) out.push({ batchNo: a.batchNo, expiry: a.expiry, qty: put });
    left -= put;
    if (left === 0) break;
  }
  return out;
}

/** A sale return's pieces back onto the batches their sale lines took them from. */
export async function recordReturnBatches(
  tx: Transaction,
  scope: Omit<LedgerScope, 'kind'> & { saleId: string },
  lines: readonly { lineNo: number; saleLineNo: number; variantId: string; baseQty: number }[],
): Promise<void> {
  const live = lines.filter((l) => l.baseQty > 0);
  if (live.length === 0) return;
  const sold = await tx.execute<{
    line_no: number;
    batch_no: string;
    expiry: string | null;
    qty: string;
  }>(sql`
    select line_no, batch_no, expiry_date::text as expiry, (-qty)::text as qty
    from batch_movements
    where kind = 'sale' and doc_id = ${scope.saleId} and line_no = any(${sql`array[${sql.join(
      live.map((l) => sql`${l.saleLineNo}::int`),
      sql`, `,
    )}]`})
    order by line_no, alloc_no`);
  if (sold.length === 0) return;
  const earlier = await tx.execute<{ sale_line_no: number; qty: string }>(sql`
    select rl.sale_line_no, sum(rl.base_qty)::text as qty
    from sale_return_lines rl join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
    where r.sale_id = ${scope.saleId} and r.id <> ${scope.docId}
    group by rl.sale_line_no`);
  const before = new Map(earlier.map((e) => [e.sale_line_no, Number(e.qty)]));
  const rows: LedgerRow[] = [];
  const touched: string[] = [];
  for (const line of live) {
    const allocations = sold
      .filter((s) => s.line_no === line.saleLineNo)
      .map((s) => ({ batchNo: s.batch_no || null, expiry: s.expiry, qty: Number(s.qty) }));
    returnShares(allocations, before.get(line.saleLineNo) ?? 0, line.baseQty).forEach((share, n) => {
      rows.push({
        variantId: line.variantId,
        batchNo: share.batchNo,
        expiry: share.expiry,
        qty: share.qty,
        lineNo: line.lineNo,
        allocNo: n,
      });
      touched.push(line.variantId);
    });
  }
  await recordBatchMovements(tx, { ...scope, kind: 'return' }, rows);
  await refreshBatches(tx, [scope.branchId], touched);
}

// ─── Dashboard documents that take stock out ──────────────────────────────────

export interface TakeLine {
  lineNo: number;
  variantId: string;
  qty: number;
  batchNo?: string | null | undefined;
  expiryDate?: string | null | undefined;
}

/**
 * The batches a dashboard document takes from (supplier return, transfer, count): the one named,
 * which must hold that much, or else the earliest expiry first (expired and blocked batches too,
 * as it is the shelf being emptied). Returns positive quantities; the caller writes them out.
 */
export async function takeBatches(
  tx: Transaction,
  branchId: string,
  lines: readonly TakeLine[],
  path: (index: number) => string,
): Promise<LedgerRow[]> {
  const pool = await batchPool(
    tx,
    branchId,
    lines.map((l) => l.variantId),
  );
  const rows: LedgerRow[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.qty <= 0) continue;
    const held = pool.get(line.variantId) ?? [];
    if (line.batchNo || line.expiryDate) {
      const want = { batchNo: line.batchNo || null, expiry: line.expiryDate ?? null };
      const at = held.find((b) => sameBatch(b, want));
      const have = Math.max(0, at?.qty ?? 0);
      if (!at || have < line.qty) {
        throw invalid({ [path(i)]: `في هذه الدفعة ${have / 1000} فقط في هذا الفرع` });
      }
      at.qty -= line.qty;
      rows.push({ variantId: line.variantId, ...want, qty: line.qty, lineNo: line.lineNo });
      continue;
    }
    const taken = allocateFefo(
      held.map((b) => ({ ...b, blocked: false })),
      line.qty,
      '0000-01-01',
    );
    pool.set(line.variantId, taken.remaining);
    taken.allocations.forEach((a, n) =>
      rows.push({
        variantId: line.variantId,
        batchNo: a.batchNo,
        expiry: a.expiry,
        qty: a.qty,
        lineNo: line.lineNo,
        allocNo: n,
      }),
    );
  }
  return rows;
}

/** A batch's balance in a branch (0 when it holds none) */
export async function batchBalance(
  tx: Transaction,
  branchId: string,
  variantId: string,
  batchNo: string | null,
  expiry: string | null,
): Promise<number> {
  const [row] = await tx.execute<{ qty: string | null }>(sql`
    select sum(qty)::text as qty from batch_movements
    where branch_id = ${branchId} and variant_id = ${variantId} and batch_no = ${batchNo ?? ''}
      and expiry_date is not distinct from ${expiry}::date`);
  return Number(row?.qty ?? 0);
}

// ─── Reports and recall ───────────────────────────────────────────────────────

export function expiryReport(
  db: Database,
  auth: AccessClaims,
  days: number,
  now: Date,
  only: { variantId?: string | undefined; branchId?: string | undefined } = {},
): Promise<ExpiryResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [tenant] = await tx.execute<{ timezone: string }>(
      sql`select timezone from tenants where id = ${auth.tenantId}`,
    );
    const today = businessDateOf(now, tenant?.timezone ?? 'Asia/Damascus');
    const rows = await tx.execute<{
      variant_id: string;
      name: string;
      branch_id: string;
      branch_name: string;
      batch_no: string;
      expiry_date: string | null;
      qty: string;
      number: string | null;
      supplier_id: string | null;
      supplier_name: string | null;
      received_on: string | null;
      blocked: boolean;
      reason: string | null;
    }>(sql`
      select b.variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, b.branch_id, br.name as branch_name,
             b.batch_no, b.expiry_date::text as expiry_date, b.qty::text,
             r.number, r.supplier_id, r.supplier_name, r.received_on,
             (bl.id is not null) as blocked, bl.reason
      from (select variant_id, branch_id, batch_no, expiry_date, sum(qty) as qty
            from batch_movements group by variant_id, branch_id, batch_no, expiry_date having sum(qty) > 0) b
      join variants v on v.tenant_id = ${auth.tenantId} and v.id = b.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      join branches br on br.tenant_id = ${auth.tenantId} and br.id = b.branch_id
      left join batch_blocks bl on bl.variant_id = b.variant_id and bl.batch_no = b.batch_no and bl.released_at is null
      left join lateral (
        select pu.number, pu.supplier_id, s.name as supplier_name, pu.business_date::text as received_on
        from purchase_lines l
        join purchases pu on pu.tenant_id = l.tenant_id and pu.id = l.purchase_id
        join suppliers s on s.tenant_id = pu.tenant_id and s.id = pu.supplier_id
        where l.variant_id = b.variant_id and coalesce(l.batch_no, '') = b.batch_no
          and l.expiry_date is not distinct from b.expiry_date
        order by pu.business_date, pu.created_at limit 1) r on true
      where ${
        only.variantId
          ? sql`b.variant_id = ${only.variantId}`
          : sql`(bl.id is not null or b.expiry_date <= ${today}::date + ${days}::int)`
      }
        ${only.branchId ? sql`and b.branch_id = ${only.branchId}` : sql``}
      order by b.expiry_date nulls last, name, br.name`);
    const day = Date.parse(`${today}T00:00:00Z`);
    return {
      today,
      items: rows.map((r) => ({
        variantId: r.variant_id,
        name: r.name,
        branchId: r.branch_id,
        branchName: r.branch_name,
        batchNo: r.batch_no || null,
        expiryDate: r.expiry_date,
        purchaseNumber: r.number,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        receivedOn: r.received_on,
        qty: Number(r.qty),
        daysLeft: r.expiry_date
          ? Math.round((Date.parse(`${r.expiry_date}T00:00:00Z`) - day) / 86_400_000)
          : null,
        blocked: r.blocked,
        blockReason: r.reason,
      })),
    };
  });
}

/** Stops (or lets) every till sell a batch: one item's, or every item that holds this batch number. */
export function setBatchBlocked(
  db: Database,
  auth: AccessClaims,
  input: BatchBlockInput,
  blocked: boolean,
  meta: RequestMeta,
): Promise<BatchBlockResult> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const known = await tx.execute<{ variant_id: string }>(sql`
      select distinct variant_id from batch_movements where batch_no = ${input.batchNo}
      ${input.variantId ? sql`and variant_id = ${input.variantId}` : sql``}
      union
      select variant_id from batch_blocks where batch_no = ${input.batchNo}
      ${input.variantId ? sql`and variant_id = ${input.variantId}` : sql``}`);
    const ids = known.map((r) => r.variant_id);
    if (ids.length === 0) throw new AppError(404, 'not_found', 'لا توجد دفعة بهذا الرقم.');
    if (blocked) {
      await tx
        .insert(batchBlocks)
        .values(
          ids.map((variantId) => ({
            tenantId: auth.tenantId,
            variantId,
            batchNo: input.batchNo,
            reason: input.reason ?? null,
            blockedBy: auth.userId,
          })),
        )
        .onConflictDoUpdate({
          target: [batchBlocks.tenantId, batchBlocks.variantId, batchBlocks.batchNo],
          set: {
            releasedAt: null,
            reason: input.reason ?? null,
            blockedBy: auth.userId,
            blockedAt: sql`now()`,
          },
        });
    } else {
      await tx
        .update(batchBlocks)
        .set({ releasedAt: sql`now()` })
        .where(and(eq(batchBlocks.batchNo, input.batchNo), inArray(batchBlocks.variantId, ids)));
    }
    const branchRows = await tx.execute<{ id: string }>(sql`select id from branches`);
    await refreshBatches(
      tx,
      branchRows.map((b) => b.id),
      ids,
    );
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: blocked ? 'batch.block' : 'batch.unblock',
        entity: 'batch',
        entityId: ids[0]!,
        changes: { batchNo: [null, input.batchNo], items: [null, ids.length] },
      },
      meta,
    );
    return { count: ids.length };
  });
}

/** «سحب دفعة»: where a batch came from, what is left, and every invoice and customer that got it. */
export function recall(db: Database, auth: AccessClaims, batchNo: string): Promise<RecallResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const found = await tx.execute<{
      variant_id: string;
      name: string;
      expiry: string | null;
      sold: string;
      blocked: boolean;
      reason: string | null;
    }>(sql`
      select m.variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, m.expiry_date::text as expiry,
             coalesce(-sum(m.qty) filter (where m.kind = 'sale'), 0)::text as sold,
             (bl.id is not null) as blocked, bl.reason
      from batch_movements m
      join variants v on v.tenant_id = m.tenant_id and v.id = m.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join batch_blocks bl on bl.variant_id = m.variant_id and bl.batch_no = m.batch_no and bl.released_at is null
      where m.batch_no = ${batchNo}
      group by m.variant_id, p.name_ar, v.label, m.expiry_date, bl.id, bl.reason
      order by name, m.expiry_date`);
    const blocksOnly = await tx.execute<{ variant_id: string; name: string; reason: string | null }>(sql`
      select b.variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, b.reason
      from batch_blocks b join variants v on v.tenant_id = b.tenant_id and v.id = b.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      where b.batch_no = ${batchNo} and b.released_at is null
        and not exists (select 1 from batch_movements m where m.variant_id = b.variant_id and m.batch_no = b.batch_no)`);
    const receipts = await tx.execute<{
      variant_id: string;
      expiry: string | null;
      number: string;
      supplier_name: string;
      received_on: string;
      qty: string;
    }>(sql`
      select l.variant_id, l.expiry_date::text as expiry, pu.number, s.name as supplier_name,
             pu.business_date::text as received_on, l.qty::text
      from purchase_lines l
      join purchases pu on pu.tenant_id = l.tenant_id and pu.id = l.purchase_id
      join suppliers s on s.tenant_id = pu.tenant_id and s.id = pu.supplier_id
      where l.batch_no = ${batchNo}
      order by pu.business_date, pu.number`);
    const left = await tx.execute<{
      variant_id: string;
      expiry: string | null;
      branch_id: string;
      branch_name: string;
      qty: string;
    }>(sql`
      select m.variant_id, m.expiry_date::text as expiry, m.branch_id, br.name as branch_name, sum(m.qty)::text as qty
      from batch_movements m join branches br on br.tenant_id = m.tenant_id and br.id = m.branch_id
      where m.batch_no = ${batchNo}
      group by m.variant_id, m.expiry_date, m.branch_id, br.name having sum(m.qty) <> 0
      order by br.name`);
    const sales = await tx.execute<{
      invoice_id: string;
      number: string;
      business_date: string;
      branch_name: string;
      variant_id: string;
      name: string;
      qty: string;
      customer_name: string | null;
      customer_phone: string | null;
    }>(sql`
      select i.id as invoice_id, i.number, i.business_date::text, br.name as branch_name, m.variant_id,
             trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, (-sum(m.qty))::text as qty,
             coalesce(c.name, i.customer_name) as customer_name, c.phone as customer_phone
      from batch_movements m
      join invoices i on i.tenant_id = m.tenant_id and i.id = m.doc_id
      join branches br on br.tenant_id = i.tenant_id and br.id = i.branch_id
      join variants v on v.tenant_id = m.tenant_id and v.id = m.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
      where m.kind = 'sale' and m.batch_no = ${batchNo}
      group by i.id, i.number, i.business_date, br.name, m.variant_id, p.name_ar, v.label, c.name, i.customer_name, c.phone
      order by i.business_date desc, i.number desc`);
    const batches = [
      ...found.map((f) => ({
        variantId: f.variant_id,
        name: f.name,
        batchNo,
        expiryDate: f.expiry,
        blocked: f.blocked,
        blockReason: f.reason,
        receipts: receipts
          .filter((r) => r.variant_id === f.variant_id && r.expiry === f.expiry)
          .map((r) => ({
            purchaseNumber: r.number,
            supplierName: r.supplier_name,
            receivedOn: r.received_on,
            qty: Number(r.qty),
          })),
        branches: left
          .filter((l) => l.variant_id === f.variant_id && l.expiry === f.expiry)
          .map((l) => ({ branchId: l.branch_id, branchName: l.branch_name, qty: Number(l.qty) })),
        soldQty: Number(f.sold),
      })),
      ...blocksOnly.map((b) => ({
        variantId: b.variant_id,
        name: b.name,
        batchNo,
        expiryDate: null,
        blocked: true,
        blockReason: b.reason,
        receipts: [],
        branches: [],
        soldQty: 0,
      })),
    ];
    return {
      batchNo,
      batches,
      sales: sales.map((s) => ({
        invoiceId: s.invoice_id,
        invoiceNumber: s.number,
        date: s.business_date,
        branchName: s.branch_name,
        variantId: s.variant_id,
        name: s.name,
        qty: Number(s.qty),
        customerName: s.customer_name,
        customerPhone: s.customer_phone,
      })),
    };
  });
}

/** An item that must carry an expiry date on a purchase line (the product's «يتطلب صلاحية») */
export async function requiringExpiry(tx: Transaction, variantIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`
    select v.id from variants v join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    where v.id = any(${uuidArray(ids)}) and p.requires_expiry`);
  return new Set(rows.map((r) => r.id));
}
