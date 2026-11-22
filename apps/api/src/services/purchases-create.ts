import { asc, eq, inArray, sql } from 'drizzle-orm';
import {
  stockIn,
  type PurchaseCurrencyCode,
  type PurchaseDetail,
  type PurchaseInput,
  type PurchaseListResponse,
  type PurchaseRow,
} from '@serva/core';
import {
  purchaseAttachments,
  purchaseLines,
  purchases,
  serials,
  stockLevels,
  stockMovements,
  suppliers,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { costLines, costPending, loadValues, saveValues, stockKey, uuidArray } from './costing';
import { postEntry, type DraftLine } from './posting';
import { recordBatchMovements, refreshBatches, requiringExpiry, trackedVariants } from './batches';
import { applyReceipt } from './purchase-order-receipt';
import { usdTerms, usdToBase } from './purchase-usd';
import { receiveSerials } from './serials';
import {
  newId,
  notFound,
  invalid,
  spreadAdjustment,
  documentLock,
  baseCurrency,
  branchOf,
  nextNumber,
  stockedVariants,
  effectiveDue,
  PAY_ACCOUNT,
} from './purchases-common';

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
           (${effectiveDue})::text as due_date, p.discount_minor::text, p.charges_minor::text, p.tenant_id,
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
             p.reference, p.total_minor::text, p.currency, p.rate, p.foreign_total_minor::text, (${effectiveDue})::text as due_date,
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
