import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SerialFlag, SerialRow } from '@serva/core';
import { toLatinDigits } from '@serva/core';
import {
  products,
  purchaseReversals,
  serials,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';

/**
 * Serial numbers and IMEIs (03 › الإلكترونيات والجوالات). A product that tracks them is received
 * with one number per piece, and each sale line names the pieces it sold; a number is in the store
 * once. A sale is never refused for a number: one never received is recorded and flagged
 * unknown_serial, one already sold by another sale is flagged serial_sold_twice.
 */

export const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/** The product of each variant: whether it tracks numbers, and its warranty. */
export async function tracking(tx: Transaction, variantIds: readonly string[]) {
  if (variantIds.length === 0) return new Map<string, { tracks: boolean; warranty: number | null }>();
  const rows = await tx
    .select({ id: variants.id, tracks: products.tracksSerial, warranty: products.warrantyMonths })
    .from(variants)
    .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
    .where(inArray(variants.id, [...new Set(variantIds)]));
  return new Map(rows.map((r) => [r.id, { tracks: r.tracks, warranty: r.warranty }]));
}

/** A serial as it is stored: Latin digits, no spaces, upper case. */
export const normalized = (serial: string) => toLatinDigits(serial).replace(/\s+/g, '').toUpperCase();

/** A purchase's numbers into stock; a tracked product needs one per piece, each new to the store. */
export async function receiveSerials(
  tx: Transaction,
  tenantId: string,
  purchaseId: string,
  branchId: string,
  lines: readonly { variantId: string; qty: number; serials?: string[] | undefined }[],
): Promise<void> {
  const products = await tracking(
    tx,
    lines.map((l) => l.variantId),
  );
  const all = lines.flatMap((l) => l.serials ?? []);
  if (new Set(all).size !== all.length) throw invalid({ lines: 'رقم تسلسلي مكرر في الفاتورة' });
  for (const [i, line] of lines.entries()) {
    const given = line.serials ?? [];
    if (products.get(line.variantId)?.tracks && line.qty % 1000 !== 0) {
      throw invalid({ [`lines.${i}.serials`]: 'الأجهزة تُباع بالقطعة الكاملة، لا بكمية كسرية' });
    }
    if (products.get(line.variantId)?.tracks && given.length * 1000 !== line.qty) {
      throw invalid({
        [`lines.${i}.serials`]: `اكتب ${line.qty / 1000} رقماً تسلسلياً، واحداً لكل قطعة (كُتب ${given.length})`,
      });
    }
  }
  if (all.length === 0) return;
  const known = await tx
    .select({
      id: serials.id,
      serial: serials.serial,
      variantId: serials.variantId,
      purchaseId: serials.purchaseId,
      status: serials.status,
    })
    .from(serials)
    .where(inArray(serials.serial, all));
  // A number a till sold before it was entered here (a manager's override) is adopted by this purchase.
  // So is one that came on an invoice since corrected (round 36, decision 12): its pieces went back out
  // with the correction, and the corrected invoice brings them in again.
  const corrected = new Set(
    known.some((k) => k.status === 'returned' && k.purchaseId)
      ? (
          await tx
            .select({ purchaseId: purchaseReversals.purchaseId })
            .from(purchaseReversals)
            .where(
              inArray(
                purchaseReversals.purchaseId,
                known.flatMap((k) => (k.purchaseId ? [k.purchaseId] : [])),
              ),
            )
        ).map((r) => r.purchaseId)
      : [],
  );
  const adoptable = new Map(
    known
      .filter(
        (k) =>
          (k.purchaseId === null && k.status === 'sold') ||
          (k.status === 'returned' && k.purchaseId !== null && corrected.has(k.purchaseId)),
      )
      .map((k) => [k.serial, k] as const),
  );
  const wanted = new Map(
    lines.flatMap((l) => (l.serials ?? []).map((serial) => [serial, l.variantId] as const)),
  );
  const clash = known.find((k) => !adoptable.has(k.serial) || wanted.get(k.serial) !== k.variantId);
  if (clash) throw invalid({ lines: `الرقم ${clash.serial} موجود في المحل من قبل` });
  for (const k of adoptable.values()) {
    await tx
      .update(serials)
      .set({ purchaseId, branchId, ...(k.status === 'returned' ? { status: 'in_stock' } : {}) })
      .where(eq(serials.id, k.id));
  }
  const fresh = lines.flatMap((l) =>
    (l.serials ?? [])
      .filter((serial) => !adoptable.has(serial))
      .map((serial) => ({
        tenantId,
        variantId: l.variantId,
        serial,
        status: 'in_stock',
        purchaseId,
        branchId,
      })),
  );
  if (fresh.length > 0) await tx.insert(serials).values(fresh);
}

export function lookupSerials(
  db: Database,
  auth: AccessClaims,
  query: {
    q?: string | undefined;
    saleId?: string | undefined;
    customerId?: string | undefined;
    flagged?: string | undefined;
    variantId?: string | undefined;
  },
): Promise<{ items: SerialRow[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const typed = normalized(query.q ?? '');
    const rows = await tx.execute<{
      serial: string;
      variant_id: string;
      name: string;
      status: 'in_stock' | 'sold' | 'rented';
      purchase_number: string | null;
      received_on: string | null;
      sale_id: string | null;
      sale_number: string | null;
      sold_on: string | null;
      warranty_until: string | null;
      customer_name: string | null;
    }>(sql`
      select s.serial, s.variant_id, p.name_ar || coalesce(' ' || v.label, '') as name, s.status,
             pu.number as purchase_number, pu.business_date::text as received_on, s.sale_id,
             i.number as sale_number, s.sold_on::text as sold_on, s.warranty_until::text as warranty_until,
             coalesce(i.customer_name, c.name) as customer_name
      from serials s
      join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join purchases pu on pu.tenant_id = s.tenant_id and pu.id = s.purchase_id
      left join invoices i on i.tenant_id = s.tenant_id and i.id = s.sale_id
      left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
      where ${typed ? sql`s.serial like ${`%${typed.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : sql`true`}
        and ${query.saleId ? sql`exists (select 1 from serial_sales ss where ss.tenant_id = s.tenant_id and ss.serial = s.serial and ss.sale_id = ${query.saleId})` : sql`true`}
        and ${query.customerId ? sql`i.customer_id = ${query.customerId}` : sql`true`}
        and ${query.variantId ? sql`s.variant_id = ${query.variantId}` : sql`true`}
        and ${query.flagged ? sql`exists (select 1 from serial_sales ss where ss.tenant_id = s.tenant_id and ss.serial = s.serial and ss.flag is not null)` : sql`true`}
      order by s.created_at desc, s.serial
      limit 100`);
    const history = rows.length
      ? await tx.execute<{
          serial: string;
          sale_id: string | null;
          sale_number: string | null;
          sold_on: string;
          flag: SerialFlag | null;
          customer_name: string | null;
        }>(sql`
          select ss.serial, ss.sale_id, i.number as sale_number, ss.sold_on::text as sold_on, ss.flag,
                 coalesce(i.customer_name, c.name) as customer_name
          from serial_sales ss
          left join invoices i on i.tenant_id = ss.tenant_id and i.id = ss.sale_id
          left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
          where ss.serial in (${sql.join(
            rows.map((r) => sql`${r.serial}`),
            sql`, `,
          )})
          order by ss.sold_on desc, ss.created_at desc`)
      : [];
    return {
      items: rows.map((r) => {
        const sales = history
          .filter((h) => h.serial === r.serial)
          .map((h) => ({
            saleId: h.sale_id,
            saleNumber: h.sale_number,
            soldOn: h.sold_on,
            flag: h.flag,
            customerName: h.customer_name,
          }));
        return {
          serial: r.serial,
          variantId: r.variant_id,
          name: r.name,
          status: r.status,
          purchaseNumber: r.purchase_number,
          receivedOn: r.received_on,
          saleNumber: r.sale_number,
          soldOn: r.sold_on,
          warrantyUntil: r.warranty_until,
          flags: [...new Set(sales.flatMap((h) => (h.flag ? [h.flag] : [])))],
          sales,
          customerName: r.customer_name,
          saleId: r.sale_id,
        };
      }),
    };
  });
}

/**
 * The pieces a document sends out of `branchId` (a transfer, or a return to the supplier): a
 * product that tracks serial numbers needs one per piece, each in stock in that branch under that
 * product. Returns the rows' ids; nothing is changed yet.
 */
export async function outgoingSerials(
  tx: Transaction,
  branchId: string,
  lines: readonly { variantId: string; qty: number; serials?: string[] | undefined }[],
): Promise<string[]> {
  const tracked = await tracking(
    tx,
    lines.map((l) => l.variantId),
  );
  const wanted: { serial: string; variantId: string; field: string }[] = [];
  for (const [i, line] of lines.entries()) {
    const given = (line.serials ?? []).map(normalized);
    const field = `lines.${i}.serials`;
    if (tracked.get(line.variantId)?.tracks) {
      if (given.length * 1000 !== line.qty) {
        throw invalid({
          [field]: `اكتب ${line.qty / 1000} رقماً تسلسلياً، واحداً لكل قطعة (كُتب ${given.length})`,
        });
      }
    } else if (given.length > 0) {
      throw invalid({ [field]: 'هذا الصنف لا يُباع بأرقام تسلسلية' });
    }
    for (const serial of given) wanted.push({ serial, variantId: line.variantId, field });
  }
  if (wanted.length === 0) return [];
  if (new Set(wanted.map((w) => w.serial)).size !== wanted.length) {
    throw invalid({ lines: 'رقم تسلسلي مكرر في المستند' });
  }
  const rows = await tx
    .select({
      id: serials.id,
      serial: serials.serial,
      variantId: serials.variantId,
      status: serials.status,
      branchId: serials.branchId,
    })
    .from(serials)
    .where(
      inArray(
        serials.serial,
        wanted.map((w) => w.serial),
      ),
    );
  const bySerial = new Map(rows.map((r) => [r.serial, r]));
  return wanted.map((w) => {
    const row = bySerial.get(w.serial);
    if (
      !row ||
      row.status !== 'in_stock' ||
      row.variantId !== w.variantId ||
      (row.branchId && row.branchId !== branchId)
    ) {
      throw invalid({ [w.field]: `الرقم ${w.serial} ليس في مخزون هذا الفرع لهذا الصنف` });
    }
    return row.id;
  });
}

/** Pieces sent to another branch are in its stock now */
export async function relocateSerials(
  tx: Transaction,
  ids: readonly string[],
  branchId: string,
): Promise<void> {
  if (ids.length > 0)
    await tx
      .update(serials)
      .set({ branchId })
      .where(inArray(serials.id, [...ids]));
}

/** Pieces sent back to the supplier are out of the store's stock, sold to nobody */
export async function returnSerialsToSupplier(tx: Transaction, ids: readonly string[]): Promise<void> {
  if (ids.length > 0)
    await tx
      .update(serials)
      .set({ status: 'returned' })
      .where(inArray(serials.id, [...ids]));
}

/** The numbers in stock in a branch for a product: what a count picks the missing pieces from (inventory.adjust) */
export function stockSerials(
  db: Database,
  auth: AccessClaims,
  query: { variantId: string; branchId: string; q?: string | undefined },
): Promise<{ items: string[]; truncated: boolean }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'inventory.adjust', query.branchId);
    const [known] = await tx
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.id, query.variantId));
    if (!known) throw new AppError(404, 'not_found', 'هذا الصنف غير موجود.');
    // Part of a number (a like pattern with its wildcards escaped by splitting, no pattern is built from the text)
    const typed = normalized(query.q ?? '');
    const bs = String.fromCharCode(92);
    const piece = typed
      .split(bs)
      .join(bs + bs)
      .split('%')
      .join(bs + '%')
      .split('_')
      .join(bs + '_');
    const rows = await tx
      .select({ serial: serials.serial })
      .from(serials)
      .where(
        and(
          eq(serials.variantId, query.variantId),
          eq(serials.status, 'in_stock'),
          sql`(${serials.branchId} is null or ${serials.branchId} = ${query.branchId})`,
          typed ? sql`${serials.serial} like ${`%${piece}%`}` : undefined,
        ),
      )
      .orderBy(serials.serial)
      .limit(1001);
    return { items: rows.slice(0, 1000).map((r) => r.serial), truncated: rows.length > 1000 };
  });
}
