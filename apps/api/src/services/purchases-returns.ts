import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  isoDateSchema,
  toLatinDigits,
  uuidSchema,
  roundDiv,
  stockOut,
  type CurrencyCode,
  type StockValue,
  type TradeRate,
  type SupplierReturnDetail,
  type supplierReturnInput,
  type SupplierReturnRow,
} from '@serva/core';
import {
  branches,
  purchaseLines,
  purchases,
  stockLevels,
  supplierReturns,
  suppliers,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import type { z } from 'zod';
import { inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { costPending, loadValues, saveValues, stockKey, uuidArray } from './costing';
import { ledgerBranchOf } from './damaged-stock';
import { postEntry, type DraftLine } from './posting';
import { recordBatchMovements, refreshBatches, takeBatches } from './batches';
import { usdToBase, type UsdTerms } from './purchase-usd';
import { outgoingSerials, returnSerialsToSupplier } from './serials';
import {
  newId,
  notFound,
  invalid,
  documentLock,
  baseCurrency,
  branchOf,
  nextNumber,
  stockedVariants,
  PAY_ACCOUNT,
} from './purchases-common';
import { moveStock } from './purchases-create';

// ─── Returns to the supplier (09 › purchase returns) ─────────────────────────

/**
 * Pieces sent back to their supplier: out of the branch at its average cost, and what the supplier
 * credits for them off its balance (Dr 2100) or paid back (Dr the drawer or the bank), Cr 1300 at
 * cost; what was credited above or below cost is cost of sales (5100). A branch cannot send back
 * more than it holds.
 *
 * Round 36, decision 13: a return that names its purchase invoice is credited at that invoice's cost
 * for each line (a dollar invoice, in dollars at the invoice's rate, so the dollar debt comes down by
 * what it went up and no exchange difference arises). The stock math is unchanged: the pieces leave at
 * the current average, and the difference between what leaves and what is credited is the same cost
 * variance as before, on 5100. A return with no invoice is exactly what it was.
 */
export async function createSupplierReturn(
  db: Database,
  auth: AccessClaims,
  input: z.output<typeof supplierReturnInput>,
  meta: RequestMeta,
): Promise<SupplierReturnDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    // Round 44: an id the form made posts once; the same id again answers the return already made
    if (input.id) {
      await documentLock(tx, 'supplier_return', input.id);
      const made = await supplierReturnById(tx, input.id);
      if (made) return made;
    }
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const branchId = await branchOf(tx, input.branchId);
    await requirePermission(tx, auth.userId, 'purchases.manage', branchId);
    const names = await stockedVariants(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const missing = input.lines.findIndex((l) => !names.has(l.variantId));
    if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
    await costPending(tx, auth.tenantId);

    const keys = input.lines.map((l) => stockKey(branchId, l.variantId));
    const values = await loadValues(tx, auth.tenantId, keys);
    const held = new Map(
      (
        await tx
          .select({ variantId: stockLevels.variantId, qty: stockLevels.qty })
          .from(stockLevels)
          .where(
            and(
              eq(stockLevels.branchId, branchId),
              inArray(
                stockLevels.variantId,
                input.lines.map((l) => l.variantId),
              ),
            ),
          )
      ).map((r) => [r.variantId, r.qty]),
    );
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    const currency = await baseCurrency(tx);
    const invoice = input.purchaseId
      ? await invoiceForReturn(tx, input.purchaseId, supplier.id, input.lines, currency)
      : null;
    // Round 62: with no invoice, a typed credit cannot pass what THIS supplier last charged for the item (nor the pieces' average cost)
    const typed = input.lines
      .filter((l) => !invoice && l.amountMinor !== null && l.amountMinor !== undefined)
      .map((l) => l.variantId);
    const dearest = new Map<string, number>();
    if (typed.length > 0) {
      const peak = await tx.execute<{ variant_id: string; unit: string }>(sql`
        select distinct on (pl.variant_id) pl.variant_id, (pl.cost_minor::numeric * 1000 / nullif(pl.qty, 0))::text as unit
        from purchase_lines pl join purchases p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
        where pl.variant_id = any(${uuidArray(typed)}) and p.supplier_id = ${supplier.id}
          and not exists (select 1 from purchase_reversals rv where rv.tenant_id = pl.tenant_id and rv.purchase_id = pl.purchase_id)
        order by pl.variant_id, p.business_date desc, p.created_at desc, pl.line_no desc`);
      for (const r of peak) dearest.set(r.variant_id, Number(r.unit));
    }
    const lines: SupplierReturnDetail['lines'] = [];
    for (const [index, l] of input.lines.entries()) {
      const onHand = held.get(l.variantId) ?? 0;
      if (l.qty > onHand) {
        throw invalid({ [`lines.${index}.qty`]: `في الفرع ${onHand / 1000} فقط من هذا الصنف` });
      }
      const key = stockKey(branchId, l.variantId);
      const out = stockOut(values.get(key) ?? empty, l.qty);
      values.set(key, out.after);
      const costMinor = Math.max(0, out.costMinor);
      const credit = invoice?.credits[index];
      if (!credit && l.amountMinor !== null && l.amountMinor !== undefined) {
        const unit = dearest.get(l.variantId);
        const cap = Math.max(costMinor, unit === undefined ? 0 : Math.ceil((unit * l.qty) / 1000));
        if (l.amountMinor > cap) {
          throw invalid({
            [`lines.${index}.amountMinor`]:
              'المبلغ أكبر مما حاسبك به هذا المورد على هذه القطع. اختر الفاتورة لتُرجَع بسعرها',
          });
        }
      }
      lines.push({
        variantId: l.variantId,
        name: names.get(l.variantId)!,
        qty: l.qty,
        amountMinor: credit ? credit.baseMinor : (l.amountMinor ?? costMinor),
        costMinor,
        ...(credit ? { invoiceCostMinor: credit.baseMinor } : {}),
        ...(credit?.foreignMinor !== undefined ? { foreignAmountMinor: credit.foreignMinor } : {}),
        ...(l.batchNo ? { batchNo: l.batchNo } : {}),
        ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
        ...(l.serials && l.serials.length > 0 ? { serials: l.serials } : {}),
      });
    }
    // A tracked product goes back with its serial numbers: they leave the store's stock
    const outgoing = await outgoingSerials(tx, branchId, input.lines);
    await saveValues(tx, auth.tenantId, values);

    const id = input.id ?? newId();
    const number = await nextNumber(tx, auth.tenantId, 'PRT', input.date);
    const amountMinor = lines.reduce((sum, l) => sum + l.amountMinor, 0);
    const costMinor = lines.reduce((sum, l) => sum + l.costMinor, 0);
    await tx.insert(supplierReturns).values({
      tenantId: auth.tenantId,
      id,
      number,
      branchId,
      supplierId: supplier.id,
      businessDate: input.date,
      refund: input.refund,
      reference: input.reference ?? null,
      note: input.note ?? null,
      lines,
      amountMinor,
      costMinor,
      ...(invoice ? { purchaseId: invoice.id } : {}),
      ...(invoice?.usd
        ? { currency: 'USD', rate: invoice.usd.rate.rate, foreignAmountMinor: invoice.foreignTotal }
        : {}),
      createdBy: auth.userId,
    });
    await returnSerialsToSupplier(tx, outgoing);
    await moveStock(
      tx,
      auth.tenantId,
      branchId,
      id,
      'supplier_return',
      input.date,
      input.lines.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, qty: -l.qty })),
    );
    // The batch named goes down by what goes back to the supplier (else earliest expiry first)
    const sentBack = await takeBatches(
      tx,
      branchId,
      input.lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
      (i) => `lines.${i}.batchNo`,
    );
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId, kind: 'supplier_return', docId: id, date: input.date },
      sentBack.map((r) => ({ ...r, qty: -r.qty })),
    );
    await refreshBatches(
      tx,
      [branchId],
      input.lines.map((l) => l.variantId),
    );

    const line = (account: DraftLine['account'], baseMinor: number, extra: Partial<DraftLine> = {}) =>
      ({ account, baseMinor, currency, amountMinor: baseMinor, rate: null, ...extra }) as DraftLine;
    // On a dollar invoice what the supplier credits is dollars, at the invoice's rate
    const dollars: Partial<DraftLine> = invoice?.usd
      ? { currency: 'USD', amountMinor: invoice.foreignTotal, rate: invoice.usd.rate }
      : {};
    const back =
      input.refund === 'credit'
        ? line({ code: '2100' }, amountMinor, {
            party: { type: 'supplier', id: supplier.id },
            memo: supplier.name,
            ...dollars,
          })
        : line(PAY_ACCOUNT(input.refund, dollars.currency ?? currency), amountMinor, dollars);
    const difference = costMinor - amountMinor;
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: await ledgerBranchOf(tx, branchId),
      date: input.date,
      sourceType: 'supplier_return',
      sourceId: id,
      sourceNumber: number,
      memo: `مرتجع إلى ${supplier.name} ${number}${input.reference ? ` (${input.reference})` : ''}`,
      baseCurrency: currency,
      lines: [
        ...(amountMinor !== 0 ? [back] : []),
        line({ code: '1300' }, -costMinor),
        ...(difference !== 0 ? [line({ code: '5100' }, difference, { memo: 'فرق كلفة مرتجع المورد' })] : []),
      ],
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'supplier_return.create',
        entity: 'supplier_return',
        entityId: id,
        changes: { number: [null, number], amountMinor: [null, amountMinor] },
      },
      meta,
    );
    return {
      id,
      number,
      date: input.date,
      supplierId: supplier.id,
      supplierName: supplier.name,
      branchId,
      branchName:
        (await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, branchId)))[0]?.name ??
        null,
      refund: input.refund,
      reference: input.reference ?? null,
      lines,
      amountMinor,
      costMinor,
      ...(invoice
        ? {
            purchaseId: invoice.id,
            purchaseNumber: invoice.number,
            ...(invoice.usd
              ? {
                  currency: 'USD' as const,
                  rate: invoice.usd.rate.rate,
                  foreignAmountMinor: invoice.foreignTotal,
                }
              : {}),
          }
        : {}),
      baseCurrency: currency,
    };
  });
}

