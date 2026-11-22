import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  businessDateOf,
  isoDateSchema,
  toLatinDigits,
  uuidSchema,
  roundDiv,
  stockIn,
  stockBack,
  stockOut,
  wasteReasonsOf,
  type CurrencyCode,
  type InventoryResponse,
  type ProfitReport,
  type PurchaseCurrencyCode,
  type PurchaseDetail,
  type PurchaseInput,
  type PurchaseListResponse,
  type PurchaseRow,
  type StocktakeDetail,
  type StocktakeListResponse,
  LEGACY_WASTE_NOTE,
  type StocktakeInput,
  type TransferDetail,
  type TransferInput,
  type TransferListResponse,
  type TransferRow,
  type StocktakeLineRow,
  type StockValue,
  type TradeRate,
  type SupplierInput,
  type SupplierListResponse,
  type SupplierOpeningBalanceInput,
  type SupplierOpeningBalanceResult,
  type SupplierPaymentInput,
  type SupplierPaymentRow,
  type SupplierReturnDetail,
  type supplierReturnInput,
  type SupplierReturnRow,
  type SupplierRow,
} from '@serva/core';
import {
  branches,
  documentSequences,
  purchaseAttachments,
  purchaseLines,
  purchases,
  serials,
  stockLevels,
  stockMovements,
  stocktakes,
  transfers,
  supplierPayments,
  supplierReturns,
  suppliers,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import type { z } from 'zod';
import { forbidden, inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import {
  costLines,
  costPending,
  loadValues,
  saveValues,
  stockKey,
  uuidArray,
  type StockKey,
} from './costing';
import { ledgerBranchOf } from './damaged-stock';
import { assertDateOpen } from './period-close';
import { postEntry, type DraftLine } from './posting';
import {
  recordBatchMovements,
  refreshBatches,
  batchPool,
  requiringExpiry,
  takeBatches,
  trackedVariants,
} from './batches';
import { applyReceipt } from './purchase-order-receipt';

import { bookValueOfPayment, usdTerms, usdToBase, type UsdTerms } from './purchase-usd';
import {
  countSerials,
  outgoingSerials,
  receiveSerials,
  relocateSerials,
  returnSerialsToSupplier,
} from './serials';

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

const newId = createUuidV7();
const notFound = (what: string) => new AppError(404, 'not_found', `${what} غير موجود.`);
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
async function stockedVariants(tx: Transaction, ids: string[]): Promise<Map<string, string>> {
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select v.id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name
    from variants v join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    where v.id = any(${uuidArray(ids)}) and p.type = 'stock'`);
  return new Map(rows.map((r) => [r.id, r.name]));
}

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

// ─── Suppliers ───────────────────────────────────────────────────────────────

async function supplierRows(tx: Transaction, id?: string): Promise<SupplierRow[]> {
  const rows = await tx.execute<{
    id: string;
    name: string;
    phone: string | null;
    notes: string | null;
    terms_days: number | null;
    archived_at: string | null;
    balance: string;
    usd_balance: string;
    usd_book: string;
    last_purchase: string | null;
    purchases_total: string;
  }>(sql`
    select s.id, s.name, s.phone, s.notes, s.terms_days, s.archived_at, coalesce(b.balance, 0)::text as balance,
           coalesce(b.usd_balance, 0)::text as usd_balance, coalesce(b.usd_book, 0)::text as usd_book,
           pu.last_purchase::text as last_purchase, coalesce(pu.total, 0)::text as purchases_total
    from suppliers s left join (${supplierBalances}) b on b.supplier_id = s.id
    left join (
      select p.supplier_id, max(p.business_date) as last_purchase, sum(p.total_minor) as total
      from purchases p
      where not exists (select 1 from purchase_reversals r where r.tenant_id = p.tenant_id and r.purchase_id = p.id)
      group by p.supplier_id
    ) pu on pu.supplier_id = s.id
    ${id ? sql`where s.id = ${id}` : sql``}
    order by s.name, s.id`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    termsDays: r.terms_days,
    balanceMinor: Number(r.balance),
    usdBalanceMinor: Number(r.usd_balance),
    usdBookMinor: Number(r.usd_book),
    archived: r.archived_at !== null,
    lastPurchaseOn: r.last_purchase,
    purchasesTotalMinor: Number(r.purchases_total),
  }));
}

export async function listSuppliers(db: Database, auth: AccessClaims): Promise<SupplierListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const items = await supplierRows(tx);
    return {
      items,
      totalOwedMinor: items.reduce((sum, s) => sum + Math.max(0, s.balanceMinor), 0),
      baseCurrency: await baseCurrency(tx),
    };
  });
}

export async function saveSupplier(
  db: Database,
  auth: AccessClaims,
  id: string | null,
  input: SupplierInput,
  meta: RequestMeta,
  now: Date,
): Promise<SupplierRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    return saveSupplierTx(tx, auth, id, input, meta, now);
  });
}

/** The write of saveSupplier inside the caller's transaction (the import); permission checked by the caller. */
export async function saveSupplierTx(
  tx: Transaction,
  auth: AccessClaims,
  id: string | null,
  input: SupplierInput,
  meta: RequestMeta,
  now: Date,
): Promise<SupplierRow> {
  const fields = {
    name: input.name,
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.termsDays !== undefined ? { termsDays: input.termsDays } : {}),
    ...(input.archived !== undefined ? { archivedAt: input.archived ? now : null } : {}),
  };
  const supplierId = id ?? newId();
  if (id) {
    const [found] = await tx
      .update(suppliers)
      .set({ ...fields, updatedAt: now })
      .where(eq(suppliers.id, id))
      .returning();
    if (!found) throw notFound('هذا المورد');
  } else {
    await tx.insert(suppliers).values({ tenantId: auth.tenantId, id: supplierId, ...fields });
  }
  await audit(
    tx,
    {
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: id ? 'supplier.update' : 'supplier.create',
      entity: 'supplier',
      entityId: supplierId,
      changes: { name: [null, input.name] },
    },
    meta,
  );
  return (await supplierRows(tx, supplierId))[0]!;
}

// ─── Purchases ───────────────────────────────────────────────────────────────

const PAY_ACCOUNT = (payment: 'cash' | 'bank', currency: string): DraftLine['account'] =>
  payment === 'cash' ? { cash: '1120', currency } : { code: '1130' };

async function purchaseDetail(tx: Transaction, id: string): Promise<PurchaseDetail> {
  const [row] = await tx.execute<{
    id: string;
    number: string;
    business_date: string;
    supplier_id: string;
    supplier_name: string;
    payment: PurchaseDetail['payment'];
    reference: string | null;
    total_minor: string;
    branch_id: string;
    notes: string | null;
    currency: string | null;
    rate: string | null;
    foreign_total_minor: string | null;
    reversal_id: string | null;
    reversal_number: string | null;
    reversal_date: string | null;
    order_id: string | null;
    due_date: string | null;
    discount_minor: string | null;
    charges_minor: string | null;
    tenant_id: string;
  }>(sql`
    select p.id, p.number, p.business_date::text, p.supplier_id, s.name as supplier_name, p.payment,
           p.reference, p.total_minor::text, p.branch_id, p.notes, p.currency, p.rate,
           p.due_date::text, p.discount_minor::text, p.charges_minor::text, p.tenant_id,
           p.foreign_total_minor::text, r.id as reversal_id, r.number as reversal_number,
           r.business_date::text as reversal_date,
           (select o.id from purchase_orders o where o.tenant_id = p.tenant_id
              and o.receipts @> jsonb_build_array(jsonb_build_object('purchaseId', p.id)) limit 1) as order_id
    from purchases p join suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
    left join purchase_reversals r on r.tenant_id = p.tenant_id and r.purchase_id = p.id
    where p.id = ${id}`);
  if (!row) throw notFound('هذه الفاتورة');
  const lines = await tx
    .select()
    .from(purchaseLines)
    .where(eq(purchaseLines.purchaseId, id))
    .orderBy(asc(purchaseLines.lineNo));
  const owners = new Map(
    (lines.length
      ? await tx
          .select({ id: variants.id, productId: variants.productId })
          .from(variants)
          .where(
            inArray(
              variants.id,
              lines.map((l) => l.variantId),
            ),
          )
      : []
    ).map((v) => [v.id, v.productId]),
  );
  const numbers = await tx
    .select({ variantId: serials.variantId, serial: serials.serial })
    .from(serials)
    .where(eq(serials.purchaseId, id))
    .orderBy(asc(serials.serial));
  return {
    id: row.id,
    number: row.number,
    date: row.business_date,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    payment: row.payment,
    reference: row.reference,
    totalMinor: Number(row.total_minor),
    branchId: row.branch_id,
    notes: row.notes,
    ...(row.currency
      ? {
          currency: row.currency as PurchaseCurrencyCode,
          rate: row.rate,
          foreignTotalMinor: Number(row.foreign_total_minor),
        }
      : {}),
    dueDate: row.due_date,
    ...(row.discount_minor !== null ? { discountMinor: Number(row.discount_minor) } : {}),
    ...(row.charges_minor !== null ? { chargesMinor: Number(row.charges_minor) } : {}),
    attachments: (
      await tx
        .select({ id: purchaseAttachments.id, uploadId: purchaseAttachments.uploadId })
        .from(purchaseAttachments)
        .where(eq(purchaseAttachments.purchaseId, id))
        .orderBy(asc(purchaseAttachments.createdAt), asc(purchaseAttachments.id))
    ).map((a) => ({
      id: a.id,
      url: `/v1/purchases/${id}/attachments/${a.id}`,
      thumbUrl: `/v1/purchases/${id}/attachments/${a.id}?size=thumb`,
    })),
    correctedBy: row.reversal_id
      ? { id: row.reversal_id, number: row.reversal_number!, date: row.reversal_date! }
      : null,
    purchaseOrderId: row.order_id,
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      variantId: l.variantId,
      productId: owners.get(l.variantId) ?? '',
      name: l.name,
      qty: l.qty,
      costMinor: l.costMinor,
      ...(l.foreignCostMinor !== null ? { foreignCostMinor: l.foreignCostMinor } : {}),
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      serials: numbers.filter((n) => n.variantId === l.variantId).map((n) => n.serial),
    })),
    baseCurrency: await baseCurrency(tx),
  };
}

/** Moves stock for a dashboard document (purchase or count), once per line. */
export async function moveStock(
  tx: Transaction,
  tenantId: string,
  branchId: string,
  docId: string,
  kind: 'purchase' | 'purchase_reversal' | 'stocktake' | 'transfer' | 'supplier_return',
  date: string,
  lines: { lineNo: number; variantId: string; qty: number }[],
): Promise<void> {
  for (const l of lines) {
    if (l.qty === 0) continue;
    await tx.insert(stockMovements).values({
      tenantId,
      branchId,
      variantId: l.variantId,
      qty: l.qty,
      kind,
      docId,
      lineNo: l.lineNo,
      businessDate: date,
    });
    await tx
      .insert(stockLevels)
      .values({ tenantId, branchId, variantId: l.variantId, qty: l.qty })
      .onConflictDoUpdate({
        target: [stockLevels.tenantId, stockLevels.branchId, stockLevels.variantId],
        set: { qty: sql`${stockLevels.qty} + excluded.qty` },
      });
  }
}

export async function createPurchase(
  db: Database,
  auth: AccessClaims,
  input: PurchaseInput,
  meta: RequestMeta,
): Promise<PurchaseDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    // Round 44: an id the form made posts once; the same id again answers the invoice already made
    if (input.id) {
      await documentLock(tx, 'purchase', input.id);
      const [made] = await tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.id, input.id));
      if (made) return purchaseDetail(tx, made.id);
    }
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const branchId = await branchOf(tx, input.branchId);
    // Round 44: the invoice goes into one branch, and the role must hold there
    await requirePermission(tx, auth.userId, 'purchases.manage', branchId);
    const names = await stockedVariants(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const missing = input.lines.findIndex((l) => !names.has(l.variantId));
    if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
    // An item that «يتطلب صلاحية» is not received without its expiry date
    const dated = await requiringExpiry(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const undated = input.lines.findIndex((l) => dated.has(l.variantId) && !l.expiryDate);
    if (undated >= 0) {
      throw invalid({ [`lines.${undated}.expiryDate`]: 'هذا الصنف يتطلب تاريخ صلاحية. اكتبه قبل الحفظ' });
    }

    // A dollar invoice (round 36, decision 11): the lines are typed in dollars and the stock takes them in the
    // base currency at the rate of the day, line by line, so the stock's value and the entry agree to the qirsh
    const currency = await baseCurrency(tx);
    const usd = await usdTerms(tx, currency, input);
    // Round 62: the paper's discount and extra charges are spread over the lines' costs (in the invoice's own currency), so
    // the stock, the entry and the debt take the net and the posting is the plain purchase's
    const spread = spreadAdjustment(
      input.lines.map((l) => l.costMinor),
      input.discountMinor ?? 0,
      input.chargesMinor ?? 0,
    );
    if ('error' in spread) throw invalid({ [spread.field]: spread.error });
    const netCosts = spread.costs;
    const baseCosts = netCosts.map((c) => (usd ? usdToBase(c, usd, currency) : c));
    const foreignTotal = usd ? netCosts.reduce((sum, c) => sum + c, 0) : null;
    // Round 62: the due date typed, else the supplier's payment days from the invoice's date (credit invoices only)
    if (input.dueDate && input.dueDate < input.date) {
      throw invalid({ dueDate: 'تاريخ الاستحقاق قبل تاريخ الفاتورة' });
    }
    const dueDate =
      input.payment !== 'credit'
        ? null
        : (input.dueDate ??
          (supplier.termsDays !== null
            ? new Date(Date.parse(`${input.date}T00:00:00Z`) + supplier.termsDays * 86_400_000)
                .toISOString()
                .slice(0, 10)
            : null));

    // What was sold until now is costed at the old average first
    await costPending(tx, auth.tenantId);
    const id = input.id ?? newId();
    const number = await nextNumber(tx, auth.tenantId, 'PUR', input.date);
    const total = baseCosts.reduce((sum, c) => sum + c, 0);
    await tx.insert(purchases).values({
      tenantId: auth.tenantId,
      id,
      number,
      branchId,
      supplierId: supplier.id,
      businessDate: input.date,
      payment: input.payment,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      totalMinor: total,
      ...(usd ? { currency: 'USD', rate: usd.rate.rate, foreignTotalMinor: foreignTotal } : {}),
      dueDate,
      discountMinor: input.discountMinor ? input.discountMinor : null,
      chargesMinor: input.chargesMinor ? input.chargesMinor : null,
      createdBy: auth.userId,
    });
    const lines = input.lines.map((l, i) => ({
      ...l,
      costMinor: baseCosts[i]!,
      lineNo: i + 1,
      name: names.get(l.variantId)!,
    }));
    await tx.insert(purchaseLines).values(
      lines.map((l, i) => ({
        tenantId: auth.tenantId,
        purchaseId: id,
        lineNo: l.lineNo,
        variantId: l.variantId,
        name: l.name,
        qty: l.qty,
        costMinor: l.costMinor,
        foreignCostMinor: usd ? netCosts[i]! : null,
        batchNo: l.batchNo ?? null,
        expiryDate: l.expiryDate ?? null,
      })),
    );
    await moveStock(tx, auth.tenantId, branchId, id, 'purchase', input.date, lines);
    await receiveSerials(tx, auth.tenantId, id, branchId, input.lines);
    // A batch's receipt: its own line in the batch ledger (the same item twice is two batches).
    // Pieces of an item that keeps batches, received with none, sit on the no-batch row.
    const keepsBatches = await trackedVariants(
      tx,
      branchId,
      lines.map((l) => l.variantId),
    );
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId, kind: 'receipt', docId: id, date: input.date },
      lines
        .filter((l) => l.batchNo || l.expiryDate || keepsBatches.has(l.variantId))
        .map((l) => ({
          variantId: l.variantId,
          batchNo: l.batchNo ?? null,
          expiry: l.expiryDate ?? null,
          qty: l.qty,
          lineNo: l.lineNo,
        })),
    );
    await refreshBatches(
      tx,
      [branchId],
      lines.map((l) => l.variantId),
    );

    // Into the stock's value; pieces sold before they were bought are settled now
    const values = await loadValues(
      tx,
      auth.tenantId,
      lines.map((l) => stockKey(branchId, l.variantId)),
    );
    let settled = 0;
    for (const l of lines) {
      const key = stockKey(branchId, l.variantId);
      const got = stockIn(
        values.get(key) ?? { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 },
        l.qty,
        l.costMinor,
      );
      values.set(key, got.after);
      settled += got.costMinor;
    }
    await saveValues(tx, auth.tenantId, values);

    // The credit side is in the invoice's currency: a dollar invoice owes (or pays) dollars, at its rate
    const owedCurrency = usd ? usd.currency : currency;
    const owedMinor = usd ? foreignTotal! : total;
    const credit: DraftLine =
      input.payment === 'credit'
        ? {
            account: { code: '2100' },
            baseMinor: -total,
            currency: owedCurrency,
            amountMinor: -owedMinor,
            rate: usd?.rate ?? null,
            party: { type: 'supplier', id: supplier.id },
            memo: supplier.name,
          }
        : {
            account: PAY_ACCOUNT(input.payment, owedCurrency),
            baseMinor: -total,
            currency: owedCurrency,
            amountMinor: -owedMinor,
            rate: usd?.rate ?? null,
          };
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId,
      date: input.date,
      sourceType: 'purchase',
      sourceId: id,
      sourceNumber: number,
      memo: `فاتورة شراء ${number} من ${supplier.name}${input.reference ? ` (${input.reference})` : ''}${usd ? ` بالدولار على سعر ${usd.rate.rate}` : ''}`,
      baseCurrency: currency,
      lines: [
        { account: { code: '1300' }, baseMinor: total, currency, amountMinor: total, rate: null },
        credit,
        ...(settled !== 0 ? costLines(settled, currency, '5100', 'تسوية كلفة قطع بيعت قبل شرائها') : []),
      ],
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'purchase.create',
        entity: 'purchase',
        entityId: id,
        changes: { number: [null, number], totalMinor: [null, total] },
      },
      meta,
    );
    // A purchase made from a purchase order counts toward what the order is waiting for
    if (input.purchaseOrderId) {
      await applyReceipt(
        tx,
        input.purchaseOrderId,
        supplier.id,
        { id, number, date: input.date },
        input.lines,
      );
    }
    return purchaseDetail(tx, id);
  });
}

export async function readPurchase(db: Database, auth: AccessClaims, id: string): Promise<PurchaseDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const detail = await purchaseDetail(tx, id);
    if (!inScope(scope, detail.branchId)) throw notFound('هذه الفاتورة');
    return detail;
  });
}

export async function listPurchases(
  db: Database,
  auth: AccessClaims,
  query: {
    from?: string | undefined;
    to?: string | undefined;
    supplierId?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
    q?: string | undefined;
    payment?: PurchaseRow['payment'] | undefined;
  },
): Promise<PurchaseListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const conditions = [sql`true`];
    if (!scope.all) conditions.push(sql`p.branch_id = any(${uuidArray([...scope.branchIds])})`);
    if (query.from) conditions.push(sql`p.business_date >= ${query.from}`);
    if (query.to) conditions.push(sql`p.business_date <= ${query.to}`);
    if (query.supplierId) conditions.push(sql`p.supplier_id = ${query.supplierId}`);
    if (query.payment) conditions.push(sql`p.payment = ${query.payment}`);
    if (query.q) {
      // Escaped for like: «%» and «_» typed by the owner mean themselves
      const like = `%${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        sql`(lower(p.number) like ${like} or lower(s.name) like ${like} or lower(coalesce(p.reference, '')) like ${like})`,
      );
    }
    // What the filters match in all, before the page: the corrected invoices are cancelled, so they are left out
    const [sum] = await tx.execute<{ count: string; total: string }>(sql`
      select count(*)::text as count, coalesce(sum(p.total_minor), 0)::text as total
      from purchases p join suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
      where ${sql.join(conditions, sql` and `)}
        and not exists (select 1 from purchase_reversals rv where rv.tenant_id = p.tenant_id and rv.purchase_id = p.id)`);
    // A page continues after the last row of the one before (newest first: date, then number)
    const after = /^(\d{4}-\d{2}-\d{2})~([A-Za-z0-9-]{1,40})$/.exec(query.cursor ?? '');
    if (query.cursor && !after) throw invalid({ cursor: 'صفحة غير صالحة' });
    if (after) conditions.push(sql`(p.business_date, p.number) < (${after[1]}::date, ${after[2]})`);
    const pageSize = query.limit ?? 500;
    const rows = await tx.execute<{
      id: string;
      number: string;
      business_date: string;
      supplier_id: string;
      supplier_name: string;
      payment: PurchaseRow['payment'];
      reference: string | null;
      total_minor: string;
      currency: string | null;
      rate: string | null;
      foreign_total_minor: string | null;
      due_date: string | null;
      reversal_id: string | null;
      reversal_number: string | null;
      reversal_date: string | null;
    }>(sql`
      select p.id, p.number, p.business_date::text, p.supplier_id, s.name as supplier_name, p.payment,
             p.reference, p.total_minor::text, p.currency, p.rate, p.foreign_total_minor::text, p.due_date::text,
             r.id as reversal_id, r.number as reversal_number, r.business_date::text as reversal_date
      from purchases p join suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
      left join purchase_reversals r on r.tenant_id = p.tenant_id and r.purchase_id = p.id
      where ${sql.join(conditions, sql` and `)}
      order by p.business_date desc, p.number desc
      limit ${pageSize + 1}`);
    const more = rows.length > pageSize;
    if (more) rows.length = pageSize;
    const lastRow = rows[rows.length - 1];
    return {
      nextCursor: query.limit && more && lastRow ? `${lastRow.business_date}~${lastRow.number}` : null,
      summary: { count: Number(sum?.count ?? 0), totalMinor: Number(sum?.total ?? 0) },
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        date: r.business_date,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        payment: r.payment,
        reference: r.reference,
        totalMinor: Number(r.total_minor),
        dueDate: r.due_date,
        ...(r.currency
          ? {
              currency: r.currency as PurchaseCurrencyCode,
              rate: r.rate,
              foreignTotalMinor: Number(r.foreign_total_minor),
            }
          : {}),
        correctedBy: r.reversal_id
          ? { id: r.reversal_id, number: r.reversal_number!, date: r.reversal_date! }
          : null,
      })),
      baseCurrency: await baseCurrency(tx),
    };
  });
}

