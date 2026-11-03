import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SaleLine, SerialRow } from '@serva/core';
import type { SyncFlag } from '@serva/sync';
import { products, serials, variants, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';

/**
 * Serial numbers and IMEIs (03 › الإلكترونيات والجوالات). A product that tracks them is received
 * with one number per piece, and each sale line names the pieces it sold; a number is in the store
 * once. A sale is never refused for a number: one never received is recorded and flagged
 * unknown_serial, one already sold by another sale is flagged serial_sold_twice.
 */

const invalid = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', fields);

/** The product of each variant: whether it tracks numbers, and its warranty. */
async function tracking(tx: Transaction, variantIds: readonly string[]) {
  if (variantIds.length === 0) return new Map<string, { tracks: boolean; warranty: number | null }>();
  const rows = await tx
    .select({ id: variants.id, tracks: products.tracksSerial, warranty: products.warrantyMonths })
    .from(variants)
    .innerJoin(products, and(eq(products.tenantId, variants.tenantId), eq(products.id, variants.productId)))
    .where(inArray(variants.id, [...new Set(variantIds)]));
  return new Map(rows.map((r) => [r.id, { tracks: r.tracks, warranty: r.warranty }]));
}

/** A purchase's numbers into stock; a tracked product needs one per piece, each new to the store. */
export async function receiveSerials(
  tx: Transaction,
  tenantId: string,
  purchaseId: string,
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
    if (products.get(line.variantId)?.tracks && given.length * 1000 !== line.qty) {
      throw invalid({
        [`lines.${i}.serials`]: `اكتب ${line.qty / 1000} رقماً تسلسلياً، واحداً لكل قطعة (كُتب ${given.length})`,
      });
    }
  }
  if (all.length === 0) return;
  const known = await tx.select({ serial: serials.serial }).from(serials).where(inArray(serials.serial, all));
  if (known.length > 0) throw invalid({ lines: `الرقم ${known[0]!.serial} موجود في المحل من قبل` });
  await tx.insert(serials).values(
    lines.flatMap((l) =>
      (l.serials ?? []).map((serial) => ({
        tenantId,
        variantId: l.variantId,
        serial,
        status: 'in_stock',
        purchaseId,
      })),
    ),
  );
}

/** The day a warranty of `months` from `date` ends: «2026-10-30» + 12 → «2027-10-30». */
const plusMonths = (date: string, months: number) =>
  sql`(${date}::date + make_interval(months => ${months}))::date`;

/** A sale's numbers out of stock, with their warranty; flags what does not add up. */
export async function sellSerials(
  tx: Transaction,
  tenantId: string,
  saleId: string,
  date: string,
  lines: readonly SaleLine[],
): Promise<SyncFlag[]> {
  const sold = lines.filter((l) => l.serials?.length);
  if (sold.length === 0) return [];
  const products = await tracking(
    tx,
    sold.map((l) => l.variantId),
  );
  const flags = new Set<SyncFlag>();
  for (const line of sold) {
    const months = products.get(line.variantId)?.warranty ?? null;
    const until = months ? plusMonths(date, months) : sql`null::date`;
    for (const serial of line.serials!) {
      const [row] = await tx
        .select({ id: serials.id, status: serials.status, saleId: serials.saleId })
        .from(serials)
        .where(eq(serials.serial, serial));
      if (!row) {
        flags.add('unknown_serial');
        await tx.execute(sql`
          insert into serials (tenant_id, variant_id, serial, status, sale_id, sold_on, warranty_until)
          values (${tenantId}, ${line.variantId}, ${serial}, 'sold', ${saleId}, ${date}, ${until})`);
      } else if (row.status === 'in_stock') {
        await tx.execute(sql`
          update serials set status = 'sold', sale_id = ${saleId}, sold_on = ${date}, warranty_until = ${until}
          where id = ${row.id}`);
      } else if (row.saleId !== saleId) {
        flags.add('serial_sold_twice');
      }
    }
  }
  return [...flags];
}

/** Pieces a return brought back whole are in stock again (a part of a line keeps its numbers). */
export async function returnSerials(
  tx: Transaction,
  saleId: string,
  returned: readonly { saleLineNo: number; qty: number }[],
  saleLines: readonly SaleLine[] | null,
): Promise<void> {
  if (!saleLines) return;
  for (const r of returned) {
    const line = saleLines.find((l) => l.lineNo === r.saleLineNo);
    if (!line?.serials?.length || r.qty < line.qty) continue;
    await tx.execute(sql`
      update serials set status = 'in_stock', sale_id = null, sold_on = null, warranty_until = null
      where sale_id = ${saleId} and serial in (${sql.join(
        line.serials.map((serial) => sql`${serial}`),
        sql`, `,
      )})`);
  }
}

export function lookupSerials(
  db: Database,
  auth: AccessClaims,
  q: string | undefined,
): Promise<{ items: SerialRow[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const typed = (q ?? '').replace(/\s+/g, '').toUpperCase();
    const rows = await tx.execute<{
      serial: string;
      variant_id: string;
      name: string;
      status: 'in_stock' | 'sold';
      purchase_number: string | null;
      received_on: string | null;
      sale_number: string | null;
      sold_on: string | null;
      warranty_until: string | null;
    }>(sql`
      select s.serial, s.variant_id, p.name_ar || coalesce(' ' || v.label, '') as name, s.status,
             pu.number as purchase_number, pu.business_date::text as received_on,
             i.number as sale_number, s.sold_on::text as sold_on, s.warranty_until::text as warranty_until
      from serials s
      join variants v on v.tenant_id = s.tenant_id and v.id = s.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join purchases pu on pu.tenant_id = s.tenant_id and pu.id = s.purchase_id
      left join invoices i on i.tenant_id = s.tenant_id and i.id = s.sale_id
      where ${typed ? sql`s.serial like ${`%${typed}%`}` : sql`true`}
      order by s.created_at desc, s.serial
      limit 100`);
    return {
      items: rows.map((r) => ({
        serial: r.serial,
        variantId: r.variant_id,
        name: r.name,
        status: r.status,
        purchaseNumber: r.purchase_number,
        receivedOn: r.received_on,
        saleNumber: r.sale_number,
        soldOn: r.sold_on,
        warrantyUntil: r.warranty_until,
      })),
    };
  });
}