/** A supplier return made earlier, as the answer of the POST that made it (a retry with the same id) */
async function supplierReturnById(tx: Transaction, id: string): Promise<SupplierReturnDetail | null> {
  const [r] = await tx.select().from(supplierReturns).where(eq(supplierReturns.id, id));
  if (!r) return null;
  const [supplier] = await tx
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, r.supplierId));
  const [invoice] = r.purchaseId
    ? await tx.select({ number: purchases.number }).from(purchases).where(eq(purchases.id, r.purchaseId))
    : [];
  const [branch] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, r.branchId));
  return {
    id: r.id,
    number: r.number,
    date: r.businessDate,
    supplierId: r.supplierId,
    supplierName: supplier?.name ?? '',
    branchId: r.branchId,
    branchName: branch?.name ?? null,
    refund: r.refund as SupplierReturnDetail['refund'],
    reference: r.reference,
    lines: r.lines as SupplierReturnDetail['lines'],
    amountMinor: r.amountMinor,
    costMinor: r.costMinor,
    ...(r.purchaseId
      ? {
          purchaseId: r.purchaseId,
          purchaseNumber: invoice?.number ?? null,
          ...(r.currency
            ? { currency: 'USD' as const, rate: r.rate, foreignAmountMinor: r.foreignAmountMinor }
            : {}),
        }
      : {}),
    baseCurrency: await baseCurrency(tx),
  };
}

