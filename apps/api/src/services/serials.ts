import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SaleLine, SerialFixInput, SerialFlag, SerialRow, UnassignedSerialSale } from '@serva/core';
import { addMonthsIso } from '@serva/core';
import type { SyncFlag } from '@serva/sync';
import { products, serials, variants, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import { audit } from './audit';
import type { RequestMeta } from '../types';
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
  // A number a till sold before it was entered here (a manager's override) is adopted by this purchase
  const adoptable = new Map(
    known.filter((k) => k.purchaseId === null && k.status === 'sold').map((k) => [k.serial, k] as const),
  );
  const wanted = new Map(
    lines.flatMap((l) => (l.serials ?? []).map((serial) => [serial, l.variantId] as const)),
  );
  const clash = known.find((k) => !adoptable.has(k.serial) || wanted.get(k.serial) !== k.variantId);
  if (clash) throw invalid({ lines: `الرقم ${clash.serial} موجود في المحل من قبل` });
  for (const k of adoptable.values()) {
    await tx.update(serials).set({ purchaseId, branchId }).where(eq(serials.id, k.id));
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

/** A sale's numbers out of stock, with their warranty; flags what does not add up. */
export async function sellSerials(
  tx: Transaction,
  tenantId: string,
  branchId: string,
  saleId: string,
  date: string,
  lines: readonly SaleLine[],
): Promise<SyncFlag[]> {
  const sold = lines.filter((l) => l.serials?.length);
  const flags = new Set<SyncFlag>();
  // An offline sale is never refused: a serial-tracked line with fewer numbers than pieces is
  // accepted and flagged serial_missing, for the owner to pick which piece left («بيعات بلا رقم»)
  const tracked = await tracking(
    tx,
    lines.map((l) => l.variantId),
  );
  for (const l of lines) {
    if (tracked.get(l.variantId)?.tracks && (l.serials?.length ?? 0) < Math.round(l.baseQty / 1000)) {
      flags.add('serial_missing');
    }
  }
  if (sold.length === 0) return [...flags];
  const products = tracked;
  const seen = new Set<string>();
  /** Every sale of a number stays in the history, whatever the row says */
  const remember = (serial: string, variantId: string, flag: SerialFlag | null) =>
    tx.execute(sql`
      insert into serial_sales (tenant_id, serial, variant_id, sale_id, sold_on, flag)
      values (${tenantId}, ${serial}, ${variantId}, ${saleId}, ${date}, ${flag})
      on conflict (tenant_id, serial, sale_id) do nothing`);
  for (const line of sold) {
    const months = products.get(line.variantId)?.warranty ?? null;
    const until = months ? addMonthsIso(date, months) : null;
    const overrides = new Set((line.serialOverrides ?? []).map(normalized));
    for (const typed of line.serials!) {
      const serial = normalized(typed);
      if (seen.has(serial)) continue;
      seen.add(serial);
      const [row] = await tx
        .select({
          id: serials.id,
          status: serials.status,
          saleId: serials.saleId,
          variantId: serials.variantId,
        })
        .from(serials)
        .where(eq(serials.serial, serial));
      if (!row) {
        flags.add('unknown_serial');
        await tx.execute(sql`
          insert into serials (tenant_id, variant_id, serial, status, sale_id, sold_on, warranty_until, branch_id)
          values (${tenantId}, ${line.variantId}, ${serial}, 'sold', ${saleId}, ${date}, ${until}, ${branchId})`);
        await remember(serial, line.variantId, overrides.has(serial) ? 'override' : 'unknown');
      } else if (row.variantId !== line.variantId) {
        flags.add('serial_other_product');
        await remember(serial, line.variantId, 'other_product');
      } else if (row.status === 'in_stock') {
        await tx.execute(sql`
          update serials set status = 'sold', sale_id = ${saleId}, sold_on = ${date}, warranty_until = ${until}
          where id = ${row.id}`);
        await remember(serial, line.variantId, null);
      } else if (row.saleId !== saleId) {
        flags.add('serial_sold_twice');
        await remember(serial, line.variantId, 'duplicate');
      } else {
        await remember(serial, line.variantId, null);
      }
    }
  }
  return [...flags];
}

const normalized = (serial: string) => serial.replace(/\s+/g, '').toUpperCase();

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
  query: {
    q?: string | undefined;
    saleId?: string | undefined;
    customerId?: string | undefined;
    flagged?: string | undefined;
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
      where ${typed ? sql`s.serial like ${`%${typed}%`}` : sql`true`}
        and ${query.saleId ? sql`exists (select 1 from serial_sales ss where ss.tenant_id = s.tenant_id and ss.serial = s.serial and ss.sale_id = ${query.saleId})` : sql`true`}
        and ${query.customerId ? sql`i.customer_id = ${query.customerId}` : sql`true`}
        and ${query.flagged ? sql`exists (select 1 from serial_sales ss where ss.tenant_id = s.tenant_id and ss.serial = s.serial and ss.flag is not null)` : sql`true`}
      order by s.created_at desc, s.serial
      limit 100`);
    const history = rows.length
      ? await tx.execute<{
          serial: string;
          sale_number: string | null;
          sold_on: string;
          flag: SerialFlag | null;
          customer_name: string | null;
        }>(sql`
          select ss.serial, i.number as sale_number, ss.sold_on::text as sold_on, ss.flag,
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

/** Pieces a sale sent out of each serial-tracked variant that have no number yet: variantId -> missing */
async function missingBySale(tx: Transaction, saleId: string): Promise<Map<string, number>> {
  const rows = await tx.execute<{ variant_id: string; missing: number }>(sql`
    select l.variant_id, (sum(l.base_qty) / 1000 - coalesce(max(ss.n), 0))::int as missing
    from invoice_lines l
    join products p on p.tenant_id = l.tenant_id and p.id = l.product_id and p.tracks_serial
    left join (select variant_id, count(*) as n from serial_sales where sale_id = ${saleId} group by variant_id) ss
      on ss.variant_id = l.variant_id
    where l.invoice_id = ${saleId}
    group by l.variant_id`);
  return new Map(rows.filter((r) => r.missing > 0).map((r) => [r.variant_id, r.missing]));
}

/** «بيعات بلا رقم»: sales flagged serial_missing, each with the in-stock serials one of which left with it */
export function unassignedSales(
  db: Database,
  auth: AccessClaims,
): Promise<{ items: UnassignedSerialSale[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const sales = await tx.execute<{ id: string; number: string; business_date: string }>(sql`
      select id, number, business_date::text as business_date from invoices
      where 'serial_missing' = any(flags) order by business_date desc, number desc limit 50`);
    const items: UnassignedSerialSale[] = [];
    for (const sale of sales) {
      for (const [variantId, missing] of await missingBySale(tx, sale.id)) {
        const [named] = await tx.execute<{ name: string }>(sql`
          select p.name_ar || coalesce(' ' || v.label, '') as name from variants v
          join products p on p.tenant_id = v.tenant_id and p.id = v.product_id where v.id = ${variantId}`);
        const candidates = await tx
          .select({ serial: serials.serial })
          .from(serials)
          .where(and(eq(serials.variantId, variantId), eq(serials.status, 'in_stock')))
          .orderBy(serials.serial)
          .limit(100);
        items.push({
          saleId: sale.id,
          saleNumber: sale.number,
          soldOn: sale.business_date,
          variantId,
          name: named?.name ?? '',
          missing,
          candidates: candidates.map((c) => c.serial),
        });
      }
    }
    return { items };
  });
}

/** An in-stock piece left with a sale that had no number for it: sold by that sale (the invoice keeps its flag as history; the list shows only sales still missing a number) */
async function assignToSale(
  tx: Transaction,
  row: typeof serials.$inferSelect,
  saleId: string,
): Promise<void> {
  if (row.status !== 'in_stock') throw invalid({ status: 'الرقم ليس في المحل' });
  const [sale] = await tx.execute<{ business_date: string }>(sql`
    select business_date::text as business_date from invoices where id = ${saleId}`);
  if (!sale) throw new AppError(404, 'not_found', 'هذه البيعة غير موجودة.');
  const missing = await missingBySale(tx, saleId);
  if (!missing.has(row.variantId)) {
    throw invalid({ saleId: 'هذه البيعة لا ينقصها رقم لهذا الصنف' });
  }
  const prod = (await tracking(tx, [row.variantId])).get(row.variantId);
  const until = prod?.warranty ? addMonthsIso(sale.business_date, prod.warranty) : null;
  await tx.execute(sql`
    update serials set status = 'sold', sale_id = ${saleId}, sold_on = ${sale.business_date},
      warranty_until = ${until} where id = ${row.id}`);
  await tx.execute(sql`
    insert into serial_sales (tenant_id, serial, variant_id, sale_id, sold_on, flag)
    values (${row.tenantId}, ${row.serial}, ${row.variantId}, ${saleId}, ${sale.business_date}, null)
    on conflict (tenant_id, serial, sale_id) do nothing`);
}

/**
 * «تصحيح»: puts a drifted row right. Back in stock (a number sold by mistake, or a return that did
 * not bring it back), or sold again by the latest sale of its history. Moves no stock and posts
 * nothing; the audit trail keeps who did it.
 */
export function fixSerial(
  db: Database,
  auth: AccessClaims,
  input: SerialFixInput,
  meta: RequestMeta,
): Promise<{ serial: string; status: 'in_stock' | 'sold' }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'inventory.adjust');
    const serial = normalized(input.serial);
    const [row] = await tx.select().from(serials).where(eq(serials.serial, serial));
    if (!row) throw new AppError(404, 'not_found', 'هذا الرقم التسلسلي غير موجود في المحل.');
    if (row.status === input.status) {
      throw invalid({ status: 'الرقم في هذه الحالة أصلاً' });
    }
    if (input.status === 'in_stock') {
      await tx.execute(sql`
        update serials set status = 'in_stock', sale_id = null, sold_on = null, warranty_until = null
        where id = ${row.id}`);
    } else if (input.saleId) {
      await assignToSale(tx, row, input.saleId);
    } else {
      const [last] = await tx.execute<{ sale_id: string; sold_on: string }>(sql`
        select sale_id, sold_on::text as sold_on from serial_sales
        where serial = ${serial} order by sold_on desc, created_at desc limit 1`);
      if (!last) throw invalid({ status: 'لا بيعة مسجّلة لهذا الرقم' });
      const [prod] = await tracking(tx, [row.variantId]).then((m) => [m.get(row.variantId)]);
      const until = prod?.warranty ? addMonthsIso(last.sold_on, prod.warranty) : null;
      await tx.execute(sql`
        update serials set status = 'sold', sale_id = ${last.sale_id}, sold_on = ${last.sold_on},
          warranty_until = ${until} where id = ${row.id}`);
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'serial.fix',
        entity: 'serial',
        entityId: row.id,
        changes: {
          status: [row.status, input.status],
          ...(input.saleId ? { saleId: [null, input.saleId] as [unknown, unknown] } : {}),
        },
      },
      meta,
    );
    return { serial, status: input.status };
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
