import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  businessDateOf,
  stockOutAtValue,
  type PurchaseCorrection,
  type PurchaseCorrectionInput,
  type PurchaseCurrencyCode,
  type PurchaseDraft,
  type StockValue,
} from '@serva/core';
import {
  purchaseLines,
  purchaseReversals,
  purchases,
  serials,
  stockLevels,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { batchBalance, recordBatchMovements, refreshBatches, trackedVariants } from './batches';
import { costPending, loadValues, saveValues, stockKey } from './costing';
import { postEntry, type DraftLine } from './posting';
import { undoReceipt } from './purchase-order-receipt';
import { moveStock, nextNumber } from './purchases';

/**
 * «صحّح الفاتورة» (round 36, decision 12). A posted purchase is never edited; the correction is a document
 * of its own that turns it back, and the person writes the invoice again from a pre-filled draft:
 *
 * - the stock goes out of the branch at the cost the invoice brought it in at (the last pieces take what
 *   value is left, so nothing is stranded; any difference from the invoice's cost is cost of sales, 5100);
 * - the invoice's own journal entry is reversed line by line, so the supplier's debt (in dollars too, at
 *   the rate it was booked at) or the cash or bank payment comes back exactly as it went out;
 * - the batches, the serial numbers and the purchase order it received are put back as they were.
 *
 * It is refused, with the reason in plain Arabic and a pointer to a return to the supplier, when part of
 * what the invoice brought in is gone: sold, so that what is on hand (or in its batch, or its serial
 * numbers) no longer covers the invoice. An invoice that settled pieces sold before it was bought (a 5100
 * line in its entry) is refused the same way: its stock cannot be taken out at its cost.
 */

const newId = createUuidV7();
const conflict = (message: string) => new AppError(409, 'conflict', message);
const num = (value: unknown) => Number(value ?? 0);

const RETURN_HINT = 'سجّل مرتجعاً إلى المورد بدل التصحيح.';

export async function correctPurchase(
  db: Database,
  auth: AccessClaims,
  purchaseId: string,
  input: PurchaseCorrectionInput,
  meta: RequestMeta,
  now: Date,
): Promise<PurchaseCorrection> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId));
    if (!purchase) throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    const [done] = await tx
      .select({ number: purchaseReversals.number })
      .from(purchaseReversals)
      .where(eq(purchaseReversals.purchaseId, purchaseId));
    if (done) throw conflict(`هذه الفاتورة صُحّحت من قبل بالمستند ${done.number}.`);

    const lines = await tx
      .select()
      .from(purchaseLines)
      .where(eq(purchaseLines.purchaseId, purchaseId))
      .orderBy(asc(purchaseLines.lineNo));
    const [entry] = await tx.execute<{
      id: string;
      number: string;
      branch_id: string | null;
      base: string;
    }>(sql`
      select id, number, branch_id, base_currency as base from journal_entries
      where source_type = 'purchase' and source_id = ${purchaseId} and kind = 'auto'`);
    if (!entry) throw conflict('لا قيد لهذه الفاتورة في الدفاتر، فلا يمكن تصحيحها.');
    const [reversedBy] = await tx.execute<{ number: string }>(
      sql`select number from journal_entries where kind = 'reversal' and reverses_id = ${entry.id}`,
    );
    if (reversedBy) throw conflict(`قيد هذه الفاتورة معكوس أصلاً بالقيد ${reversedBy.number}.`);
    const entryLines = await tx.execute<{
      code: string;
      base: string;
      currency: string;
      amount: string;
      rate: DraftLine['rate'];
      shift_id: string | null;
      party_type: 'customer' | 'supplier' | 'user' | null;
      party_id: string | null;
      memo: string | null;
    }>(sql`
      select a.code, (l.debit_minor - l.credit_minor)::text as base, l.currency, l.amount_minor::text as amount,
             l.rate, l.shift_id, l.party_type, l.party_id, l.memo
      from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where l.entry_id = ${entry.id} order by l.line_no`);
    if (entryLines.some((l) => l.code === '5100')) {
      throw conflict(`لا يمكن تصحيح هذه الفاتورة: فيها قطع بيعت قبل أن تُشترى. ${RETURN_HINT}`);
    }

    // What was sold until now is costed first, so the stock's value is up to date
    await costPending(tx, auth.tenantId);
    const branchId = purchase.branchId;

    // ── Is all of it still there? ──
    const gone = new Set<string>();
    const needed = new Map<string, number>();
    for (const l of lines) needed.set(l.variantId, (needed.get(l.variantId) ?? 0) + l.qty);
    const levels = await tx
      .select({ variantId: stockLevels.variantId, qty: stockLevels.qty })
      .from(stockLevels)
      .where(and(eq(stockLevels.branchId, branchId), inArray(stockLevels.variantId, [...needed.keys()])));
    const held = new Map(levels.map((r) => [r.variantId, r.qty]));
    const nameOf = new Map(lines.map((l) => [l.variantId, l.name]));
    for (const [variantId, qty] of needed) {
      if ((held.get(variantId) ?? 0) < qty) gone.add(nameOf.get(variantId)!);
    }
    // The batches the invoice put in (and the no-batch row of an item that keeps batches)
    const keepsBatches = await trackedVariants(
      tx,
      branchId,
      lines.map((l) => l.variantId),
    );
    const batchRows = lines
      .filter((l) => l.batchNo || l.expiryDate || keepsBatches.has(l.variantId))
      .map((l) => ({
        variantId: l.variantId,
        batchNo: l.batchNo ?? null,
        expiry: l.expiryDate ?? null,
        qty: l.qty,
        lineNo: l.lineNo,
      }));
    for (const r of batchRows) {
      if ((await batchBalance(tx, branchId, r.variantId, r.batchNo, r.expiry)) < r.qty) {
        gone.add(nameOf.get(r.variantId)!);
      }
    }
    const numbers = await tx.select().from(serials).where(eq(serials.purchaseId, purchaseId));
    for (const n of numbers) if (n.status !== 'in_stock') gone.add(nameOf.get(n.variantId) ?? n.serial);
    if (gone.size > 0) {
      throw conflict(
        `لا يمكن تصحيح هذه الفاتورة: بِيع جزء من بضاعتها فلم يبقَ ما يكفي لإرجاعها (${[...gone].join('، ')}). ${RETURN_HINT}`,
      );
    }

    // ── The stock out, at the cost the invoice brought it in at ──
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    const values = await loadValues(
      tx,
      auth.tenantId,
      lines.map((l) => stockKey(branchId, l.variantId)),
    );
    let valueOut = 0;
    const taken = lines.map((l) => {
      const key = stockKey(branchId, l.variantId);
      const out = stockOutAtValue(values.get(key) ?? empty, l.qty, l.costMinor);
      values.set(key, out.after);
      valueOut += out.valueOutMinor;
      return {
        lineNo: l.lineNo,
        variantId: l.variantId,
        name: l.name,
        qty: l.qty,
        valueMinor: out.valueOutMinor,
      };
    });
    await saveValues(tx, auth.tenantId, values);

    const zone = await tx.execute<{ timezone: string }>(
      sql`select timezone from tenants where id = ${auth.tenantId}`,
    );
    const date = input.date ?? businessDateOf(now, zone[0]?.timezone ?? 'Asia/Damascus');
    const id = newId();
    const number = await nextNumber(tx, auth.tenantId, 'PRV', date);
    // Two people correcting the same invoice at once: the second finds it corrected (unique per purchase)
    await tx
      .insert(purchaseReversals)
      .values({
        tenantId: auth.tenantId,
        id,
        number,
        purchaseId,
        branchId,
        supplierId: purchase.supplierId,
        businessDate: date,
        reason: input.reason ?? null,
        lines: taken,
        totalMinor: purchase.totalMinor,
        valueOutMinor: valueOut,
        createdBy: auth.userId,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'purchase_reversals_purchase_unique')) {
          throw conflict('هذه الفاتورة صُحّحت من قبل.');
        }
        throw error;
      });
    await moveStock(
      tx,
      auth.tenantId,
      branchId,
      id,
      'purchase_reversal',
      date,
      lines.map((l) => ({ lineNo: l.lineNo, variantId: l.variantId, qty: -l.qty })),
    );
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId, kind: 'purchase_reversal', docId: id, date },
      batchRows.map((r) => ({ ...r, qty: -r.qty })),
    );
    await refreshBatches(
      tx,
      [branchId],
      lines.map((l) => l.variantId),
    );
    // The numbers leave the store's stock, free to be entered again on the corrected invoice
    if (numbers.length > 0) {
      await tx
        .update(serials)
        .set({ status: 'returned' })
        .where(
          inArray(
            serials.id,
            numbers.map((n) => n.id),
          ),
        );
    }
    const orderId = await receivedOrderOf(tx, purchaseId);
    await undoReceipt(tx, purchaseId, lines);

    // ── The books: the invoice's entry turned back; the stock leaves at what it left at ──
    const currency = entry.base;
    const back: DraftLine[] = entryLines.map((l) => ({
      account: { code: l.code },
      baseMinor: -num(l.base),
      currency: l.currency,
      amountMinor: -num(l.amount),
      rate: l.rate,
      memo: l.memo,
      shiftId: l.shift_id,
      party: l.party_type && l.party_id ? { type: l.party_type, id: l.party_id } : null,
    }));
    const stock = back.find((l) => l.account && 'code' in l.account && l.account.code === '1300');
    if (stock) {
      stock.baseMinor = -valueOut;
      stock.amountMinor = -valueOut;
    }
    const variance = valueOut - purchase.totalMinor;
    if (variance !== 0) {
      back.push({
        account: { code: '5100' },
        baseMinor: variance,
        currency,
        amountMinor: variance,
        rate: null,
        memo: 'فرق كلفة تصحيح فاتورة الشراء',
      });
    }
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: entry.branch_id,
      date,
      sourceType: 'reversal',
      sourceId: entry.id,
      sourceNumber: entry.number,
      memo: `تصحيح فاتورة الشراء ${purchase.number}${input.reason ? `: ${input.reason}` : ''}`,
      baseCurrency: currency,
      lines: back,
      kind: 'reversal',
      reversesId: entry.id,
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'purchase.correct',
        entity: 'purchase',
        entityId: purchaseId,
        changes: { reversal: [null, number], totalMinor: [purchase.totalMinor, 0] },
      },
      meta,
    );

    // ── The draft of the new invoice ──
    const owners = new Map(
      (
        await tx
          .select({ id: variants.id, productId: variants.productId })
          .from(variants)
          .where(
            inArray(
              variants.id,
              lines.map((l) => l.variantId),
            ),
          )
      ).map((v) => [v.id, v.productId]),
    );
    const draft: PurchaseDraft = {
      supplierId: purchase.supplierId,
      branchId,
      date: purchase.businessDate,
      payment: purchase.payment as PurchaseDraft['payment'],
      reference: purchase.reference,
      notes: purchase.notes,
      currency: (purchase.currency ?? currency) as PurchaseCurrencyCode,
      rate: purchase.rate,
      purchaseOrderId: orderId,
      lines: lines.map((l) => ({
        variantId: l.variantId,
        productId: owners.get(l.variantId) ?? '',
        name: l.name,
        qty: l.qty,
        costMinor: l.foreignCostMinor ?? l.costMinor,
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
        serials: numbers.filter((n) => n.variantId === l.variantId).map((n) => n.serial),
      })),
    };
    return { reversal: { id, number, date, valueOutMinor: valueOut }, draft };
  });
}

/** The purchase order this invoice received, if any (read before the receipt is undone: after it, it is gone) */
async function receivedOrderOf(tx: Transaction, purchaseId: string): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select id from purchase_orders
    where receipts @> jsonb_build_array(jsonb_build_object('purchaseId', ${purchaseId}::text)) limit 1`);
  return row?.id ?? null;
}
