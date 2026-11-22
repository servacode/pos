import { and, eq, sql } from 'drizzle-orm';
import {
  roundDiv,
  type CurrencyCode,
  type PickingList,
  type PickingListQuery,
  type SalesOrderAssignInput,
  type SalesOrderCancelInput,
  type SalesOrderCreateInput,
  type SalesOrderLine,
  type SalesOrderLineView,
  type SalesOrderListQuery,
  type SalesOrderRow,
  type SalesOrderStatus,
  type CommittedRow,
  type DistributionSettings,
} from '@serva/core';
import { salesOrders, withTenant, type Database, type Transaction } from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { fieldError, staleVersion } from './catalog/common';
import { uuidArray } from './costing';
import { readDistributionSettings } from './distribution';
import { nextNumber } from './purchases';
import { assertRepsEnabled } from './subscription-gate';

/**
 * «طلبيات البيع المسبق» (packages/core › contracts/distribution.ts): a rep promises goods to a customer
 * (or the supervisor takes the order by phone) and the shop fills it later. An order posts NOTHING and
 * touches no stock: what it promises is computed from the open orders (`committed`), never written to
 * stock_levels.reserved_qty. It is invoiced by an ordinary sale that names it (`salesOrderId` in the
 * sale), and that sale marks it delivered here, in part or in whole (`deliverSalesOrder`).
 */

const notFound = () => new AppError(404, 'not_found', 'هذه الطلبية غير موجودة.');
const conflict = (message: string) => new AppError(409, 'conflict', message);

/** Who takes or changes an order: a signed-in user in the admin, or a rep's phone */
export type OrderActor = { kind: 'user'; auth: AccessClaims } | { kind: 'device'; device: DeviceClaims };

const tenantOf = (actor: OrderActor) => (actor.kind === 'user' ? actor.auth.tenantId : actor.device.tenantId);

/** The supervisor's desk: the permission, then the plan (a plan without the reps module sees none of it) */
async function guardAdmin(tx: Transaction, auth: AccessClaims): Promise<void> {
  await requirePermission(tx, auth.userId, 'sales_orders.manage');
  await assertRepsEnabled(tx);
}

/** A rep's phone: only a live rep_phone, on a plan that has the module */
async function guardDevice(tx: Transaction, device: DeviceClaims): Promise<void> {
  const [row] = await tx.execute<{ kind: string }>(
    sql`select kind from devices where id = ${device.deviceId} and revoked_at is null`,
  );
  if (row?.kind !== 'rep_phone') {
    throw new AppError(403, 'forbidden', 'هذا الجهاز ليس جوال مندوب.');
  }
  await assertRepsEnabled(tx);
}

/** The rules of the store, for a rep phone */
export function deviceRepSettings(db: Database, device: DeviceClaims): Promise<DistributionSettings> {
  return withTenant(db, device.tenantId, async (tx) => {
    await guardDevice(tx, device);
    return readDistributionSettings(tx);
  });
}

async function today(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx.execute<{ day: string }>(
    sql`select (now() at time zone t.timezone)::date::text as day from tenants t where t.id = ${tenantId}`,
  );
  return row!.day;
}

// ─── Reading ────────────────────────────────────────────────────────────────

type Db = {
  id: string;
  number: string;
  status: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  branch_id: string;
  warehouse_branch_id: string;
  warehouse_name: string;
  rep_id: string | null;
  rep_name: string | null;
  business_date: string;
  currency: string;
  total_minor: string;
  deposit_minor: string;
  delivery_date: string | null;
  hold_until: string | null;
  note: string | null;
  cancel_reason: string | null;
  lines: SalesOrderLine[];
  version: number;
};

/** An order past its hold date reads `expired` while nobody has touched it */
const select = sql`
  select o.id, o.number,
         case when o.status in ('open', 'partial') and o.hold_until is not null and o.hold_until < now()
              then 'expired' else o.status end as status,
         o.customer_id, c.name as customer_name, c.phone as customer_phone,
         o.branch_id, o.warehouse_branch_id, w.name as warehouse_name,
         o.rep_id, u.full_name as rep_name, o.business_date::text as business_date, o.currency,
         o.total_minor::text as total_minor, o.deposit_minor::text as deposit_minor,
         o.delivery_date::text as delivery_date, o.hold_until::text as hold_until,
         o.note, o.cancel_reason, o.lines, o.version
  from sales_orders o
  join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
  join branches w on w.tenant_id = o.tenant_id and w.id = o.warehouse_branch_id
  left join sales_reps r on r.tenant_id = o.tenant_id and r.id = o.rep_id
  left join users u on u.tenant_id = r.tenant_id and u.id = r.user_id`;

