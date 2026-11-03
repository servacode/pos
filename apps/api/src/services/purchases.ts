import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  stockIn,
  stockBack,
  stockOut,
  type CurrencyCode,
  type InventoryResponse,
  type ProfitReport,
  type PurchaseDetail,
  type PurchaseInput,
  type PurchaseListResponse,
  type PurchaseRow,
  type StocktakeDetail,
  type StocktakeInput,
  type StocktakeLineRow,
  type StockValue,
  type SupplierInput,
  type SupplierListResponse,
  type SupplierPaymentInput,
  type SupplierPaymentRow,
  type SupplierRow,
} from '@serva/core';
import {
  branches,
  documentSequences,
  purchaseLines,
  purchases,
  serials,
  stockLevels,
  stockMovements,
  stocktakes,
  supplierPayments,
  suppliers,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { requirePermission } from '../auth/permissions';
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
import { postEntry, type DraftLine } from './posting';
import { refreshExpiry } from './expiry';
import { receiveSerials } from './serials';

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
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

async function baseCurrency(tx: Transaction): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return (row?.base ?? 'SYP') as CurrencyCode;
}

async function branchOf(tx: Transaction, branchId: string | undefined): Promise<string> {
  const [row] = branchId
    ? await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId))
    : await tx.select({ id: branches.id }).from(branches).orderBy(asc(branches.code)).limit(1);
  if (!row) throw invalid({ branchId: 'الفرع غير موجود' });
  return row.id;
}

