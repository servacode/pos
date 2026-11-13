import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  WARRANTY_NEXT,
  type WarrantyClaim,
  type WarrantyEvent,
  type WarrantyLookup,
  type WarrantyStatus,
  type warrantyClaimInput,
  type warrantyStatusInput,
} from '@serva/core';
import { warrantyClaims, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';

/**
 * Warranty and maintenance claims (03 › الإلكترونيات والأدوات الطبية): a sold piece found by its
 * serial number or IMEI, a claim numbered per store, followed received → sent → ready → delivered.
 * It posts nothing and touches neither stock nor the serial row.
 */

const OPEN = ['received', 'sent', 'ready'];

const notFound = () => new AppError(404, 'not_found', 'هذه المطالبة غير موجودة.');
const stale = () => new AppError(409, 'stale_version', 'غيّر شخص آخر هذه المطالبة للتو. حدّث القائمة.');
const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

const claimOf = (r: typeof warrantyClaims.$inferSelect): WarrantyClaim => ({
  id: r.id,
  number: r.number,
  status: r.status as WarrantyStatus,
  serial: r.serial,
  item: r.item,
  saleNumber: r.saleNumber,
  soldOn: r.soldOn,
  warrantyUntil: r.warrantyUntil,
  underWarranty: r.underWarranty,
  customerName: r.customerName,
  customerPhone: r.customerPhone,
  issue: r.issue,
  sentTo: r.sentTo,
  events: r.events as WarrantyEvent[],
  createdAt: r.createdAt.toISOString(),
  version: r.version,
});

/** Today in the store's own time zone, as «2026-11-13» */
async function today(tx: Transaction, tenantId: string): Promise<string> {
  const [row] = await tx.execute<{ day: string }>(
    sql`select (now() at time zone t.timezone)::date::text as day from tenants t where t.id = ${tenantId}`,
  );
  return row!.day;
}

interface FoundSerial {
  serial: string;
  variantId: string;
  item: string;
  status: string;
  saleId: string | null;
  saleNumber: string | null;
  soldOn: string | null;
  warrantyUntil: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

async function findSerial(tx: Transaction, raw: string): Promise<FoundSerial | null> {
  const typed = raw.replace(/\s+/g, '').toUpperCase();
  const [row] = await tx.execute<{
    serial: string;
    variant_id: string;
    item: string;
    status: string;
    sale_id: string | null;
    sale_number: string | null;
    sold_on: string | null;
    warranty_until: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  }>(sql`
    select s.serial, s.variant_id, p.name_ar || coalesce(' ' || v.label, '') as item, s.status,
           s.sale_id, i.number as sale_number, s.sold_on::text as sold_on,
           s.warranty_until::text as warranty_until,
           coalesce(i.customer_name, c.name) as customer_name, c.phone as customer_phone
    from serials s
    join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
    join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    left join invoices i on i.tenant_id = s.tenant_id and i.id = s.sale_id
    left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
    where s.serial = ${typed}`);
  if (!row) return null;
  return {
    serial: row.serial,
    variantId: row.variant_id,
    item: row.item,
    status: row.status,
    saleId: row.sale_id,
    saleNumber: row.sale_number,
    soldOn: row.sold_on,
    warrantyUntil: row.warranty_until,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
  };
}

async function claimsOfSerial(tx: Transaction, serial: string): Promise<WarrantyClaim[]> {
  const rows = await tx
    .select()
    .from(warrantyClaims)
    .where(eq(warrantyClaims.serial, serial))
    .orderBy(sql`${warrantyClaims.seq} desc`);
  return rows.map(claimOf);
}

/** A serial's sale, customer and warranty end, with the claims already opened on it */
export function lookupWarranty(db: Database, auth: AccessClaims, serial: string): Promise<WarrantyLookup> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const found = await findSerial(tx, serial);
    if (!found) throw new AppError(404, 'not_found', 'هذا الرقم التسلسلي غير موجود في المحل.');
    if (found.status !== 'sold' || !found.saleNumber || !found.soldOn) {
      throw new AppError(404, 'not_found', 'هذه القطعة لم تُبَع بعد، فلا ضمان لها.');
    }
    const day = await today(tx, auth.tenantId);
    return {
      serial: found.serial,
      item: found.item,
      saleNumber: found.saleNumber,
      soldOn: found.soldOn,
      warrantyUntil: found.warrantyUntil,
      underWarranty: found.warrantyUntil !== null && found.warrantyUntil >= day,
      customerName: found.customerName,
      customerPhone: found.customerPhone,
      claims: await claimsOfSerial(tx, found.serial),
    };
  });
}