// ─── Payments to suppliers ───────────────────────────────────────────────────

export async function paySupplier(
  db: Database,
  auth: AccessClaims,
  input: SupplierPaymentInput,
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<SupplierPaymentRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    // Round 44: an id the form made posts once; the same id again answers the payment already made
    if (input.id) {
      await documentLock(tx, 'supplier_payment', input.id);
      const [made] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, input.id));
      if (made) {
        return {
          id: made.id,
          number: made.number,
          supplierId: made.supplierId,
          date: made.businessDate,
          amountMinor: made.currency ? (made.foreignMinor ?? made.amountMinor) : made.amountMinor,
          method: made.method as 'cash' | 'bank',
          ...(made.currency
            ? {
                currency: 'USD' as const,
                rate: made.rate,
                baseMinor: made.amountMinor,
                fxMinor: made.fxMinor ?? 0,
              }
            : {}),
        };
      }
    }
    // Round 44: the supplier row is locked, so two payments at once cannot both pass the «more than owed» check
    // nor price the dollar book value from the same stale balance
    const [supplier] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, input.supplierId))
      .for('update');
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const currency = await baseCurrency(tx);
    // A payment in dollars (round 36, decision 11) pays the supplier's dollar debt, from the dollar safe or the bank
    const usd = await usdTerms(tx, currency, input);
    if (usd && input.cheque)
      throw invalid({ currency: 'الشيك يُكتب بالليرة. اختر الدفع من الخزنة أو من البنك' });
    const row = (await supplierRows(tx, supplier.id))[0]!;
    const owed = usd ? row.usdBalanceMinor! : row.balanceMinor - row.usdBookMinor!;
    if (input.amountMinor > Math.max(0, owed) && !input.advance) {
      const message = usd
        ? owed > 0
          ? 'المبلغ أكبر مما للمورد عليك بالدولار. إن كانت دفعة مقدّمة فأكّد ذلك'
          : 'لا شيء مستحق لهذا المورد بالدولار الآن. إن كانت دفعة مقدّمة فأكّد ذلك'
        : owed > 0
          ? 'المبلغ أكبر مما للمورد عليك. إن كانت دفعة مقدّمة فأكّد ذلك'
          : row.usdBalanceMinor! > 0
            ? 'لا شيء مستحق لهذا المورد بالليرة. ما عليك له دولار: ادفع بالدولار، أو أكّد أنها دفعة مقدّمة'
            : 'لا شيء مستحق لهذا المورد الآن. إن كانت دفعة مقدّمة فأكّد ذلك';
      throw new AppError(409, 'conflict', message, { amountMinor: message });
    }
    const id = input.id ?? newId();
    const number = await nextNumber(tx, auth.tenantId, 'PAY', input.date);
    const method = input.cheque ? 'bank' : input.method;
    // Round 47: a cheque dated after today has not left the bank yet: it waits in 2150 «شيكات مستحقة الدفع»
    // (the supplier is paid in the books, the bank is not touched) until the owner marks it cleared
    const chequePayable = !!input.cheque && input.cheque.dueDate > (await storeDay(tx, now));
    // Dollars paid cost what they cost at today's rate; the books held that debt at its own rates, and
    // the difference is the exchange difference of the payment
    const paidBase = usd ? usdToBase(input.amountMinor, usd, currency) : input.amountMinor;
    const bookBase = usd
      ? bookValueOfPayment(
          input.amountMinor,
          { usdMinor: row.usdBalanceMinor!, bookMinor: row.usdBookMinor! },
          (dollars) => usdToBase(dollars, usd, currency),
        )
      : input.amountMinor;
    const fx = paidBase - bookBase;
    await tx.insert(supplierPayments).values({
      tenantId: auth.tenantId,
      id,
      number,
      supplierId: supplier.id,
      businessDate: input.date,
      amountMinor: paidBase,
      method,
      cheque: input.cheque ?? null,
      chequePayable,
      ...(usd ? { currency: 'USD', foreignMinor: input.amountMinor, rate: usd.rate.rate, fxMinor: fx } : {}),
      note: input.note ?? null,
      createdBy: auth.userId,
    });
    const paidCurrency = usd ? usd.currency : currency;
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: await branchOf(tx, undefined),
      date: input.date,
      sourceType: 'supplier_payment',
      sourceId: id,
      sourceNumber: number,
      memo: `سند دفع ${number} إلى ${supplier.name}${usd ? ` بالدولار على سعر ${usd.rate.rate}` : ''}`,
      baseCurrency: currency,
      lines: [
        {
          account: { code: '2100' },
          baseMinor: bookBase,
          currency: paidCurrency,
          amountMinor: input.amountMinor,
          rate: null,
          party: { type: 'supplier', id: supplier.id },
          memo: supplier.name,
        },
        {
          account: chequePayable ? { code: '2150' } : PAY_ACCOUNT(method, paidCurrency),
          baseMinor: -paidBase,
          currency: paidCurrency,
          amountMinor: -input.amountMinor,
          rate: usd?.rate ?? null,
          ...(chequePayable ? { memo: `شيك ${input.cheque!.number} يستحق ${input.cheque!.dueDate}` } : {}),
        },
        // A loss when the dollars cost more than the books held them at (a debit), a gain when less
        ...(fx !== 0
          ? [
              {
                account: { code: '6510' },
                baseMinor: fx,
                currency,
                amountMinor: fx,
                rate: null,
                memo: fx > 0 ? 'خسارة فرق الصرف' : 'ربح فرق الصرف',
              } satisfies DraftLine,
            ]
          : []),
      ],
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'supplier.payment',
        entity: 'supplier',
        entityId: supplier.id,
        changes: { amountMinor: [null, input.amountMinor], ...(usd ? { fxMinor: [null, fx] } : {}) },
      },
      meta,
    );
    return {
      id,
      number,
      supplierId: supplier.id,
      date: input.date,
      amountMinor: input.amountMinor,
      method,
      ...(usd ? { currency: 'USD' as const, rate: usd.rate.rate, baseMinor: paidBase, fxMinor: fx } : {}),
    };
  });
}

