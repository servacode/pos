import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  addDays,
  businessDateOf,
  orderLineCost,
  orderUnitCost,
  type PurchaseOrderAlreadyOrdered,
  PURCHASE_ORDER_NEXT,
  type CurrencyCode,
  type PurchaseOrderDetail,
  type PurchaseOrderInput,
  type PurchaseOrderLine,
  type PurchaseOrderListResponse,
  type PurchaseOrderReceipt,
  type PurchaseOrderRow,
  type PurchaseOrderStatus,
  type PurchaseOrderSuggestion,
  type PurchaseOrderUpdateInput,
} from '@serva/core';
import { branches, purchaseOrders, suppliers, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { nextNumber } from './purchases';

/**
 * «طلبيات الشراء»: an order to a supplier, a promise that posts nothing and moves no stock. It is
 * written as a draft, sent (a WhatsApp message or a printed sheet), and received through ordinary
 * purchases made from it (purchase-order-receipt.ts), as a whole or in parts.
 */

const notFound = () => new AppError(404, 'not_found', 'هذه الطلبية غير موجودة.');
const stale = () => new AppError(409, 'stale_version', 'غيّر شخص آخر الطلبية للتو. حدّث الصفحة.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

type Row = typeof purchaseOrders.$inferSelect;
/** A line as stored: one written before the unit cost was kept has none */
type StoredLine = Omit<PurchaseOrderLine, 'unitCostMinor'> & { unitCostMinor?: number };

/** Sales of the last month set the pace; the suggestion covers two weeks of it above the minimum */
const PERIOD_DAYS = 30;
const COVER_DAYS = 14;
const FAST_DAYS = 7;

async function today(tx: Transaction): Promise<string> {
  const [row] = await tx.execute<{ day: string }>(
    sql`select (now() at time zone t.timezone)::date::text as day from tenants t where t.id = app_current_tenant()`,
  );
  return row!.day;
}

async function zoneOf(tx: Transaction): Promise<string> {
  const [row] = await tx.execute<{ zone: string }>(
    sql`select timezone as zone from tenants where id = app_current_tenant()`,
  );
  return row?.zone ?? 'Asia/Damascus';
}

async function baseOf(tx: Transaction): Promise<CurrencyCode> {
  const [row] = await tx.execute<{ base: string }>(sql`select base_currency as base from tenant_settings`);
  return (row?.base ?? 'SYP') as CurrencyCode;
}

const received = (lines: PurchaseOrderLine[]) =>
  lines.reduce((n, l) => n + Math.min(l.receivedQty, l.qty), 0);

function rowOf(r: Row, supplier: { name: string; phone: string | null }, zone: string): PurchaseOrderRow {
  const lines = r.lines as PurchaseOrderLine[];
  return {
    id: r.id,
    number: r.number,
    status: r.status as PurchaseOrderStatus,
    date: businessDateOf(r.createdAt, zone),
    supplierId: r.supplierId,
    supplierName: supplier.name,
    supplierPhone: supplier.phone,
    expectedDate: r.expectedDate,
    totalMinor: r.totalMinor,
    orderedQty: lines.reduce((n, l) => n + l.qty, 0),
    receivedQty: received(lines),
    version: r.version,
  };
}

async function detailOf(tx: Transaction, r: Row): Promise<PurchaseOrderDetail> {
  const [s] = await tx
    .select({ name: suppliers.name, phone: suppliers.phone })
    .from(suppliers)
    .where(eq(suppliers.id, r.supplierId));
  return {
    ...rowOf(r, s ?? { name: '', phone: null }, await zoneOf(tx)),
    branchId: r.branchId,
    notes: r.notes,
    lines: (r.lines as StoredLine[]).map((l) => ({
      ...l,
      // An order written before the unit cost was kept has it worked out from the line's cost
      unitCostMinor: l.unitCostMinor ?? orderUnitCost(l.costMinor, l.qty),
    })),
    receipts: r.receipts as PurchaseOrderReceipt[],
    baseCurrency: await baseOf(tx),
    createdAt: r.createdAt.toISOString(),
  };
}

/** The names of the stocked items among `ids` (a service has no stock to order) */
async function stockedItems(tx: Transaction, ids: string[]) {
  const rows = await tx.execute<{ id: string; product_id: string; name: string }>(sql`
    select v.id, v.product_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name
    from variants v join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    where v.id in (${sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    )}) and p.type = 'stock'`);
  return new Map(rows.map((r) => [r.id, r]));
}

async function checked(tx: Transaction, input: PurchaseOrderInput) {
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
  const [branch] = input.branchId
    ? await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, input.branchId))
    : await tx.select({ id: branches.id }).from(branches).orderBy(asc(branches.code)).limit(1);
  if (!branch) throw invalid({ branchId: 'الفرع غير موجود' });
  const items = await stockedItems(
    tx,
    input.lines.map((l) => l.variantId),
  );
  const missing = input.lines.findIndex((l) => !items.has(l.variantId));
  if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
  const lines: PurchaseOrderLine[] = input.lines.map((l, i) => {
    const item = items.get(l.variantId)!;
    // The unit cost is the figure a person types; the line's cost follows it
    const unitCostMinor = l.unitCostMinor ?? orderUnitCost(l.costMinor, l.qty);
    const costMinor = l.unitCostMinor === undefined ? l.costMinor : orderLineCost(unitCostMinor, l.qty);
    return {
      lineNo: i + 1,
      variantId: l.variantId,
      productId: item.product_id,
      name: item.name,
      qty: l.qty,
      costMinor,
      unitCostMinor,
      receivedQty: 0,
    };
  });
  return {
    supplier,
    branchId: branch.id,
    lines,
    totalMinor: lines.reduce((n, l) => n + l.costMinor, 0),
  };
}