/**
 * The invoice a supplier return is against (round 36, decision 13): it must be this supplier's, every line
 * must be an item of it, and no line may send back more than was bought less what earlier returns against
 * it took. Each line's credit is its share of the invoice's cost for that item (the whole of it when the
 * whole quantity goes back), or the amount typed, which is then in the invoice's currency.
 */
async function invoiceForReturn(
  tx: Transaction,
  purchaseId: string,
  supplierId: string,
  returned: z.output<typeof supplierReturnInput>['lines'],
  base: CurrencyCode,
) {
  const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId));
  if (!purchase || purchase.supplierId !== supplierId) {
    throw invalid({ purchaseId: 'هذه الفاتورة ليست من هذا المورد' });
  }
  // Round 44: a corrected invoice was already turned back whole (the debt too): nothing more is returned against it
  const [reversed] = await tx.execute<{ number: string }>(
    sql`select number from purchase_reversals where purchase_id = ${purchaseId}`,
  );
  if (reversed) {
    throw invalid({ purchaseId: `هذه الفاتورة صُحّحت بالمستند ${reversed.number}. لا يُرجَع منها شيء` });
  }
  const bought = await tx.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, purchaseId));
  // The invoice's own rate: the credit is at the rate the debt was booked at
  const usd: UsdTerms | null = purchase.currency
    ? { currency: 'USD', rate: { unit: 'USD', quote: base, rate: purchase.rate! } as TradeRate }
    : null;
  // What earlier returns against this invoice took, per item
  const earlier = await tx
    .select({ lines: supplierReturns.lines })
    .from(supplierReturns)
    .where(eq(supplierReturns.purchaseId, purchaseId));
  const taken = new Map<string, number>();
  // …and, for the lines that named a batch, per batch (an earlier return with no batch counts against the item only)
  const takenBatches: {
    variantId: string;
    batchNo: string | null;
    expiryDate: string | null;
    qty: number;
  }[] = [];
  for (const r of earlier) {
    for (const l of r.lines as {
      variantId: string;
      qty: number;
      batchNo?: string | null;
      expiryDate?: string | null;
    }[]) {
      taken.set(l.variantId, (taken.get(l.variantId) ?? 0) + l.qty);
      if (l.batchNo || l.expiryDate) {
        takenBatches.push({
          variantId: l.variantId,
          batchNo: l.batchNo ?? null,
          expiryDate: l.expiryDate ?? null,
          qty: l.qty,
        });
      }
    }
  }
  const sent = new Map<string, number>();
  const sentByBatch = new Map<string, number>();
  const credits: { baseMinor: number; foreignMinor?: number }[] = [];
  let foreignTotal = 0;
  for (const [index, l] of returned.entries()) {
    const own = bought.filter(
      (b) =>
        b.variantId === l.variantId &&
        (!l.batchNo || b.batchNo === l.batchNo) &&
        (!l.expiryDate || b.expiryDate === l.expiryDate),
    );
    if (own.length === 0) {
      throw invalid({ [`lines.${index}.variantId`]: 'هذا الصنف ليس في الفاتورة المذكورة' });
    }
    const qtyBought = own.reduce((sum, b) => sum + b.qty, 0);
    // Earlier returns do not say which batch they took, so the invoice's quantity is checked per item (all its
    // batches on the invoice); a line that names a batch is also held to what that batch came with, in this request
    const itemBought = bought.filter((b) => b.variantId === l.variantId).reduce((sum, b) => sum + b.qty, 0);
    const already = (taken.get(l.variantId) ?? 0) + (sent.get(l.variantId) ?? 0);
    const batchKey = `${l.variantId}|${l.batchNo ?? ''}|${l.expiryDate ?? ''}`;
    const earlierOfBatch = takenBatches
      .filter(
        (t) =>
          t.variantId === l.variantId &&
          (!l.batchNo || t.batchNo === l.batchNo) &&
          (!l.expiryDate || t.expiryDate === l.expiryDate),
      )
      .reduce((sum, t) => sum + t.qty, 0);
    const sameBatch = (sentByBatch.get(batchKey) ?? 0) + earlierOfBatch;
    if (already + l.qty > itemBought || sameBatch + l.qty > qtyBought) {
      throw invalid({
        [`lines.${index}.qty`]: `اشتريت من هذا الصنف ${itemBought / 1000} بهذه الفاتورة، وأُرجع منها ${already / 1000}. المتبقي ${Math.max(0, itemBought - already) / 1000}`,
      });
    }
    sentByBatch.set(batchKey, (sentByBatch.get(batchKey) ?? 0) + l.qty);
    sent.set(l.variantId, (sent.get(l.variantId) ?? 0) + l.qty);
    const share = (cost: number) =>
      l.qty === qtyBought ? cost : Number(roundDiv(BigInt(cost) * BigInt(l.qty), BigInt(qtyBought)));
    if (usd) {
      const foreign = l.amountMinor ?? share(own.reduce((sum, b) => sum + (b.foreignCostMinor ?? 0), 0));
      foreignTotal += foreign;
      credits.push({ baseMinor: usdToBase(foreign, usd, base), foreignMinor: foreign });
    } else {
      credits.push({ baseMinor: l.amountMinor ?? share(own.reduce((sum, b) => sum + b.costMinor, 0)) });
    }
  }
  return { id: purchase.id, number: purchase.number, usd, credits, foreignTotal };
}