/** The store's business day now (its timezone and day cut-off) */
export async function storeDay(tx: Transaction, now: Date): Promise<string> {
  const [row] = await tx.execute<{ timezone: string; cutoff: string }>(sql`
    select t.timezone, s.business_day_cutoff as cutoff
    from tenant_settings s join tenants t on t.id = s.tenant_id`);
  return row ? businessDateOf(now, row.timezone, row.cutoff) : now.toISOString().slice(0, 10);
}

// ─── A supplier's opening balance (round 47) ─────────────────────────────────

/**
 * What the store owed a supplier (or the supplier owed the store) before it started on the system, against 3900
 * «الأرصدة الافتتاحية», the account the product import uses for opening stock:
 *   debt:   Dr 3900 / Cr 2100 for the supplier;    credit: Dr 2100 for the supplier / Cr 3900.
 * A manual entry dated the store's day (or the day given), so the owner sees it in the journal and the statement,
 * refused in a closed period. In dollars the 2100 line is kept in dollars at the rate, like any dollar debt.
 * The same `id` answers the entry already made and posts nothing twice.
 */
export async function openSupplierBalance(
  db: Database,
  auth: AccessClaims,
  supplierId: string,
  input: SupplierOpeningBalanceInput,
  meta: RequestMeta,
  now: Date,
): Promise<SupplierOpeningBalanceResult> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'purchases.manage');
    const branchId = await branchOf(tx, undefined);
    if (!inScope(scope, branchId)) throw forbidden();
    const id = input.id ?? newId();
    await documentLock(tx, 'supplier_opening', id);
    // The supplier row is locked so the balance before and after is not read between two writers
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).for('update');
    if (!supplier) throw notFound('هذا المورد');
    const currency = await baseCurrency(tx);
    const usd = await usdTerms(tx, currency, input);
    const paidCurrency: CurrencyCode = usd ? usd.currency : currency;
    const before = (await supplierRows(tx, supplier.id))[0]!.balanceMinor;
    const sign = input.kind === 'debt' ? 1 : -1;
    const [made] = await tx.execute<{ number: string; entry_date: string; supplier_id: string | null }>(sql`
      select e.number, e.entry_date::text as entry_date,
             (select l.party_id::text from journal_lines l where l.tenant_id = e.tenant_id and l.entry_id = e.id
               and l.party_type = 'supplier' limit 1) as supplier_id
      from journal_entries e where e.source_type = 'manual' and e.source_id = ${id} and e.kind = 'manual'`);
    const result = (number: string, date: string, after: number): SupplierOpeningBalanceResult => ({
      id,
      number,
      supplierId: supplier.id,
      supplierName: supplier.name,
      kind: input.kind,
      date,
      amountMinor: input.amountMinor,
      currency: paidCurrency as PurchaseCurrencyCode,
      balanceBeforeMinor: before,
      balanceAfterMinor: after,
    });
    if (made) {
      if (made.supplier_id !== supplier.id) {
        throw new AppError(409, 'conflict', 'هذا المعرّف استُعمل لقيد آخر.');
      }
      return result(made.number, made.entry_date, before);
    }
    const date = input.date ?? (await storeDay(tx, now));
    await assertDateOpen(tx, auth.tenantId, date);
    const base = usd ? usdToBase(input.amountMinor, usd, currency) : input.amountMinor;
    const memo = `رصيد افتتاحي — ${supplier.name}`;
    // Debit-signed: a debt the store owes is a credit on 2100 (negative), an advance a debit
    const supplierBase = -sign * base;
    const supplierOwn = -sign * input.amountMinor;
    const entryId = await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: null,
      date,
      sourceType: 'manual',
      sourceId: id,
      sourceNumber: null,
      memo,
      baseCurrency: currency,
      lines: [
        {
          account: { code: '2100' },
          baseMinor: supplierBase,
          currency: paidCurrency,
          amountMinor: supplierOwn,
          rate: usd?.rate ?? null,
          party: { type: 'supplier', id: supplier.id },
          memo,
        },
        {
          account: { code: '3900' },
          baseMinor: -supplierBase,
          currency,
          amountMinor: -supplierBase,
          rate: null,
          memo,
        },
      ],
      kind: 'manual',
      createdBy: auth.userId,
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'supplier.opening_balance',
        entity: 'supplier',
        entityId: supplier.id,
        changes: { balanceMinor: [before, before + sign * base] },
        data: { kind: input.kind, amountMinor: input.amountMinor, currency: paidCurrency },
      },
      meta,
    );
    const [entry] = await tx.execute<{ number: string }>(
      sql`select number from journal_entries where id = ${entryId}`,
    );
    return result(entry?.number ?? '', date, before + sign * base);
  });
}