export function createWarrantyClaim(
  db: Database,
  auth: AccessClaims,
  input: z.output<typeof warrantyClaimInput>,
): Promise<WarrantyClaim> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const found = await findSerial(tx, input.serial);
    if (!found) throw invalid({ serial: 'هذا الرقم غير موجود في المحل' });
    if (found.status !== 'sold') throw invalid({ serial: 'هذه القطعة لم تُبَع بعد' });
    const [open] = await tx
      .select({ number: warrantyClaims.number })
      .from(warrantyClaims)
      .where(and(eq(warrantyClaims.serial, found.serial), inArray(warrantyClaims.status, OPEN)));
    if (open) {
      throw new AppError(409, 'conflict', 'هذه القطعة عليها مطالبة مفتوحة.', {
        serial: `المطالبة ${open.number} ما زالت مفتوحة`,
      });
    }
    // Numbers follow each other within a store; the lock keeps two screens off the same one
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('warranty_claims'), hashtext(${auth.tenantId}))`,
    );
    const [last] = await tx.execute<{ seq: number | null }>(
      sql`select max(seq) as seq from warranty_claims where tenant_id = ${auth.tenantId}`,
    );
    const seq = (last?.seq ?? 0) + 1;
    const on = input.receivedOn ?? (await today(tx, auth.tenantId));
    const [made] = await tx
      .insert(warrantyClaims)
      .values({
        tenantId: auth.tenantId,
        seq,
        number: `WC-${String(seq).padStart(6, '0')}`,
        serial: found.serial,
        variantId: found.variantId,
        item: found.item,
        saleId: found.saleId,
        saleNumber: found.saleNumber,
        soldOn: found.soldOn,
        warrantyUntil: found.warrantyUntil,
        underWarranty: found.warrantyUntil !== null && found.warrantyUntil >= on,
        customerName: found.customerName,
        customerPhone: found.customerPhone,
        issue: input.issue,
        events: [{ status: 'received', on, note: input.note || null }],
        createdBy: auth.userId,
      })
      .returning();
    return claimOf(made!);
  });
}

/** Open claims (not yet delivered), the oldest first; or the latest 200 */
export function listWarrantyClaims(
  db: Database,
  auth: AccessClaims,
  status: 'open' | 'all',
): Promise<{ items: WarrantyClaim[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const rows = await tx
      .select()
      .from(warrantyClaims)
      .where(status === 'open' ? inArray(warrantyClaims.status, OPEN) : undefined)
      .orderBy(status === 'open' ? sql`${warrantyClaims.seq} asc` : sql`${warrantyClaims.seq} desc`)
      .limit(200);
    return { items: rows.map(claimOf) };
  });
}

export function setWarrantyStatus(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof warrantyStatusInput>,
): Promise<WarrantyClaim> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const [row] = await tx.select().from(warrantyClaims).where(eq(warrantyClaims.id, id));
    if (!row) throw notFound();
    if (row.version !== input.version) throw stale();
    if (!WARRANTY_NEXT[row.status as WarrantyStatus].includes(input.status)) {
      throw invalid({ status: 'لا يمكن نقل المطالبة إلى هذه الحالة.' });
    }
    const on = input.on ?? (await today(tx, auth.tenantId));
    const events = row.events as WarrantyEvent[];
    const before = events[events.length - 1];
    if (before && on < before.on) throw invalid({ on: 'التاريخ قبل الخطوة السابقة' });
    const [done] = await tx
      .update(warrantyClaims)
      .set({
        status: input.status,
        sentTo: input.status === 'sent' ? (input.sentTo ?? null) : row.sentTo,
        events: [...events, { status: input.status, on, note: input.note || null }],
        updatedAt: sql`now()`,
      })
      .where(and(eq(warrantyClaims.id, id), eq(warrantyClaims.version, input.version)))
      .returning();
    if (!done) throw stale();
    return claimOf(done);
  });
}