/** The next number of a dashboard series this year: «PUR-2026-000001». */
async function nextNumber(tx: Transaction, tenantId: string, series: string, date: string): Promise<string> {
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

const supplierBalances = sql`
  select l.party_id as supplier_id, sum(l.credit_minor - l.debit_minor) as balance
  from journal_lines l join accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
  where a.code = '2100' and l.party_type = 'supplier'
  group by l.party_id`;

// ─── Suppliers ───────────────────────────────────────────────────────────────

async function supplierRows(tx: Transaction, id?: string): Promise<SupplierRow[]> {
  const rows = await tx.execute<{
    id: string;
    name: string;
    phone: string | null;
    notes: string | null;
    archived_at: string | null;
    balance: string;
  }>(sql`
    select s.id, s.name, s.phone, s.notes, s.archived_at, coalesce(b.balance, 0)::text as balance
    from suppliers s left join (${supplierBalances}) b on b.supplier_id = s.id
    ${id ? sql`where s.id = ${id}` : sql``}
    order by s.name, s.id`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    balanceMinor: Number(r.balance),
    archived: r.archived_at !== null,
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
    const fields = {
      name: input.name,
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
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
  });
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
  }>(sql`
    select p.id, p.number, p.business_date::text, p.supplier_id, s.name as supplier_name, p.payment,
           p.reference, p.total_minor::text, p.branch_id, p.notes
    from purchases p join suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
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
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      variantId: l.variantId,
      productId: owners.get(l.variantId) ?? '',
      name: l.name,
      qty: l.qty,
      costMinor: l.costMinor,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      serials: numbers.filter((n) => n.variantId === l.variantId).map((n) => n.serial),
    })),
    baseCurrency: await baseCurrency(tx),
  };
}

/** Moves stock for a dashboard document (purchase or count), once per line. */
async function moveStock(
  tx: Transaction,
  tenantId: string,
  branchId: string,
  docId: string,
  kind: 'purchase' | 'stocktake',
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
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const branchId = await branchOf(tx, input.branchId);
    const names = await stockedVariants(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const missing = input.lines.findIndex((l) => !names.has(l.variantId));
    if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });

    // What was sold until now is costed at the old average first
    await costPending(tx, auth.tenantId);
    const id = newId();
    const number = await nextNumber(tx, auth.tenantId, 'PUR', input.date);
    const total = input.lines.reduce((sum, l) => sum + l.costMinor, 0);
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
      createdBy: auth.userId,
    });
    const lines = input.lines.map((l, i) => ({ ...l, lineNo: i + 1, name: names.get(l.variantId)! }));
    await tx.insert(purchaseLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        purchaseId: id,
        lineNo: l.lineNo,
        variantId: l.variantId,
        name: l.name,
        qty: l.qty,
        costMinor: l.costMinor,
        batchNo: l.batchNo ?? null,
        expiryDate: l.expiryDate ?? null,
      })),
    );
    await moveStock(tx, auth.tenantId, branchId, id, 'purchase', input.date, lines);
    await receiveSerials(tx, auth.tenantId, id, input.lines);
    await refreshExpiry(
      tx,
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

    const currency = await baseCurrency(tx);
    const credit: DraftLine =
      input.payment === 'credit'
        ? {
            account: { code: '2100' },
            baseMinor: -total,
            currency,
            amountMinor: -total,
            rate: null,
            party: { type: 'supplier', id: supplier.id },
            memo: supplier.name,
          }
        : {
            account: PAY_ACCOUNT(input.payment, currency),
            baseMinor: -total,
            currency,
            amountMinor: -total,
            rate: null,
          };
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId,
      date: input.date,
      sourceType: 'purchase',
      sourceId: id,
      sourceNumber: number,
      memo: `فاتورة شراء ${number} من ${supplier.name}${input.reference ? ` (${input.reference})` : ''}`,
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
    return purchaseDetail(tx, id);
  });
}

export async function readPurchase(db: Database, auth: AccessClaims, id: string): Promise<PurchaseDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    return purchaseDetail(tx, id);
  });
}

export async function listPurchases(
  db: Database,
  auth: AccessClaims,
  query: { from?: string; to?: string; supplierId?: string },
): Promise<PurchaseListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const conditions = [sql`true`];
    if (query.from) conditions.push(sql`p.business_date >= ${query.from}`);
    if (query.to) conditions.push(sql`p.business_date <= ${query.to}`);
    if (query.supplierId) conditions.push(sql`p.supplier_id = ${query.supplierId}`);
    const rows = await tx.execute<{
      id: string;
      number: string;
      business_date: string;
      supplier_id: string;
      supplier_name: string;
      payment: PurchaseRow['payment'];
      reference: string | null;
      total_minor: string;
    }>(sql`
      select p.id, p.number, p.business_date::text, p.supplier_id, s.name as supplier_name, p.payment,
             p.reference, p.total_minor::text
      from purchases p join suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
      where ${sql.join(conditions, sql` and `)}
      order by p.business_date desc, p.number desc
      limit 500`);
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        date: r.business_date,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        payment: r.payment,
        reference: r.reference,
        totalMinor: Number(r.total_minor),
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
): Promise<SupplierPaymentRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const id = newId();
    const number = await nextNumber(tx, auth.tenantId, 'PAY', input.date);
    await tx.insert(supplierPayments).values({
      tenantId: auth.tenantId,
      id,
      number,
      supplierId: supplier.id,
      businessDate: input.date,
      amountMinor: input.amountMinor,
      method: input.method,
      note: input.note ?? null,
      createdBy: auth.userId,
    });
    const currency = await baseCurrency(tx);
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: await branchOf(tx, undefined),
      date: input.date,
      sourceType: 'supplier_payment',
      sourceId: id,
      sourceNumber: number,
      memo: `سند دفع ${number} إلى ${supplier.name}`,
      baseCurrency: currency,
      lines: [
        {
          account: { code: '2100' },
          baseMinor: input.amountMinor,
          currency,
          amountMinor: input.amountMinor,
          rate: null,
          party: { type: 'supplier', id: supplier.id },
          memo: supplier.name,
        },
        {
          account: PAY_ACCOUNT(input.method, currency),
          baseMinor: -input.amountMinor,
          currency,
          amountMinor: -input.amountMinor,
          rate: null,
        },
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
        changes: { amountMinor: [null, input.amountMinor] },
      },
      meta,
    );
    return {
      id,
      number,
      supplierId: supplier.id,
      date: input.date,
      amountMinor: input.amountMinor,
      method: input.method,
    };
  });
}

// ─── Inventory, counts and profit ────────────────────────────────────────────

export async function inventory(
  db: Database,
  auth: AccessClaims,
  query: { branchId?: string },
): Promise<InventoryResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'cost.view');
    await costPending(tx, auth.tenantId);
    const rows = await tx.execute<{
      variant_id: string;
      branch_id: string;
      name: string;
      qty: string;
      value_minor: string;
    }>(sql`
      select l.variant_id, l.branch_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             l.qty::text, coalesce(sv.value_minor, 0)::text as value_minor
      from stock_levels l
      join variants v on v.tenant_id = l.tenant_id and v.id = l.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join stock_values sv on sv.tenant_id = l.tenant_id and sv.branch_id = l.branch_id and sv.variant_id = l.variant_id
      ${query.branchId ? sql`where l.branch_id = ${query.branchId}` : sql``}
      order by name, l.variant_id`);
    const items = rows.map((r) => {
      const qty = Number(r.qty);
      const value = Number(r.value_minor);
      return {
        variantId: r.variant_id,
        branchId: r.branch_id,
        name: r.name,
        qty,
        valueMinor: value,
        unitCostMinor: qty > 0 ? Math.round((value * 1000 * 10_000) / qty) / 10_000 : null,
      };
    });
    return {
      items,
      totalValueMinor: items.reduce((sum, i) => sum + i.valueMinor, 0),
      baseCurrency: await baseCurrency(tx),
    };
  });
}

export async function createStocktake(
  db: Database,
  auth: AccessClaims,
  input: StocktakeInput,
  meta: RequestMeta,
): Promise<StocktakeDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'inventory.adjust');
    const branchId = await branchOf(tx, input.branchId);
    const names = await stockedVariants(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const missing = input.lines.findIndex((l) => !names.has(l.variantId));
    if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
    await costPending(tx, auth.tenantId);

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
    const keys: StockKey[] = input.lines.map((l) => stockKey(branchId, l.variantId));
    const values = await loadValues(tx, auth.tenantId, keys);
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };

    const rows: StocktakeLineRow[] = [];
    const moves: { lineNo: number; variantId: string; qty: number }[] = [];
    for (const [i, l] of input.lines.entries()) {
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
      });
      moves.push({ lineNo: i + 1, variantId: l.variantId, qty: diff });
    }
    await saveValues(tx, auth.tenantId, values);

    const id = newId();
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
    await refreshExpiry(
      tx,
      moves.map((m) => m.variantId),
    );
    const currency = await baseCurrency(tx);
    // A loss (negative difference) is Dr 6300 / Cr 1300
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId,
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
    const net = Number(row?.net ?? 0);
    const cost = Number(row?.cost ?? 0);
    return {
      from: query.from,
      to: query.to,
      netSalesMinor: net,
      costOfSalesMinor: cost,
      grossProfitMinor: net - cost,
      stockLossMinor: Number(row?.loss ?? 0),
      baseCurrency: await baseCurrency(tx),
    };
  });
}