// ─── Inventory, counts and profit ────────────────────────────────────────────

export async function inventory(
  db: Database,
  auth: AccessClaims,
  query: { branchId?: string },
): Promise<InventoryResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'cost.view');
    // A role given for one branch reads that branch's stock only
    if (query.branchId && !inScope(scope, query.branchId)) throw forbidden();
    await costPending(tx, auth.tenantId);
    const rows = await tx.execute<{
      variant_id: string;
      branch_id: string;
      branch_name: string;
      branch_kind: string;
      name: string;
      qty: string;
      value_minor: string;
      ref_qty: string;
      ref_value_minor: string;
      dead_qty: string;
      last_cost: string | null;
      typical_cost: string | null;
      attributes: { name: string; value: string }[] | null;
      product_id: string;
      product_name: string;
      allows_fraction: boolean | null;
      min_stock: string | null;
      tracks_serial: boolean;
    }>(sql`
      select l.variant_id, l.branch_id, br.name as branch_name, br.kind as branch_kind, v.min_stock_qty::text as min_stock, p.tracks_serial,
             trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             v.attributes, p.id as product_id, p.name_ar as product_name, un.allows_fraction,
             l.qty::text, coalesce(sv.value_minor, 0)::text as value_minor,
             coalesce(sv.ref_qty, 0)::text as ref_qty, coalesce(sv.ref_value_minor, 0)::text as ref_value_minor,
             (select coalesce(sum(bm.q), 0) from (
                select m.batch_no, m.expiry_date, sum(m.qty) as q from batch_movements m
                where m.tenant_id = l.tenant_id and m.variant_id = l.variant_id and m.branch_id = l.branch_id
                group by m.batch_no, m.expiry_date having sum(m.qty) > 0) bm
              where bm.expiry_date < (now() at time zone coalesce((select timezone from tenants limit 1), 'UTC'))::date
                 or exists (select 1 from batch_blocks bl
                            where bl.tenant_id = l.tenant_id and bl.variant_id = l.variant_id
                              and bl.batch_no = bm.batch_no and bl.released_at is null))::text as dead_qty,
             (select (pl.cost_minor * 1000.0 / pl.qty)::text from purchase_lines pl
              join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
              where pl.tenant_id = l.tenant_id and pl.variant_id = l.variant_id and pl.qty > 0 and pl.cost_minor > 0
              and not exists (select 1 from purchase_reversals rv where rv.tenant_id = pu.tenant_id and rv.purchase_id = pu.id)
              order by pu.business_date desc, pu.created_at desc, pl.line_no desc limit 1) as last_cost,
             (select (percentile_cont(0.5) within group (order by t.c))::text from (
                select pl.cost_minor * 1000.0 / pl.qty as c from purchase_lines pl
                join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
                where pl.tenant_id = l.tenant_id and pl.variant_id = l.variant_id and pl.qty > 0 and pl.cost_minor > 0
              and not exists (select 1 from purchase_reversals rv where rv.tenant_id = pu.tenant_id and rv.purchase_id = pu.id)
                order by pu.business_date desc, pu.created_at desc, pl.line_no desc limit 5) t) as typical_cost
      from stock_levels l
      join variants v on v.tenant_id = l.tenant_id and v.id = l.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      join branches br on br.tenant_id = l.tenant_id and br.id = l.branch_id
      left join units un on un.tenant_id = p.tenant_id and un.id = p.unit_id
      left join stock_values sv on sv.tenant_id = l.tenant_id and sv.branch_id = l.branch_id and sv.variant_id = l.variant_id
      ${
        query.branchId
          ? sql`where l.branch_id = ${query.branchId}`
          : // The damaged goods have their own page (round 35, D7): this one is the stock a shop can sell
            sql`where l.branch_id not in (select id from branches where kind = 'damaged')`
      }
      ${scope.all ? sql`` : sql`and l.branch_id = any(${uuidArray([...scope.branchIds])})`}
      order by name, l.variant_id`);
    const items = rows.map((r) => {
      const qty = Number(r.qty);
      const value = Number(r.value_minor);
      return {
        variantId: r.variant_id,
        branchId: r.branch_id,
        branchName: r.branch_name,
        branchKind: r.branch_kind,
        name: r.name,
        attributes: r.attributes ?? [],
        productId: r.product_id,
        productName: r.product_name,
        allowsFraction: r.allows_fraction ?? false,
        minStockQty: r.min_stock === null ? null : Number(r.min_stock),
        tracksSerial: r.tracks_serial,
        qty,
        valueMinor: value,
        sellableQty: Math.max(0, qty - Number(r.dead_qty)),
        refQty: Number(r.ref_qty),
        refValueMinor: Number(r.ref_value_minor),
        unitCostMinor: qty > 0 ? Math.round((value * 1000 * 10_000) / qty) / 10_000 : null,
        lastCostMinor: r.last_cost === null ? null : Math.round(Number(r.last_cost) * 100) / 100,
        typicalCostMinor: r.typical_cost === null ? null : Math.round(Number(r.typical_cost) * 100) / 100,
      };
    });
    // Round 38: the reasons «سجّل هدراً» offers, the store's own list or the built-in one
    const [till] = await tx.execute<{ reasons: string[] | null }>(
      sql`select (till->'wasteReasons') as reasons from tenant_settings`,
    );
    // The database's clock: a write-off made from this list counts what moved after it (see createStocktakeIn)
    const [clock] = await tx.execute<{ at: Date | string }>(sql`select now() as at`);
    return {
      items,
      totalValueMinor: items.reduce((sum, i) => sum + i.valueMinor, 0),
      baseCurrency: await baseCurrency(tx),
      wasteReasons: wasteReasonsOf(till?.reasons),
      asOf: new Date(clock?.at ?? Date.now()).toISOString(),
    };
  });
}