export function createPurchaseOrder(
  db: Database,
  auth: AccessClaims,
  input: PurchaseOrderInput,
  meta: RequestMeta,
): Promise<PurchaseOrderDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const day = await today(tx);
    if (input.expectedDate && input.expectedDate < day) {
      throw invalid({ expectedDate: 'موعد التسليم قبل اليوم' });
    }
    const { branchId, lines, totalMinor } = await checked(tx, input);
    const number = await nextNumber(tx, auth.tenantId, 'PO', day);
    const [made] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: auth.tenantId,
        number,
        supplierId: input.supplierId,
        branchId,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        lines,
        totalMinor,
        createdBy: auth.userId,
      })
      .returning();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'purchase_order.create',
        entity: 'purchase_order',
        entityId: made!.id,
        changes: { number: [null, number], totalMinor: [null, totalMinor] },
      },
      meta,
    );
    return detailOf(tx, made!);
  });
}

export function updatePurchaseOrder(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: PurchaseOrderUpdateInput,
  meta: RequestMeta,
): Promise<PurchaseOrderDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [current] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for('update');
    if (!current) throw notFound();
    if (current.version !== input.version) throw stale();
    if (current.status !== 'draft' && current.status !== 'sent') {
      throw new AppError(409, 'conflict', 'لا تُعدَّل طلبية استُلم منها شيء أو أُغلقت.');
    }
    const day = await today(tx);
    if (input.expectedDate && input.expectedDate !== current.expectedDate && input.expectedDate < day) {
      throw invalid({ expectedDate: 'موعد التسليم قبل اليوم' });
    }
    const { branchId, lines, totalMinor } = await checked(tx, input);
    const [row] = await tx
      .update(purchaseOrders)
      .set({
        supplierId: input.supplierId,
        branchId,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        lines,
        totalMinor,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id))
      .returning();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'purchase_order.update',
        entity: 'purchase_order',
        entityId: id,
        changes: { totalMinor: [current.totalMinor, totalMinor] },
      },
      meta,
    );
    return detailOf(tx, row!);
  });
}