/** Names and codes of the variants the orders carry */
async function lineNames(
  tx: Transaction,
  ids: string[],
): Promise<Map<string, { name: string; sku: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; name: string; sku: string | null }>(sql`
    select v.id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, v.sku
    from variants v join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    where v.id = any(${uuidArray(ids)})`);
  return new Map(rows.map((r) => [r.id, { name: r.name, sku: r.sku }]));
}

async function rowsOf(tx: Transaction, found: Db[]): Promise<SalesOrderRow[]> {
  const names = await lineNames(tx, [...new Set(found.flatMap((o) => o.lines.map((l) => l.variantId)))]);
  return found.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status as SalesOrderStatus,
    customerId: o.customer_id,
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    branchId: o.branch_id,
    warehouseBranchId: o.warehouse_branch_id,
    warehouseName: o.warehouse_name,
    repId: o.rep_id,
    repName: o.rep_name,
    businessDate: o.business_date,
    currency: o.currency as CurrencyCode,
    totalMinor: Number(o.total_minor),
    depositMinor: Number(o.deposit_minor),
    deliveryDate: o.delivery_date,
    holdUntil: o.hold_until ? new Date(o.hold_until).toISOString() : null,
    note: o.note,
    cancelReason: o.cancel_reason,
    lines: o.lines.map((l): SalesOrderLineView => ({
      variantId: l.variantId,
      qty: l.qty,
      deliveredQty: l.deliveredQty ?? 0,
      unitPriceMinor: l.unitPriceMinor,
      name: names.get(l.variantId)?.name ?? 'صنف محذوف',
      sku: names.get(l.variantId)?.sku ?? null,
    })),
    version: o.version,
  }));
}

async function readOrder(tx: Transaction, id: string): Promise<SalesOrderRow> {
  const found = await tx.execute<Db>(sql`${select} where o.id = ${id}`);
  const [row] = await rowsOf(tx, found);
  if (!row) throw notFound();
  return row;
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listSalesOrders(
  db: Database,
  auth: AccessClaims,
  query: SalesOrderListQuery,
): Promise<SalesOrderRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guardAdmin(tx, auth);
    const effective = sql`case when o.status in ('open', 'partial') and o.hold_until is not null and o.hold_until < now() then 'expired' else o.status end`;
    const where = [
      query.status === 'active'
        ? sql`${effective} in ('open', 'partial')`
        : query.status
          ? sql`${effective} = ${query.status}`
          : sql`true`,
      query.customerId ? sql`o.customer_id = ${query.customerId}` : sql`true`,
      query.repId ? sql`o.rep_id = ${query.repId}` : sql`true`,
      query.warehouseBranchId ? sql`o.warehouse_branch_id = ${query.warehouseBranchId}` : sql`true`,
      query.from ? sql`o.business_date >= ${query.from}` : sql`true`,
      query.to ? sql`o.business_date <= ${query.to}` : sql`true`,
      query.q
        ? sql`(o.number ilike ${`%${escapeLike(query.q)}%`} or c.name ilike ${`%${escapeLike(query.q)}%`})`
        : sql`true`,
    ];
    const found = await tx.execute<Db>(
      sql`${select} where ${sql.join(where, sql` and `)} order by o.business_date desc, o.number desc limit 300`,
    );
    return rowsOf(tx, found);
  });
}

export function getSalesOrder(db: Database, auth: AccessClaims, id: string): Promise<SalesOrderRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guardAdmin(tx, auth);
    return readOrder(tx, id);
  });
}

// ─── Taking an order ────────────────────────────────────────────────────────

/** What the lines add up to: quantity in thousandths times the price of one base unit */
export function orderTotal(lines: readonly { qty: number; unitPriceMinor: number }[]): number {
  let total = 0n;
  for (const l of lines) total += roundDiv(BigInt(l.qty) * BigInt(l.unitPriceMinor), 1000n);
  return Number(total);
}