/** A stocktake already made with this id, as its detail; null when there is none */
export async function stocktakeById(tx: Transaction, id: string): Promise<StocktakeDetail | null> {
  const [row] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    date: row.businessDate,
    branchId: row.branchId,
    lines: row.lines as StocktakeLineRow[],
    diffValueMinor: row.diffValueMinor,
    baseCurrency: await baseCurrency(tx),
  };
}

/** The counts already made, newest first, with who made them (round 44), inside the branches the role is held in */
export function listStocktakes(
  db: Database,
  auth: AccessClaims,
  query: { limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<StocktakeListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'inventory.adjust');
    const limit = query.limit ?? 20;
    const offset = /^o:\d{1,6}$/.test(query.cursor ?? '') ? Number(query.cursor!.slice(2)) : 0;
    const rows = await tx.execute<{
      id: string;
      number: string;
      date: string;
      branch_id: string;
      branch_name: string;
      by: string | null;
      items: string;
      diff: string;
      note: string | null;
      waste: boolean;
    }>(sql`
      select s.id, s.number, s.business_date::text as date, s.branch_id, b.name as branch_name, u.full_name as by,
             jsonb_array_length(s.lines)::text as items, s.diff_value_minor::text as diff, s.note,
             exists (select 1 from jsonb_array_elements(s.lines) l where nullif(l->>'reason', '') is not null) as waste
      from stocktakes s
      join branches b on b.tenant_id = s.tenant_id and b.id = s.branch_id
      left join users u on u.tenant_id = s.tenant_id and u.id = s.created_by
      ${scope.all ? sql`` : sql`where s.branch_id = any(${uuidArray([...scope.branchIds])})`}
      order by s.business_date desc, s.created_at desc
      limit ${limit + 1} offset ${offset}`);
    return {
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        number: r.number,
        date: r.date,
        branchId: r.branch_id,
        branchName: r.branch_name,
        by: r.by ?? '',
        kind:
          r.waste || r.note === LEGACY_WASTE_NOTE
            ? ('waste' as const)
            : r.note?.startsWith('نقص في التحويل')
              ? ('shortage' as const)
              : ('count' as const),
        items: Number(r.items),
        diffValueMinor: Number(r.diff),
        note: r.note,
      })),
      nextCursor: rows.length > limit ? `o:${offset + limit}` : null,
    };
  });
}