export function movePurchaseOrder(
  db: Database,
  auth: AccessClaims,
  id: string,
  to: 'sent' | 'received' | 'cancelled',
  version: number,
  meta: RequestMeta,
): Promise<PurchaseOrderDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [current] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for('update');
    if (!current) throw notFound();
    if (current.version !== version) throw stale();
    const from = current.status as PurchaseOrderStatus;
    if (!PURCHASE_ORDER_NEXT[from].includes(to)) {
      throw new AppError(409, 'conflict', 'لا تنتقل الطلبية من حالتها الحالية إلى هذه الحالة.');
    }
    const [row] = await tx
      .update(purchaseOrders)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'purchase_order.status',
        entity: 'purchase_order',
        entityId: id,
        changes: { status: [from, to] },
      },
      meta,
    );
    return detailOf(tx, row!);
  });
}

export function readPurchaseOrder(
  db: Database,
  auth: AccessClaims,
  id: string,
): Promise<PurchaseOrderDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [row] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!row) throw notFound();
    return detailOf(tx, row);
  });
}

export function listPurchaseOrders(
  db: Database,
  auth: AccessClaims,
  query: { status?: PurchaseOrderStatus | undefined; supplierId?: string | undefined },
): Promise<PurchaseOrderListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const conditions = [sql`true`];
    if (query.status) conditions.push(eq(purchaseOrders.status, query.status));
    if (query.supplierId) conditions.push(eq(purchaseOrders.supplierId, query.supplierId));
    const zone = await zoneOf(tx);
    const rows = await tx
      .select({ order: purchaseOrders, name: suppliers.name, phone: suppliers.phone })
      .from(purchaseOrders)
      .innerJoin(
        suppliers,
        and(eq(suppliers.tenantId, purchaseOrders.tenantId), eq(suppliers.id, purchaseOrders.supplierId)),
      )
      .where(and(...conditions))
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.number))
      .limit(500);
    return { items: rows.map((r) => rowOf(r.order, { name: r.name, phone: r.phone }, zone)) };
  });
}

/**
 * «اقترح طلبية»: the items that run short, for one supplier. An item runs short when its stock is at
 * or under its minimum, or a week of the last month's sales would finish it. The quantity brings it
 * to the minimum plus two weeks of that pace, less what is on the shelf and what is still owed on
 * waiting orders, in whole units. An item belongs to the supplier it was last bought from; `all`
 * adds the ones never bought. The owner edits the list; nothing is saved here.
 */
