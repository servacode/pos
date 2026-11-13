import { sql, type SQL } from 'drizzle-orm';
import type {
  CurrencyCode,
  PaymentMethod,
  SaleDetail,
  SaleListItem,
  SaleListPage,
  SalePayload,
  SaleStatus,
  saleListQuery,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import { forbidden, inScope, permissionScope } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';

/**
 * The store-wide invoice list and one invoice with all its receipt needs (packages/core ›
 * contracts/sales.ts). Read from what the sale documents stored; nothing here writes. Like the
 * day report it needs `report.view`, in the branch asked or in the branches the role holds it.
 */

const PERMISSION = 'report.view' as const;
const num = (value: unknown) => Number(value ?? 0);
const notFound = () => new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');

interface Scope {
  /** null: every branch of the store */
  ids: string[] | null;
}

async function scopeOf(tx: Transaction, auth: AccessClaims, branchId: string | undefined): Promise<Scope> {
  const scope = await permissionScope(tx, auth.userId, PERMISSION);
  if (branchId) {
    if (!inScope(scope, branchId)) throw forbidden();
    const [branch] = await tx.execute<{ id: string }>(sql`select id from branches where id = ${branchId}`);
    if (!branch) throw new AppError(404, 'not_found', 'هذا الفرع غير موجود.');
    return { ids: [branchId] };
  }
  if (scope.all) return { ids: null };
  if (scope.branchIds.size === 0) throw forbidden();
  return { ids: [...scope.branchIds] };
}

const inScopeSql = (column: SQL, scope: Scope): SQL =>
  scope.ids === null
    ? sql`true`
    : sql`${column} in (${sql.join(
        scope.ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;

/** Pages are keyed on what the list is ordered by: (business date, device time, id), newest first. */
interface Cursor {
  date: string;
  time: string;
  id: string;
}

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.date, c.time, c.id])).toString('base64url');

function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  const invalid = () =>
    new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { cursor: 'مؤشر غير صالح' });
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parts) || parts.length !== 3 || parts.some((p) => typeof p !== 'string'))
    throw invalid();
  const [date, time, id] = parts as string[];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date!) ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00$/.test(time!) ||
    !/^[0-9a-f-]{36}$/i.test(id!)
  )
    throw invalid();
  return { date: date!, time: time!, id: id! };
}

/** Escapes % _ \ so a typed search is matched as text. */
const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Row = {
  id: string;
  number: string;
  branch_id: string;
  branch_name: string;
  device_id: string;
  device_code: string | null;
  business_date: string;
  device_time: string;
  device_time_text: string;
  cashier_id: string;
  cashier_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  currency: string;
  total: string;
  discount: string;
  tax: string;
  methods: string[] | null;
  returned: string;
  sold_qty: string;
  back_qty: string;
};

/** The invoice with its branch, device, cashier, payment methods and how much has come back. */
const SELECT = sql`
  select i.id, i.number, i.branch_id, b.name as branch_name, i.device_id, d.code as device_code,
         i.business_date::text as business_date, i.device_time as device_time,
         to_char(i.device_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00' as device_time_text,
         i.cashier_id, u.full_name as cashier_name, i.customer_id, i.customer_name, i.currency,
         i.total_minor::text as total, i.discount_minor::text as discount, i.tax_minor::text as tax,
         (select array_agg(distinct p.method order by p.method) from invoice_payments p
           where p.tenant_id = i.tenant_id and p.invoice_id = i.id) as methods,
         coalesce((select sum(r.total_minor) from sale_returns r
           where r.tenant_id = i.tenant_id and r.sale_id = i.id), 0)::text as returned,
         coalesce((select sum(l.base_qty) from invoice_lines l
           where l.tenant_id = i.tenant_id and l.invoice_id = i.id), 0)::text as sold_qty,
         coalesce((select sum(rl.base_qty) from sale_return_lines rl
           join sale_returns r on r.tenant_id = rl.tenant_id and r.id = rl.return_id
           where r.tenant_id = i.tenant_id and r.sale_id = i.id), 0)::text as back_qty
  from invoices i
  join branches b on b.tenant_id = i.tenant_id and b.id = i.branch_id
  left join devices d on d.tenant_id = i.tenant_id and d.id = i.device_id
  left join users u on u.id = i.cashier_id`;

function statusOf(row: Pick<Row, 'sold_qty' | 'back_qty'>): SaleStatus {
  const back = num(row.back_qty);
  if (back <= 0) return 'paid';
  return back >= num(row.sold_qty) ? 'returned' : 'partly_returned';
}

function itemOf(row: Row): SaleListItem {
  return {
    id: row.id,
    number: row.number,
    branchId: row.branch_id,
    branchName: row.branch_name,
    deviceId: row.device_id,
    deviceCode: row.device_code,
    businessDate: row.business_date,
    deviceTime: new Date(row.device_time).toISOString(),
    cashier: { id: row.cashier_id, fullName: row.cashier_name },
    customer: row.customer_name ? { id: row.customer_id, name: row.customer_name } : null,
    currency: row.currency as CurrencyCode,
    totalMinor: num(row.total),
    discountMinor: num(row.discount),
    taxMinor: num(row.tax),
    methods: (row.methods ?? []) as PaymentMethod[],
    returnedMinor: num(row.returned),
    status: statusOf(row),
  };
}

export function listSales(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof saleListQuery>,
): Promise<SaleListPage> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await scopeOf(tx, auth, query.branchId);
    const after = decodeCursor(query.cursor);
    const where: SQL[] = [inScopeSql(sql`i.branch_id`, scope)];
    if (query.from) where.push(sql`i.business_date >= ${query.from}`);
    if (query.to) where.push(sql`i.business_date <= ${query.to}`);
    if (query.deviceId) where.push(sql`i.device_id = ${query.deviceId}`);
    if (query.cashierId) where.push(sql`i.cashier_id = ${query.cashierId}`);
    if (query.customerId) where.push(sql`i.customer_id = ${query.customerId}`);
    if (query.minTotal !== undefined) where.push(sql`i.total_minor >= ${query.minTotal}`);
    if (query.maxTotal !== undefined) where.push(sql`i.total_minor <= ${query.maxTotal}`);
    if (query.method)
      where.push(sql`exists (select 1 from invoice_payments p where p.tenant_id = i.tenant_id
        and p.invoice_id = i.id and p.method = ${query.method})`);
    if (query.q) {
      const pattern = likeOf(query.q);
      where.push(sql`(i.number ilike ${pattern} or i.customer_name ilike ${pattern})`);
    }
    if (after)
      where.push(
        sql`(i.business_date, i.device_time, i.id) < (${after.date}::date, ${after.time}::timestamptz, ${after.id}::uuid)`,
      );
    const status =
      query.status === 'paid'
        ? sql`where back_qty::bigint = 0`
        : query.status === 'returned'
          ? sql`where back_qty::bigint > 0 and back_qty::bigint >= sold_qty::bigint`
          : query.status === 'partly_returned'
            ? sql`where back_qty::bigint > 0 and back_qty::bigint < sold_qty::bigint`
            : sql``;
    const rows = await tx.execute<Row>(sql`
      select * from (${SELECT} where ${sql.join(where, sql` and `)}) s
      ${status}
      order by business_date desc, device_time desc, id desc
      limit ${query.limit + 1}`);
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(itemOf),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ date: last.business_date, time: last.device_time_text, id: last.id })
          : null,
    };
  });
}

export function getSale(db: Database, auth: AccessClaims, id: string): Promise<SaleDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await scopeOf(tx, auth, undefined);
    const [row] = await tx.execute<
      Row & {
        payload: SalePayload;
        salesperson_id: string | null;
        salesperson_name: string | null;
        device_id: string;
        device_name: string | null;
        flags: string[];
        branch_address: string | null;
        branch_phone: string | null;
        footer: string | null;
        tax_number: string | null;
        store_name: string;
      }
    >(sql`
      select s.*, i.payload, i.salesperson_id, sp.full_name as salesperson_name,
             d.name as device_name, i.flags, b.address as branch_address, b.phone as branch_phone,
             (select receipt_footer from tenant_settings limit 1) as footer,
             t.tax_number, t.name as store_name
      from (${SELECT} where i.id = ${id} and ${inScopeSql(sql`i.branch_id`, scope)}) s
      join invoices i on i.id = s.id
      join branches b on b.id = s.branch_id
      join tenants t on t.id = i.tenant_id
      left join devices d on d.id = i.device_id
      left join users sp on sp.id = i.salesperson_id`);
    if (!row) throw notFound();
    const returns = await tx.execute<{
      id: string;
      number: string;
      business_date: string;
      device_time: string;
      total: string;
      reason: string;
      refund_method: string | null;
    }>(sql`
      select id, number, business_date::text as business_date, device_time, total_minor::text as total,
             reason, refund_method
      from sale_returns where sale_id = ${id}
      order by business_date, device_time, id`);
    return {
      ...itemOf(row),
      payload: row.payload,
      salesperson: row.salesperson_id ? { id: row.salesperson_id, fullName: row.salesperson_name } : null,
      device: { id: row.device_id, name: row.device_name ?? '', code: row.device_code },
      flags: row.flags,
      returns: returns.map((r) => ({
        id: r.id,
        number: r.number,
        businessDate: r.business_date,
        deviceTime: new Date(r.device_time).toISOString(),
        totalMinor: num(r.total),
        reason: r.reason,
        refundMethod: r.refund_method,
      })),
      receipt: {
        storeName: row.store_name,
        taxNumber: row.tax_number,
        receiptFooter: row.footer,
        branchName: row.branch_name,
        branchAddress: row.branch_address,
        branchPhone: row.branch_phone,
        deviceName: row.device_name ?? row.device_code ?? '',
        cashierName: row.cashier_name ?? '',
      },
    };
  });
}