export function createStocktake(
  db: Database,
  auth: AccessClaims,
  input: StocktakeInput,
  meta: RequestMeta,
  opts: { lenientSerials?: boolean } = {},
): Promise<StocktakeDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // The count is of one branch: the permission must hold there, not only somewhere
    await requirePermission(tx, auth.userId, 'inventory.adjust', await branchOf(tx, input.branchId));
    // A count made against a phone's older sheet is never refused for want of serial numbers (it was counted offline)
    return createStocktakeIn(tx, auth, input, meta, {
      strictSerials: !input.countedAt && !opts.lenientSerials,
    });
  });
}

/** The count itself, inside the caller's transaction (a transfer's shortage is written off through it) */
export async function createStocktakeIn(
  tx: Transaction,
  auth: AccessClaims,
  input: StocktakeInput,
  meta: RequestMeta,
  opts: { strictSerials?: boolean } = {},
): Promise<StocktakeDetail> {
  await requirePermission(tx, auth.userId, 'inventory.adjust');
  // Round 38: a count with an id the device made (a phone's offline count, a till's waste) posts once: the
  // same id again answers the document it made
  if (input.id) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stocktake:${input.id}`}, 0))`);
    const made = await stocktakeById(tx, input.id);
    if (made) return made;
  }
  const branchId = await branchOf(tx, input.branchId);
  const names = await stockedVariants(
    tx,
    input.lines.map((l) => l.variantId),
  );
  const missing = input.lines.findIndex((l) => !names.has(l.variantId));
  if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
  await costPending(tx, auth.tenantId);

  // A line with a batch counts (or writes off) that batch alone: the item's stock moves by the
  // batch's difference. A line without one counts the whole item. An item is counted one way.
  const isBatchLine = (l: (typeof input.lines)[number]) => Boolean(l.batchNo || l.expiryDate);
  const wholeCounted = new Set(input.lines.filter((l) => !isBatchLine(l)).map((l) => l.variantId));
  // An item is counted once: two whole counts of it would each be compared with the same book figure and both applied
  const seenWhole = new Set<string>();
  for (const [i, l] of input.lines.entries()) {
    if (isBatchLine(l)) continue;
    if (seenWhole.has(l.variantId))
      throw invalid({ [`lines.${i}.variantId`]: 'هذا الصنف مكرر في الجرد: اجمع عدّاته في سطر واحد' });
    seenWhole.add(l.variantId);
  }
  const mixed = input.lines.findIndex((l) => isBatchLine(l) && wholeCounted.has(l.variantId));
  if (mixed >= 0) {
    throw invalid({ [`lines.${mixed}.batchNo`]: 'عُدّ الصنف كاملاً أو دفعةً دفعة، لا الاثنين معاً' });
  }
  const batchLines = input.lines.filter(isBatchLine);
  const pool = await batchPool(
    tx,
    branchId,
    batchLines.map((l) => l.variantId),
  );
  const deltas: { variantId: string; batchNo: string | null; expiry: string | null; delta: number }[] = [];
  for (const l of batchLines) {
    const held = (pool.get(l.variantId) ?? []).find(
      (b) => (b.batchNo ?? '') === (l.batchNo ?? '') && (b.expiry ?? null) === (l.expiryDate ?? null),
    );
    deltas.push({
      variantId: l.variantId,
      batchNo: l.batchNo ?? null,
      expiry: l.expiryDate ?? null,
      delta: l.countedQty - Math.max(0, held?.qty ?? 0),
    });
  }
  const wholeLines = input.lines.filter((l) => !isBatchLine(l));
  const sums = new Map<string, number>();
  for (const d of deltas) sums.set(d.variantId, (sums.get(d.variantId) ?? 0) + d.delta);

  const levels = await tx
    .select({ variantId: stockLevels.variantId, qty: stockLevels.qty })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.branchId, branchId),
        sql`${stockLevels.variantId} = any(${uuidArray(input.lines.map((l) => l.variantId))})`,
      ),
    );
  const expected = new Map(levels.map((l) => [l.variantId, l.qty]));
  const keys: StockKey[] = [...new Set(input.lines.map((l) => l.variantId))].map((v) =>
    stockKey(branchId, v),
  );
  const values = await loadValues(tx, auth.tenantId, keys);
  const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };

  // One count line per item: the counted total of a whole count, or the stock plus its batches' differences
  // A count made against an older sheet: what moved since (a sale) is already off the shelf the phone counted
  const movedSince = new Map<string, number>();
  if (input.countedAt && wholeLines.length > 0) {
    const moved = await tx.execute<{ variant_id: string; qty: string }>(sql`
      select variant_id, sum(qty)::text as qty from stock_movements
      where branch_id = ${branchId} and created_at > ${input.countedAt}::timestamptz
        and variant_id = any(${uuidArray(wholeLines.map((l) => l.variantId))})
      group by variant_id`);
    for (const m of moved) movedSince.set(m.variant_id, Number(m.qty));
  }
  const countLines: { variantId: string; countedQty: number }[] = [
    ...wholeLines.map((l) => ({
      variantId: l.variantId,
      countedQty: Math.max(0, l.countedQty + (movedSince.get(l.variantId) ?? 0)),
    })),
    ...[...sums].map(([variantId, delta]) => ({
      variantId,
      countedQty: Math.max(0, (expected.get(variantId) ?? 0) + delta),
    })),
  ];
  const rows: StocktakeLineRow[] = [];
  const moves: { lineNo: number; variantId: string; qty: number }[] = [];
  // A waste line says why (round 38): the reason rides on the item's count line for the waste report
  const reasonOf = new Map<string, string>();
  for (const l of input.lines)
    if (l.wasteReason && !reasonOf.has(l.variantId)) reasonOf.set(l.variantId, l.wasteReason);
  for (const [i, l] of countLines.entries()) {
    const was = expected.get(l.variantId) ?? 0;
    const diff = l.countedQty - was;
    const key = stockKey(branchId, l.variantId);
    let diffValue = 0;
    if (diff < 0) {
      const out = stockOut(values.get(key) ?? empty, -diff);
      values.set(key, out.after);
      diffValue = -out.costMinor;
    } else if (diff > 0) {
      const back = stockBack(values.get(key) ?? empty, diff);
      values.set(key, back.after);
      diffValue = back.valueMinor;
    }
    rows.push({
      variantId: l.variantId,
      name: names.get(l.variantId)!,
      expectedQty: was,
      countedQty: l.countedQty,
      diffQty: diff,
      diffValueMinor: diffValue,
      ...(reasonOf.has(l.variantId) ? { reason: reasonOf.get(l.variantId)! } : {}),
    });
    moves.push({ lineNo: i + 1, variantId: l.variantId, qty: diff });
  }
  await saveValues(tx, auth.tenantId, values);
  // A tracked product's count says which serial numbers left, so the serial list and the stock agree (round 60)
  const serialsOf = new Map<string, string[]>();
  for (const l of input.lines) if (l.serials?.length) serialsOf.set(l.variantId, l.serials);
  await countSerials(
    tx,
    auth.tenantId,
    branchId,
    rows.map((r) => ({ variantId: r.variantId, diffQty: r.diffQty, serials: serialsOf.get(r.variantId) })),
    !opts.strictSerials,
  );

  const id = input.id ?? newId();
  const number = await nextNumber(tx, auth.tenantId, 'STK', input.date);
  const diffValueMinor = rows.reduce((sum, r) => sum + r.diffValueMinor, 0);
  await tx.insert(stocktakes).values({
    tenantId: auth.tenantId,
    id,
    number,
    branchId,
    businessDate: input.date,
    note: input.note ?? null,
    lines: rows,
    diffValueMinor,
    createdBy: auth.userId,
  });
  await moveStock(tx, auth.tenantId, branchId, id, 'stocktake', input.date, moves);
  // The batch ledger: a batch's own count or write-off, and a whole-item loss taken earliest-expiry first
  const lineOf = new Map(moves.map((m) => [m.variantId, m.lineNo]));
  const keepsBatches = await trackedVariants(
    tx,
    branchId,
    moves.map((m) => m.variantId),
  );
  const ledger = [
    ...deltas.map((d, n) => ({
      variantId: d.variantId,
      batchNo: d.batchNo,
      expiry: d.expiry,
      qty: d.delta,
      lineNo: lineOf.get(d.variantId)!,
      allocNo: n,
    })),
    ...(
      await takeBatches(
        tx,
        branchId,
        moves
          .filter((m) => m.qty < 0 && wholeCounted.has(m.variantId))
          .map((m) => ({ lineNo: m.lineNo, variantId: m.variantId, qty: -m.qty })),
        () => 'lines',
      )
    ).map((r) => ({ ...r, qty: -r.qty })),
    // A whole count that finds more of an item that keeps batches: the extra pieces sit on the no-batch row
    ...moves
      .filter((m) => m.qty > 0 && wholeCounted.has(m.variantId) && keepsBatches.has(m.variantId))
      .map((m) => ({ variantId: m.variantId, batchNo: null, expiry: null, qty: m.qty, lineNo: m.lineNo })),
  ];
  await recordBatchMovements(
    tx,
    { tenantId: auth.tenantId, branchId, kind: 'count', docId: id, date: input.date },
    ledger,
  );
  await refreshBatches(
    tx,
    [branchId],
    moves.map((m) => m.variantId),
  );
  const currency = await baseCurrency(tx);
  // A loss (negative difference) is Dr 6300 / Cr 1300
  await postEntry(tx, {
    tenantId: auth.tenantId,
    branchId: await ledgerBranchOf(tx, branchId),
    date: input.date,
    sourceType: 'stocktake',
    sourceId: id,
    sourceNumber: number,
    memo: `جرد ${number}${input.note ? `: ${input.note}` : ''}`,
    baseCurrency: currency,
    lines: costLines(-diffValueMinor, currency, '6300'),
  });
  await audit(
    tx,
    {
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'stocktake.create',
      entity: 'stocktake',
      entityId: id,
      changes: { number: [null, number], diffValueMinor: [null, diffValueMinor] },
    },
    meta,
  );
  return { id, number, date: input.date, branchId, lines: rows, diffValueMinor, baseCurrency: currency };
}