/** The rep a phone works for: the one who holds its van (or names it as his phone) */
async function repOfDevice(tx: Transaction, device: DeviceClaims): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    select id from sales_reps
    where status = 'active' and (device_id = ${device.deviceId} or van_branch_id = ${device.branchId})
    order by (device_id = ${device.deviceId}) desc limit 1`);
  return row?.id ?? null;
}

export function createSalesOrder(
  db: Database,
  actor: OrderActor,
  input: SalesOrderCreateInput,
  meta: RequestMeta,
): Promise<SalesOrderRow> {
  const tenantId = tenantOf(actor);
  return withTenant(db, tenantId, async (tx) => {
    if (actor.kind === 'user') await guardAdmin(tx, actor.auth);
    else await guardDevice(tx, actor.device);

    // Sent again after a lost answer it is the same order
    if (input.id) {
      const [again] = await tx.execute<{ customer_id: string }>(
        sql`select customer_id from sales_orders where id = ${input.id}`,
      );
      if (again) {
        if (again.customer_id !== input.customerId) throw conflict('رقم الطلبية مستخدم لطلبية أخرى.');
        return readOrder(tx, input.id);
      }
    }

    const [customer] = await tx.execute<{ id: string; archived: boolean; approval: string }>(
      sql`select id, archived_at is not null as archived, approval_status as approval from customers where id = ${input.customerId}`,
    );
    if (!customer) throw fieldError('customerId', 'هذا الزبون غير موجود');
    if (customer.archived || customer.approval === 'rejected')
      throw fieldError('customerId', 'هذا الزبون موقوف');

    const [warehouse] = await tx.execute<{ id: string }>(
      sql`select id from branches where id = ${input.warehouseBranchId} and is_active`,
    );
    if (!warehouse) throw fieldError('warehouseBranchId', 'مكان التجهيز غير موجود');

    // The currency is the store's own or one it uses
    const [settings] = await tx.execute<{ base: string; enabled: string[] }>(
      sql`select base_currency as base, enabled_currencies as enabled from tenant_settings limit 1`,
    );
    if (settings && input.currency !== settings.base && !settings.enabled.includes(input.currency))
      throw fieldError('currency', 'عملة غير مفعّلة');

    // Every line is a live item of the store
    const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
    const known = await tx.execute<{ id: string }>(sql`
      select v.id from variants v
      where v.id = any(${uuidArray(variantIds)}) and v.archived_at is null`);
    const knownIds = new Set(known.map((r) => r.id));
    const missing = input.lines.findIndex((l) => !knownIds.has(l.variantId));
    if (missing >= 0) throw fieldError(`lines.${missing}.variantId`, 'صنف غير موجود');

    const lines: SalesOrderLine[] = input.lines.map((l) => ({
      variantId: l.variantId,
      qty: l.qty,
      // The server keeps what was delivered, never a phone
      deliveredQty: 0,
      unitPriceMinor: l.unitPriceMinor,
    }));
    const totalMinor = orderTotal(lines);
    if (input.depositMinor > totalMinor) throw fieldError('depositMinor', 'العربون أكبر من الطلبية');

    let repId: string | null;
    let branchId: string;
    let createdBy: string | null = null;
    let deviceId: string | null = null;
    if (actor.kind === 'device') {
      repId = await repOfDevice(tx, actor.device);
      if (input.repId && input.repId !== repId) throw fieldError('repId', 'هذا المندوب ليس صاحب الجهاز');
      branchId = actor.device.branchId;
      deviceId = actor.device.deviceId;
    } else {
      repId = input.repId ?? null;
      if (repId) {
        const [rep] = await tx.execute<{ id: string }>(
          sql`select id from sales_reps where id = ${repId} and status = 'active'`,
        );
        if (!rep) throw fieldError('repId', 'مندوب غير موجود');
      }
      branchId = input.warehouseBranchId;
      createdBy = actor.auth.userId;
    }

    const day = await today(tx, tenantId);
    const rules = await readDistributionSettings(tx);
    const number = await nextNumber(tx, tenantId, 'SO', day);
    const [made] = await tx
      .insert(salesOrders)
      .values({
        ...(input.id ? { id: input.id } : {}),
        tenantId,
        number,
        branchId,
        warehouseBranchId: input.warehouseBranchId,
        deviceId,
        repId,
        customerId: input.customerId,
        businessDate: day,
        status: 'open',
        currency: input.currency,
        totalMinor,
        lines,
        depositMinor: input.depositMinor,
        depositReceiptId: input.depositReceiptId,
        deliveryDate: input.deliveryDate,
        holdUntil: sql`now() + ${`${rules.orderHoldDays} days`}::interval`,
        note: input.note,
        createdBy,
      })
      .returning({ id: salesOrders.id });
    const id = made!.id;
    await audit(
      tx,
      {
        tenantId,
        userId: createdBy,
        actorType: actor.kind === 'device' ? 'device' : 'user',
        ...(deviceId ? { deviceId } : {}),
        action: 'sales_order.create',
        entity: 'sales_order',
        entityId: id,
        changes: { number: [null, number], totalMinor: [null, totalMinor] },
      },
      meta,
    );
    return readOrder(tx, id);
  });
}

// ─── Cancelling and dispatching ─────────────────────────────────────────────

/** The order as stored, still holding goods (open or partly delivered), at the version the screen saw */
async function openOrder(tx: Transaction, id: string, version: number) {
  const [row] = await tx
    .select({
      status: salesOrders.status,
      version: salesOrders.version,
      warehouseBranchId: salesOrders.warehouseBranchId,
    })
    .from(salesOrders)
    .where(eq(salesOrders.id, id))
    .for('update');
  if (!row) throw notFound();
  if (row.version !== version) throw staleVersion();
  if (row.status !== 'open' && row.status !== 'partial') {
    throw conflict('هذه الطلبية لم تعد مفتوحة.');
  }
  return row;
}

export function cancelSalesOrder(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: SalesOrderCancelInput,
  meta: RequestMeta,
): Promise<SalesOrderRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guardAdmin(tx, auth);
    const before = await openOrder(tx, id, input.version);
    await tx
      .update(salesOrders)
      .set({ status: 'cancelled', cancelReason: input.reason })
      .where(eq(salesOrders.id, id));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'sales_order.cancel',
        entity: 'sales_order',
        entityId: id,
        changes: { status: [before.status, 'cancelled'] },
        reason: input.reason,
      },
      meta,
    );
    return readOrder(tx, id);
  });
}

export function assignSalesOrder(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: SalesOrderAssignInput,
  meta: RequestMeta,
): Promise<SalesOrderRow> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guardAdmin(tx, auth);
    const before = await openOrder(tx, id, input.version);
    const [target] = await tx.execute<{ id: string }>(
      sql`select id from branches where id = ${input.warehouseBranchId} and is_active`,
    );
    if (!target) throw fieldError('warehouseBranchId', 'مكان التجهيز غير موجود');
    if (target.id !== before.warehouseBranchId) {
      await tx
        .update(salesOrders)
        .set({ warehouseBranchId: input.warehouseBranchId })
        .where(eq(salesOrders.id, id));
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'sales_order.assign',
          entity: 'sales_order',
          entityId: id,
          changes: { warehouseBranchId: [before.warehouseBranchId, input.warehouseBranchId] },
        },
        meta,
      );
    }
    return readOrder(tx, id);
  });
}

// ─── What the open orders promise ───────────────────────────────────────────

/** Per branch and item, what open orders still promise (never written to stock_levels.reserved_qty) */
async function committedOf(tx: Transaction, warehouseBranchId?: string): Promise<CommittedRow[]> {
  const rows = await tx.execute<{ warehouse_branch_id: string; variant_id: string; qty: string }>(sql`
    select o.warehouse_branch_id, (l ->> 'variantId')::uuid as variant_id,
           sum(greatest((l ->> 'qty')::bigint - coalesce((l ->> 'deliveredQty')::bigint, 0), 0))::text as qty
    from sales_orders o cross join lateral jsonb_array_elements(o.lines) l
    where o.status in ('open', 'partial') and (o.hold_until is null or o.hold_until >= now())
      ${warehouseBranchId ? sql`and o.warehouse_branch_id = ${warehouseBranchId}` : sql``}
    group by 1, 2
    having sum(greatest((l ->> 'qty')::bigint - coalesce((l ->> 'deliveredQty')::bigint, 0), 0)) > 0
    order by 1, 2`);
  return rows.map((r) => ({
    warehouseBranchId: r.warehouse_branch_id,
    variantId: r.variant_id,
    qty: Number(r.qty),
  }));
}

export function committedQuantities(
  db: Database,
  auth: AccessClaims,
  warehouseBranchId?: string,
): Promise<CommittedRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guardAdmin(tx, auth);
    return committedOf(tx, warehouseBranchId);
  });
}

/** The picking list of one branch: what to pull off its shelves for the orders it fills, beside what is there */
export function pickingList(db: Database, auth: AccessClaims, query: PickingListQuery): Promise<PickingList> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guardAdmin(tx, auth);
    const [branch] = await tx.execute<{ id: string; name: string }>(
      sql`select id, name from branches where id = ${query.warehouseBranchId}`,
    );
    if (!branch) throw fieldError('warehouseBranchId', 'مكان التجهيز غير موجود');
    const named = query.ids && query.ids.length > 0;
    const found = await tx.execute<Db>(sql`${select}
      where o.warehouse_branch_id = ${branch.id} and o.status in ('open', 'partial')
        ${named ? sql`and o.id = any(${uuidArray(query.ids!)})` : sql``}
      order by o.delivery_date nulls last, o.number`);
    const orders = await rowsOf(tx, found);
    const need = new Map<string, { name: string; sku: string | null; qty: number }>();
    for (const order of orders) {
      for (const l of order.lines) {
        const left = l.qty - l.deliveredQty;
        if (left <= 0) continue;
        const entry = need.get(l.variantId) ?? { name: l.name, sku: l.sku, qty: 0 };
        entry.qty += left;
        need.set(l.variantId, entry);
      }
    }
    const ids = [...need.keys()];
    const shelf =
      ids.length === 0
        ? []
        : await tx.execute<{ variant_id: string; qty: string }>(sql`
            select variant_id, qty::text from stock_levels
            where branch_id = ${branch.id} and variant_id = any(${uuidArray(ids)})`);
    const onHand = new Map(shelf.map((r) => [r.variant_id, Number(r.qty)]));
    return {
      warehouseBranchId: branch.id,
      warehouseName: branch.name,
      orders: orders
        .filter((o) => o.lines.some((l) => l.qty > l.deliveredQty))
        .map((o) => ({
          id: o.id,
          number: o.number,
          customerName: o.customerName,
          deliveryDate: o.deliveryDate,
        })),
      items: [...need.entries()]
        .map(([variantId, v]) => ({
          variantId,
          name: v.name,
          sku: v.sku,
          qty: v.qty,
          onHand: onHand.get(variantId) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    };
  });
}

// ─── The sale that delivers an order ────────────────────────────────────────

/**
 * Called by the sale's processor when the sale names an order (`salesOrderId`): what the sale carries
 * of each item counts as delivered, line by line in the order they were taken, never past what was
 * ordered. All delivered: the order is `delivered`; some: `partial`, and what is left stays open and
 * keeps being promised. Additive only: it never touches the sale, its posting or its stock, and an
 * order that is unknown, already closed, or another customer's is left alone.
 */
export async function deliverSalesOrder(
  tx: Transaction,
  tenantId: string,
  salesOrderId: string,
  sale: { customerId: string | null; lines: readonly { variantId: string; baseQty: number }[] },
): Promise<void> {
  const [order] = await tx
    .select({
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      lines: salesOrders.lines,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, salesOrderId)))
    .for('update');
  if (!order || (order.status !== 'open' && order.status !== 'partial')) return;
  if (order.customerId !== sale.customerId) return;

  const lines = (order.lines as SalesOrderLine[]).map((l) => ({ ...l, deliveredQty: l.deliveredQty ?? 0 }));
  const sold = new Map<string, number>();
  for (const l of sale.lines) sold.set(l.variantId, (sold.get(l.variantId) ?? 0) + l.baseQty);
  for (const line of lines) {
    const left = sold.get(line.variantId) ?? 0;
    if (left <= 0) continue;
    const take = Math.min(left, line.qty - line.deliveredQty);
    if (take <= 0) continue;
    line.deliveredQty += take;
    sold.set(line.variantId, left - take);
  }
  const all = lines.every((l) => l.deliveredQty >= l.qty);
  const any = lines.some((l) => l.deliveredQty > 0);
  await tx
    .update(salesOrders)
    .set({ lines, status: all ? 'delivered' : any ? 'partial' : order.status })
    .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, salesOrderId)));
}