/** Round 60: one return in full (its lines, the invoice it was credited against): the detail and the print */
export function readSupplierReturn(
  db: Database,
  auth: AccessClaims,
  id: string,
): Promise<SupplierReturnDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const found = await supplierReturnById(tx, id);
    if (!found || !inScope(scope, found.branchId)) throw notFound('هذا المرتجع');
    return found;
  });
}

/** Round 62: the keyset cursor of the returns list and of the orders list: the day, the creation time (microseconds) and the id of the last row */
export function readKeyset(cursor: string | undefined): { date: string; micros: number; id: string } | null {
  if (!cursor) return null;
  const [date, micros, id, ...rest] = cursor.split('~');
  const parsed = {
    date: isoDateSchema.safeParse(date),
    id: uuidSchema.safeParse(id),
    micros: Number(micros),
  };
  if (
    rest.length > 0 ||
    !parsed.date.success ||
    !parsed.id.success ||
    !Number.isSafeInteger(parsed.micros) ||
    parsed.micros < 0
  ) {
    throw invalid({ cursor: 'صفحة غير صالحة' });
  }
  return { date: parsed.date.data, micros: parsed.micros, id: parsed.id.data };
}

export function listSupplierReturns(
  db: Database,
  auth: AccessClaims,
  query: {
    limit?: number | undefined;
    cursor?: string | undefined;
    supplierId?: string | undefined;
    q?: string | undefined;
  } = {},
): Promise<{ items: SupplierReturnRow[]; nextCursor: string | null }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    // Round 62: pages by a keyset cursor (day, creation time, id), so a return made while paging never shifts a page
    const pageSize = query.limit ?? 200;
    const after = readKeyset(query.cursor);
    const micros = sql`(extract(epoch from r.created_at) * 1000000)::bigint`;
    const conditions = [sql`true`];
    if (!scope.all) conditions.push(sql`r.branch_id = any(${uuidArray([...scope.branchIds])})`);
    if (query.supplierId) conditions.push(sql`r.supplier_id = ${query.supplierId}`);
    if (query.q) {
      // position() finds the text as typed: «%» and «_» need no escaping
      const needle = toLatinDigits(query.q).toLowerCase();
      conditions.push(
        sql`(position(${needle} in lower(r.number)) > 0 or position(${needle} in lower(s.name)) > 0 or position(${needle} in lower(coalesce(r.reference, ''))) > 0)`,
      );
    }
    if (after) {
      conditions.push(
        sql`(r.business_date, ${micros}, r.id) < (${after.date}::date, ${after.micros}::bigint, ${after.id}::uuid)`,
      );
    }
    const rows = await tx.execute<{
      id: string;
      number: string;
      date: string;
      supplier_name: string;
      refund: SupplierReturnRow['refund'];
      pieces: string;
      amount: string;
      micros: string;
    }>(sql`
      select r.id, r.number, r.business_date::text as date, s.name as supplier_name, r.refund,
             coalesce((select sum((l ->> 'qty')::bigint) from jsonb_array_elements(r.lines) l), 0)::text as pieces,
             r.amount_minor::text as amount, ${micros}::text as micros
      from supplier_returns r
      join suppliers s on s.tenant_id = r.tenant_id and s.id = r.supplier_id
      where ${sql.join(conditions, sql` and `)}
      order by r.business_date desc, ${micros} desc, r.id desc
      limit ${pageSize + 1}`);
    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    return {
      nextCursor: rows.length > pageSize && last ? `${last.date}~${last.micros}~${last.id}` : null,
      items: page.map((r) => ({
        id: r.id,
        number: r.number,
        date: r.date,
        supplierName: r.supplier_name,
        refund: r.refund,
        pieces: Number(r.pieces),
        amountMinor: Number(r.amount),
      })),
    };
  });
}