/**
 * Whether a new transfer goes «بالطريق» (round 37, decision 16): when the request says so, or else by the
 * store's setting (auto: in transit when the store has more than one branch). Only a transfer between two
 * ordinary branches can be in transit: a van's loading and unloading, and the damaged location, stay instant
 * (the rep's settlement is its own confirmation).
 */
export async function sendsInTransit(
  tx: Transaction,
  mode: 'instant' | 'transit' | undefined,
  fromBranchId: string,
  toBranchId: string,
): Promise<boolean> {
  const kinds = await tx.execute<{ id: string; kind: string }>(
    sql`select id, kind from branches where id in (${fromBranchId}, ${toBranchId})`,
  );
  if (kinds.length < 2 || kinds.some((b) => b.kind !== 'store')) return false;
  if (mode) return mode === 'transit';
  return (await effectiveTransferMode(tx)) === 'transit';
}

/** The setting resolved: auto is in transit for a store with more than one ordinary branch */
export async function effectiveTransferMode(tx: Transaction): Promise<'instant' | 'transit'> {
  const [row] = await tx.execute<{ mode: string; stores: string }>(sql`
    select coalesce((select transfer_mode from tenant_settings limit 1), 'auto') as mode,
           (select count(*) from branches where kind = 'store' and is_active)::text as stores`);
  if (row?.mode === 'instant') return 'instant';
  if (row?.mode === 'transit') return 'transit';
  return Number(row?.stores ?? 0) > 1 ? 'transit' : 'instant';
}

/**
 * A transfer between branches (09 › transfers): every line out of the sender at its average cost
 * and into the receiver at that value, in one transaction. A line more than the sender has is
 * sent all the same (stock may go below nothing, as at the till) and costed as a sale would be.
 *
 * Round 37 (decision 16), sent «بالطريق»: only the sending half happens now (the stock and batches out, and
 * Dr 1900 / Cr 1300 at the sender); the serial numbers wait in transit. The receiving half (stock and batches
 * in, Dr 1300 / Cr 1900 at the receiver) happens when that branch confirms, in services/transfers.ts. The goods
 * on the way are in neither branch's stock, so each branch's stock still equals its movements and 1300.
 */
export async function createTransfer(
  db: Database,
  auth: AccessClaims,
  input: TransferInput,
  meta: RequestMeta,
): Promise<TransferDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // The goods leave the sending branch: the right must hold THERE, not only somewhere
    const from = await branchOf(tx, input.fromBranchId);
    await requirePermission(tx, auth.userId, 'inventory.adjust', from);
    const to = await branchOf(tx, input.toBranchId);
    const inTransit = await sendsInTransit(tx, input.mode, from, to);
    if (inTransit) {
      // A transfer on the way keeps one line per item: the receipt confirms what arrived item by item
      const seen = new Set<string>();
      for (const [i, l] of input.lines.entries()) {
        if (seen.has(l.variantId))
          throw invalid({ [`lines.${i}.variantId`]: 'هذا الصنف مكرر في التحويل: اجمع كمياته في سطر واحد' });
        seen.add(l.variantId);
      }
    }
    const names = await stockedVariants(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const missing = input.lines.findIndex((l) => !names.has(l.variantId));
    if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
    await costPending(tx, auth.tenantId);
    // A tracked product travels with its serial numbers, which move to the receiving branch
    const outgoing = await outgoingSerials(tx, from, input.lines);

    const keys: StockKey[] = input.lines.flatMap((l) => [
      stockKey(from, l.variantId),
      stockKey(to, l.variantId),
    ]);
    const values = await loadValues(tx, auth.tenantId, keys);
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    const lines: TransferDetail['lines'] = [];
    let costDiff = 0;
    if (input.strictStock) {
      // The screen asks for this: more than the sender holds is a typing slip, not a sale below nothing
      const asked = new Map<string, number>();
      for (const l of input.lines) asked.set(l.variantId, (asked.get(l.variantId) ?? 0) + l.qty);
      for (const [i, l] of input.lines.entries()) {
        const held = values.get(stockKey(from, l.variantId))?.qty ?? 0;
        if ((asked.get(l.variantId) ?? 0) > Math.max(0, held)) {
          throw invalid({
            [`lines.${i}.qty`]: `عند المرسِل ${Math.max(0, held) / 1000} فقط من هذا الصنف. اكتب كمية أقل`,
          });
        }
      }
    }
    for (const l of input.lines) {
      const outKey = stockKey(from, l.variantId);
      const inKey = stockKey(to, l.variantId);
      const out = stockOut(values.get(outKey) ?? empty, l.qty);
      values.set(outKey, out.after);
      if (!inTransit) {
        const into = stockIn(values.get(inKey) ?? empty, l.qty, Math.max(0, out.costMinor));
        values.set(inKey, into.after);
        costDiff += into.costMinor;
      }
      lines.push({
        variantId: l.variantId,
        name: names.get(l.variantId)!,
        qty: l.qty,
        valueMinor: out.costMinor,
      });
    }
    await saveValues(tx, auth.tenantId, values);

    const id = newId();
    const inId = newId();
    const number = await nextNumber(tx, auth.tenantId, 'TRF', input.date);
    const valueMinor = lines.reduce((sum, l) => sum + l.valueMinor, 0);
    await tx.insert(transfers).values({
      tenantId: auth.tenantId,
      id,
      inId,
      number,
      fromBranchId: from,
      toBranchId: to,
      businessDate: input.date,
      note: input.note ?? null,
      lines: inTransit ? await withSerialNumbers(tx, lines, outgoing) : lines,
      valueMinor,
      inTransit,
      createdBy: auth.userId,
    });
    if (inTransit) {
      // The pieces leave the sender's shelf and wait: nobody sells them until the receiver confirms
      if (outgoing.length > 0)
        await tx
          .update(serials)
          .set({ status: 'in_transit' })
          .where(inArray(serials.id, [...outgoing]));
    } else {
      await relocateSerials(tx, outgoing, to);
    }
    const moves = (sign: 1 | -1) =>
      input.lines.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, qty: sign * l.qty }));
    await moveStock(tx, auth.tenantId, from, id, 'transfer', input.date, moves(-1));
    if (!inTransit) await moveStock(tx, auth.tenantId, to, inId, 'transfer', input.date, moves(1));
    // The same batches leave the sender and arrive at the receiver (earliest expiry first when none is named)
    const sent = await takeBatches(
      tx,
      from,
      input.lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
      (i) => `lines.${i}.qty`,
    );
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId: from, kind: 'transfer_out', docId: id, date: input.date },
      sent.map((r) => ({ ...r, qty: -r.qty })),
    );
    if (!inTransit) {
      await recordBatchMovements(
        tx,
        { tenantId: auth.tenantId, branchId: to, kind: 'transfer_in', docId: inId, date: input.date },
        sent,
      );
    }
    await refreshBatches(
      tx,
      inTransit ? [from] : [from, to],
      input.lines.map((l) => l.variantId),
    );
    const currency = await baseCurrency(tx);
    const memo = `تحويل ${number}${input.note ? `: ${input.note}` : ''}`;
    // The sender: Dr 1900 / Cr 1300; the receiver: Dr 1300 / Cr 1900 (and what its oversold
    // pieces really cost against cost of sales, as a purchase does)
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: from,
      date: input.date,
      sourceType: 'transfer',
      sourceId: id,
      sourceNumber: number,
      memo,
      baseCurrency: currency,
      lines: costLines(valueMinor, currency, '1900'),
    });
    if (!inTransit) {
      await postEntry(tx, {
        tenantId: auth.tenantId,
        branchId: to,
        date: input.date,
        sourceType: 'transfer',
        sourceId: inId,
        sourceNumber: number,
        memo,
        baseCurrency: currency,
        lines: [
          ...costLines(-valueMinor, currency, '1900'),
          ...(costDiff !== 0 ? costLines(costDiff, currency) : []),
        ],
      });
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: inTransit ? 'transfer.send' : 'transfer.create',
        entity: 'transfer',
        entityId: id,
        changes: { number: [null, number], valueMinor: [null, valueMinor] },
      },
      meta,
    );
    return {
      id,
      number,
      date: input.date,
      fromBranchId: from,
      toBranchId: to,
      lines,
      valueMinor,
      baseCurrency: currency,
      status: inTransit ? 'in_transit' : 'received',
    };
  });
}

