import { and, eq, sql } from 'drizzle-orm';
import type { SaleLine, SerialFixInput, SerialFlag, UnassignedSerialSale } from '@serva/core';
import { addMonthsIso } from '@serva/core';
import type { SyncFlag } from '@serva/sync';
import { serials, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import { audit } from './audit';
import type { RequestMeta } from '../types';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import { invalid, tracking, normalized } from './serials-core';

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
        // Two tills syncing the same number never received here: the first row wins, the second is a duplicate
        const made = await tx.execute<{ id: string }>(sql`
          insert into serials (tenant_id, variant_id, serial, status, sale_id, sold_on, warranty_until, branch_id)
          values (${tenantId}, ${line.variantId}, ${serial}, 'sold', ${saleId}, ${date}, ${until}, ${branchId})
          on conflict (tenant_id, serial) do nothing returning id`);
        if (made.length > 0) {
          flags.add('unknown_serial');
          await remember(serial, line.variantId, overrides.has(serial) ? 'override' : 'unknown');
        } else {
          flags.add('serial_sold_twice');
          await remember(serial, line.variantId, 'duplicate');
        }
      } else if (row.variantId !== line.variantId) {
        flags.add('serial_other_product');
        await remember(serial, line.variantId, 'other_product');
      } else if (row.status === 'in_stock') {
        // Guarded by the status: two tills syncing the same number together, only the first one sells it
        const took = await tx.execute<{ id: string }>(sql`
          update serials set status = 'sold', sale_id = ${saleId}, sold_on = ${date}, warranty_until = ${until}
          where id = ${row.id} and status = 'in_stock' returning id`);
        if (took.length > 0) {
          await remember(serial, line.variantId, null);
        } else {
          flags.add('serial_sold_twice');
          await remember(serial, line.variantId, 'duplicate');
        }
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
): Promise<{ items: UnassignedSerialSale[]; more?: boolean }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const items: UnassignedSerialSale[] = [];
    // The list shows the 50 newest sales still missing a number: the resolved ones are skipped, not counted.
    // The flagged sales are read in pages, so an old backlog never hides behind a fixed cut; `more` says the list was cut.
    const PAGE = 200;
    let more = false;
    for (let offset = 0; offset < 10_000 && !more; offset += PAGE) {
      const sales = await tx.execute<{ id: string; number: string; business_date: string }>(sql`
        select id, number, business_date::text as business_date from invoices
        where 'serial_missing' = any(flags) order by business_date desc, number desc
        limit ${PAGE} offset ${offset}`);
      for (const sale of sales) {
        if (items.length >= 50) {
          more = true;
          break;
        }
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
      if (sales.length < PAGE) break;
    }
    return { items, ...(more ? { more } : {}) };
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
 * «تصحيح»: puts a drifted row right. Back in stock (a number sold by mistake, a return that did
 * not bring it back, or a lost piece found again), «ضائع» (a piece that left without its number), or sold
 * again by the latest sale of its history. Moves no stock and posts
 * nothing; the audit trail keeps who did it.
 */
export function fixSerial(
  db: Database,
  auth: AccessClaims,
  input: SerialFixInput,
  meta: RequestMeta,
): Promise<{ serial: string; status: 'in_stock' | 'sold' | 'lost' }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'inventory.adjust');
    const serial = normalized(input.serial);
    const [row] = await tx.select().from(serials).where(eq(serials.serial, serial));
    if (!row) {
      // Round 62: stock that came in with no number named (a surplus counted before, a purchase entered by hand):
      // the owner adds the number to the product; no stock moves, nothing is posted
      if (input.status === 'in_stock' && input.variantId) {
        const prod = (await tracking(tx, [input.variantId])).get(input.variantId);
        if (!prod?.tracks) throw invalid({ serial: 'هذا الصنف لا يُباع بأرقام تسلسلية' });
        const [home] = await tx.execute<{ branch_id: string }>(sql`
          select branch_id from (
            select branch_id, qty, 0 as rank from stock_levels where variant_id = ${input.variantId} and qty > 0
            union all
            select id, 0, 1 from branches where kind = 'store') x
          order by rank, qty desc limit 1`);
        const [made] = await tx
          .insert(serials)
          .values({
            tenantId: auth.tenantId,
            variantId: input.variantId,
            serial,
            status: 'in_stock',
            branchId: home?.branch_id ?? null,
          })
          .returning({ id: serials.id });
        await audit(
          tx,
          {
            tenantId: auth.tenantId,
            userId: auth.userId,
            action: 'serial.fix',
            entity: 'serial',
            entityId: made!.id,
            changes: { status: [null, 'in_stock'] },
          },
          meta,
        );
        return { serial, status: 'in_stock' };
      }
      throw new AppError(404, 'not_found', 'هذا الرقم التسلسلي غير موجود في المحل.');
    }
    if (input.keepSaleId) {
      // A number two sales took: it stays with the one the owner picks; the other keeps its flagged line in the history
      if (row.status !== 'sold' || input.status !== 'sold') {
        throw invalid({ status: 'الرقم ليس مباعاً' });
      }
      if (row.saleId === input.keepSaleId) throw invalid({ keepSaleId: 'الرقم عند هذه البيعة أصلاً' });
      const [kept] = await tx.execute<{ sold_on: string }>(sql`
        select sold_on::text as sold_on from serial_sales
        where serial = ${serial} and sale_id = ${input.keepSaleId}`);
      if (!kept) throw invalid({ keepSaleId: 'هذه البيعة لم تبع هذا الرقم' });
      const [prod] = await tracking(tx, [row.variantId]).then((m) => [m.get(row.variantId)]);
      const until = prod?.warranty ? addMonthsIso(kept.sold_on, prod.warranty) : null;
      await tx.execute(sql`
        update serials set sale_id = ${input.keepSaleId}, sold_on = ${kept.sold_on}, warranty_until = ${until}
        where id = ${row.id}`);
    } else if (row.status === input.status) {
      throw invalid({ status: 'الرقم في هذه الحالة أصلاً' });
    } else if (input.status === 'lost') {
      // A piece that is gone (a write-off that did not name it): it leaves the stock list, nothing else moves
      if (row.status !== 'in_stock') throw invalid({ status: 'الرقم ليس في المحل' });
      await tx.execute(sql`update serials set status = 'lost' where id = ${row.id}`);
    } else if (row.status === 'lost' && input.status !== 'in_stock') {
      throw invalid({ status: 'الرقم ضائع: يعود إلى المحل أولاً' });
    } else if (input.status === 'in_stock') {
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
          ...(input.keepSaleId ? { saleId: [row.saleId, input.keepSaleId] as [unknown, unknown] } : {}),
        },
      },
      meta,
    );
    return { serial, status: input.status };
  });
}