export function suggestPurchaseOrder(
  db: Database,
  auth: AccessClaims,
  query: { supplierId: string; all?: boolean },
): Promise<PurchaseOrderSuggestion> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'purchases.manage');
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, query.supplierId));
    if (!supplier) throw invalid({ supplierId: 'اختر المورد' });
    const day = await today(tx);
    const base = await baseOf(tx);
    const from = addDays(day, 1 - PERIOD_DAYS);
    const rows = await tx.execute<{
      variant_id: string;
      product_id: string;
      product_name: string;
      name: string;
      attributes: { name: string; value: string }[] | null;
      stock: string;
      min: string | null;
      sold: string;
      on_order: string;
      order_numbers: string[] | null;
      last_supplier: string | null;
      last_cost: string | null;
      last_qty: string | null;
      typical_unit: string | null;
      price: string | null;
    }>(sql`
      with sold as (
        select l.variant_id, sum(l.base_qty) as qty
        from invoice_lines l join invoices i on i.tenant_id = l.tenant_id and i.id = l.invoice_id
        where i.business_date between ${from} and ${day}
        group by l.variant_id
      ),
      back as (
        select rl.variant_id, sum(rl.base_qty) as qty
        from sale_return_lines rl join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
        where r.business_date between ${from} and ${day}
        group by rl.variant_id
      ),
      stock as (select variant_id, sum(qty) as qty from stock_levels group by variant_id),
      lastbuy as (
        select distinct on (pl.variant_id) pl.variant_id, p.supplier_id, pl.cost_minor, pl.qty
        from purchase_lines pl join purchases p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
        order by pl.variant_id, p.business_date desc, p.created_at desc, pl.line_no desc
      ),
      ordered as (
        select (l->>'variantId')::uuid as variant_id,
               sum(greatest((l->>'qty')::bigint - (l->>'receivedQty')::bigint, 0)) as qty,
               array_agg(distinct o.number order by o.number) as numbers
        from purchase_orders o, jsonb_array_elements(o.lines) l
        where o.status in ('sent', 'partial')
        group by 1
      )
      select v.id as variant_id, v.product_id, p.name_ar as product_name,
             trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, v.attributes,
             coalesce(k.qty, 0)::text as stock, v.min_stock_qty::text as min,
             (coalesce(s.qty, 0) - coalesce(b.qty, 0))::text as sold,
             coalesce(o.qty, 0)::text as on_order, o.numbers as order_numbers,
             lb.supplier_id::text as last_supplier, lb.cost_minor::text as last_cost, lb.qty::text as last_qty,
             (select (percentile_cont(0.5) within group (order by t.c))::text from (
                select pl.cost_minor * 1000.0 / pl.qty as c from purchase_lines pl
                join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
                where pl.variant_id = v.id and pl.qty > 0 and pl.cost_minor > 0
                order by pu.business_date desc, pu.created_at desc, pl.line_no desc limit 5) t) as typical_unit,
             pr.price_minor::text as price
      from variants v
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join stock k on k.variant_id = v.id
      left join sold s on s.variant_id = v.id
      left join back b on b.variant_id = v.id
      left join ordered o on o.variant_id = v.id
      left join lastbuy lb on lb.variant_id = v.id
      left join prices pr on pr.tenant_id = v.tenant_id and pr.id = v.id and pr.currency = ${base}
      where v.archived_at is null and p.archived_at is null and p.type = 'stock'
        and (lb.supplier_id = ${query.supplierId} ${query.all ? sql`or lb.supplier_id is null` : sql``})
      order by p.name_ar, v.sort_order`);

    const items: PurchaseOrderSuggestion['items'] = [];
    const alreadyOrdered: PurchaseOrderAlreadyOrdered[] = [];
    for (const r of rows) {
      const stock = Number(r.stock);
      const min = r.min === null ? null : Number(r.min);
      const sold = Math.max(0, Number(r.sold));
      const onOrder = Number(r.on_order);
      const perDay = sold / PERIOD_DAYS;
      const below = min !== null && stock <= min;
      const fast = sold > 0 && stock <= perDay * FAST_DAYS;
      if (!below && !fast) continue;
      const wanted = (min ?? 0) + perDay * COVER_DAYS - stock;
      const need = wanted - onOrder;
      if (need <= 0) {
        // Short, but a waiting order already owes it: said, so the list does not look broken
        if (wanted > 0 && onOrder > 0) {
          alreadyOrdered.push({
            variantId: r.variant_id,
            name: r.name,
            onOrderQty: onOrder,
            orderNumbers: r.order_numbers ?? [],
          });
        }
        continue;
      }
      const suggestedQty = Math.max(1000, Math.ceil(need / 1000) * 1000);
      const lastQty = r.last_qty === null ? 0 : Number(r.last_qty);
      const unitCostMinor = lastQty > 0 ? orderUnitCost(Number(r.last_cost), lastQty) : 0;
      const typical = r.typical_unit === null ? 0 : Number(r.typical_unit);
      const priceMinor = r.price === null ? null : Number(r.price);
      const costDoubtful =
        unitCostMinor > 0 &&
        ((typical > 0 && (unitCostMinor > typical * 5 || unitCostMinor * 5 < typical)) ||
          (priceMinor !== null && priceMinor > 0 && unitCostMinor > priceMinor * 20));
      items.push({
        variantId: r.variant_id,
        productId: r.product_id,
        name: r.name,
        productName: r.product_name,
        attributes: r.attributes ?? [],
        stockQty: stock,
        minStockQty: min,
        soldQty: sold,
        onOrderQty: onOrder,
        suggestedQty,
        costMinor: orderLineCost(unitCostMinor, suggestedQty),
        unitCostMinor,
        costDoubtful,
        priceMinor,
        reason: below ? 'below_min' : 'selling_fast',
        lastSupplierId: r.last_supplier,
      });
    }
    return { periodDays: PERIOD_DAYS, coverDays: COVER_DAYS, items, alreadyOrdered, baseCurrency: base };
  });
}