/** What the transfer keeps of each line's serial numbers while the goods are on the way */
async function withSerialNumbers(
  tx: Transaction,
  lines: TransferDetail['lines'],
  serialIds: readonly string[],
): Promise<TransferDetail['lines']> {
  if (serialIds.length === 0) return lines;
  const rows = await tx
    .select({ serial: serials.serial, variantId: serials.variantId })
    .from(serials)
    .where(inArray(serials.id, [...serialIds]));
  return lines.map((l) => {
    const own = rows.filter((r) => r.variantId === l.variantId).map((r) => r.serial);
    return own.length > 0 ? { ...l, serials: own } : l;
  });
}

export function listTransfers(
  db: Database,
  auth: AccessClaims,
  query: { limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<TransferListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'inventory.adjust');
    // The page is the newest ones; every transfer still on the way is on the first page whatever its age, so one that
    // is old can still be received (round 44). The cursor is how many of the rest came before.
    const limit = query.limit ?? 50;
    const offset = /^o:\d{1,7}$/.test(query.cursor ?? '') ? Number(query.cursor!.slice(2)) : 0;
    const mine = scope.all
      ? sql``
      : sql`and (t.from_branch_id = any(${uuidArray([...scope.branchIds])}) or t.to_branch_id = any(${uuidArray([...scope.branchIds])}))`;
    const pending = sql`(t.in_transit and r.id is null)`;
    const pick = (where: ReturnType<typeof sql>, tail: ReturnType<typeof sql>) => sql`
      select t.id, t.number, t.business_date::text as date, f.name as from_name, d.name as to_name,
             coalesce((select sum((l ->> 'qty')::bigint) from jsonb_array_elements(t.lines) l), 0)::text as pieces,
             t.value_minor::text as value, t.from_branch_id as from_id, t.to_branch_id as to_id, t.in_transit,
             (r.id is not null) as received, (r.id is not null and r.branch_id = t.from_branch_id) as cancelled,
             coalesce(r.short_pieces, 0)::text as short
      from transfers t
      join branches f on f.id = t.from_branch_id
      join branches d on d.id = t.to_branch_id
      left join transfer_receipts r on r.tenant_id = t.tenant_id and r.transfer_id = t.id
      where ${where} ${mine}
      order by t.business_date desc, t.created_at desc ${tail}`;
    type Found = {
      id: string;
      number: string;
      date: string;
      from_name: string;
      to_name: string;
      pieces: string;
      value: string;
      from_id: string;
      to_id: string;
      in_transit: boolean;
      received: boolean;
      cancelled: boolean;
      short: string;
    };
    const waiting = offset === 0 ? await tx.execute<Found>(pick(pending, sql``)) : [];
    const rest = await tx.execute<Found>(pick(sql`not ${pending}`, sql`limit ${limit + 1} offset ${offset}`));
    const [count] = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from transfers t
      left join transfer_receipts r on r.tenant_id = t.tenant_id and r.transfer_id = t.id
      where ${pending} ${mine}`);
    const more = rest.length > limit;
    const row = (r: Found): TransferRow => {
      const onWay = r.in_transit && !r.received;
      return {
        id: r.id,
        number: r.number,
        date: r.date,
        fromBranch: r.from_name,
        toBranch: r.to_name,
        pieces: Number(r.pieces),
        valueMinor: Number(r.value),
        status: onWay ? 'in_transit' : r.cancelled ? 'cancelled' : 'received',
        fromBranchId: r.from_id,
        toBranchId: r.to_id,
        ...(Number(r.short) > 0 ? { shortPieces: Number(r.short) } : {}),
        canReceive: onWay && inScope(scope, r.to_id),
        canCancel: onWay && inScope(scope, r.from_id),
      };
    };
    return {
      items: [...waiting, ...rest.slice(0, limit)].map(row),
      nextCursor: more ? `o:${offset + limit}` : null,
      inTransit: Number(count?.n ?? 0),
    };
  });
}

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

export async function profitReport(
  db: Database,
  auth: AccessClaims,
  query: { from: string; to: string; branchId?: string },
): Promise<ProfitReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'reports.financial');
    await costPending(tx, auth.tenantId);
    const [row] = await tx.execute<{ net: string; cost: string; loss: string }>(sql`
      select
        coalesce(sum(l.credit_minor - l.debit_minor) filter (where a.code in ('4100', '4200', '4300')), 0)::text as net,
        coalesce(sum(l.debit_minor - l.credit_minor) filter (where a.code = '5100'), 0)::text as cost,
        coalesce(sum(l.debit_minor - l.credit_minor) filter (where a.code = '6300'), 0)::text as loss
      from journal_lines l
      join journal_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
      join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
      where e.entry_date between ${query.from} and ${query.to}
        ${query.branchId ? sql`and e.branch_id = ${query.branchId}` : sql``}`);
    // The products that sold for less than they cost in the period: the count is what the margin
    // hint says, the list (worst first) is what its link shows
    const belowRows = await tx.execute<{
      product_id: string;
      name: string;
      qty: string;
      sold: string;
      cost: string;
    }>(sql`
      select l.product_id, min(l.name) as name,
             sum(case when c.kind = 'sale' then l.base_qty else -l.base_qty end)::text as qty,
             sum(case when c.kind = 'sale' then l.total_minor - l.tax_minor else l.tax_minor - l.total_minor end)::text as sold,
             sum(c.cost_minor)::text as cost
      from movement_costs c
      join invoice_lines l on l.tenant_id = c.tenant_id and l.invoice_id = c.doc_id and l.line_no = c.line_no
      where c.business_date between ${query.from} and ${query.to}
        ${query.branchId ? sql`and c.branch_id = ${query.branchId}` : sql``}
      group by l.product_id
      having sum(case when c.kind = 'sale' then l.total_minor - l.tax_minor else l.tax_minor - l.total_minor end)
             < sum(c.cost_minor)
      order by sum(c.cost_minor) - sum(case when c.kind = 'sale' then l.total_minor - l.tax_minor else l.tax_minor - l.total_minor end) desc`);
    const belowCost = belowRows.slice(0, 100).map((r) => ({
      productId: r.product_id,
      name: r.name,
      qty: Number(r.qty),
      soldMinor: Number(r.sold),
      costMinor: Number(r.cost),
      lossMinor: Number(r.cost) - Number(r.sold),
    }));
    const net = Number(row?.net ?? 0);
    const cost = Number(row?.cost ?? 0);
    return {
      from: query.from,
      to: query.to,
      netSalesMinor: net,
      costOfSalesMinor: cost,
      grossProfitMinor: net - cost,
      stockLossMinor: Number(row?.loss ?? 0),
      belowCostCount: belowRows.length,
      belowCost,
      baseCurrency: await baseCurrency(tx),
    };
  });
}
