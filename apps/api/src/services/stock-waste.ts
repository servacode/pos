import { sql } from 'drizzle-orm';
import {
  businessDateOf,
  LEGACY_WASTE_NOTE,
  type CountSheet,
  type CountSheetItem,
  type countSheetQuery,
  type tillWasteInput,
  type StocktakeDetail,
  type wasteReportQuery,
  type WasteReport,
  type WasteRow,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { forbidden, permissionScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { batchPool } from './batches';
import { uuidArray } from './costing';
import { assertDateOpen } from './period-close';
import { baseCurrency, branchOf, createStocktakeIn, invalid, stocktakeById } from './purchases';

/**
 * Round 38, supermarket pack: «تالف / هدر» at the till (#41), the waste report, and the count sheet a phone
 * counts by (#29). Nothing here posts on its own: a waste is the store's ordinary stock count
 * (createStocktakeIn: Dr 6300 / Cr 1300 at the running average, the batch ledger, the audit entry), so the
 * trial balance and the stock-equals-movements rule stay what they were.
 */

/** A waste of `qty` from what is on the shelf now, as the count lines that leave exactly that much */
export function tillWaste(
  db: Database,
  device: DeviceClaims,
  input: z.output<typeof tillWasteInput>,
  now: Date,
  meta: RequestMeta,
): Promise<StocktakeDetail> {
  return withTenant(db, device.tenantId, async (tx) => {
    // The user who may do it (the signed-in one, or the manager whose code was typed): holds inventory.adjust here
    await requirePermission(tx, input.actorId, 'inventory.adjust', device.branchId);
    // A retry after a lost answer: the waste already made is the answer
    const made = await stocktakeById(tx, input.id);
    if (made) return made;
    const auth = {
      userId: input.actorId,
      tenantId: device.tenantId,
      sessionId: device.deviceId,
    } as AccessClaims;
    const branchId = await branchOf(tx, device.branchId);

    // One line per (item, batch): two lines of the same piece are one waste of both
    const wanted = new Map<string, (typeof input.lines)[number]>();
    for (const l of input.lines) {
      const key = `${l.variantId}|${l.batchNo ?? ''}|${l.expiryDate ?? ''}`;
      const seen = wanted.get(key);
      wanted.set(key, seen ? { ...seen, qty: seen.qty + l.qty } : l);
    }
    const lines = [...wanted.values()];
    const variantIds = [...new Set(lines.map((l) => l.variantId))];
    // The rows stay locked until this commits: a sale at the same moment waits, so what is left is exact
    const levels = await tx.execute<{ variant_id: string; qty: string }>(sql`
      select variant_id, qty::text from stock_levels
      where branch_id = ${branchId} and variant_id = any(${uuidArray(variantIds)}) for update`);
    const stock = new Map(levels.map((r) => [r.variant_id, Number(r.qty)]));
    const pool = await batchPool(tx, branchId, variantIds);

    const countLines = lines.map((l, i) => {
      const field = `lines.${i}.qty`;
      const onShelf = stock.get(l.variantId) ?? 0;
      if (l.batchNo || l.expiryDate) {
        const held = (pool.get(l.variantId) ?? []).find(
          (b) => (b.batchNo ?? '') === (l.batchNo ?? '') && (b.expiry ?? null) === (l.expiryDate ?? null),
        );
        const left = Math.max(0, held?.qty ?? 0);
        if (l.qty > left) throw invalid({ [field]: 'الدفعة فيها أقل من هذه الكمية.' });
        return { ...l, countedQty: left - l.qty };
      }
      if (l.qty > onShelf) throw invalid({ [field]: 'الموجود من هذا الصنف أقل من الكمية المكتوبة.' });
      return { ...l, countedQty: onShelf - l.qty };
    });

    const [zone] = await tx.execute<{ timezone: string }>(
      sql`select timezone from tenants where id = ${device.tenantId}`,
    );
    const date = businessDateOf(now, zone?.timezone ?? 'Asia/Damascus');
    await assertDateOpen(tx, device.tenantId, date);
    const posted = await createStocktakeIn(
      tx,
      auth,
      {
        id: input.id,
        branchId,
        date,
        note: `هدر: ${input.reason}`,
        lines: countLines.map((l) => ({
          variantId: l.variantId,
          countedQty: l.countedQty,
          ...(l.batchNo || l.expiryDate
            ? { batchNo: l.batchNo ?? null, expiryDate: l.expiryDate ?? null }
            : {}),
          wasteReason: input.reason,
        })),
      },
      meta,
    );
    // Which till made the waste, and under whose name: the count's own entry carries only the user
    await audit(
      tx,
      {
        tenantId: device.tenantId,
        userId: input.actorId,
        actorType: 'device',
        deviceId: device.deviceId,
        action: 'stocktake.till_waste',
        entity: 'stocktake',
        entityId: posted.id,
        data: { branchId, reason: input.reason, number: posted.number },
      },
      meta,
    );
    return posted;
  });
}

/** The waste report: every line a waste took out, by period, with its reason, product and cost */
export function wasteReport(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof wasteReportQuery>,
): Promise<WasteReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const adjust = await permissionScope(tx, auth.userId, 'inventory.adjust');
    // The cost of what was thrown away is in it: who may adjust stock, see costs or read the money reports
    const mayRead = [
      adjust,
      await permissionScope(tx, auth.userId, 'cost.view'),
      await permissionScope(tx, auth.userId, 'reports.financial'),
    ];
    if (!mayRead.some((scope) => scope.all || scope.branchIds.size > 0)) throw forbidden();
    // Only the branches where one of those permissions is held (every branch when one is held everywhere)
    const everywhere = mayRead.some((scope) => scope.all);
    const allowed = [...new Set(mayRead.flatMap((scope) => [...scope.branchIds]))];
    if (query.branchId && !everywhere && !allowed.includes(query.branchId)) throw forbidden();
    if (query.from > query.to) throw invalid({ from: 'تاريخ البداية بعد تاريخ النهاية' });
    // A line is a waste when it names a reason; a document an older version recorded says «هدر» in its note
    const found = await tx.execute<{
      date: string;
      number: string;
      branch_id: string;
      variant_id: string;
      name: string;
      reason: string | null;
      qty: string;
      cost: string;
    }>(sql`
      select s.business_date::text as date, s.number, s.branch_id, l->>'variantId' as variant_id,
             l->>'name' as name, nullif(l->>'reason', '') as reason,
             (-(l->>'diffQty')::bigint)::text as qty, (-(l->>'diffValueMinor')::bigint)::text as cost
      from stocktakes s, jsonb_array_elements(s.lines) l
      where s.business_date between ${query.from} and ${query.to}
        ${query.branchId ? sql`and s.branch_id = ${query.branchId}` : sql``}
        ${everywhere ? sql`` : sql`and s.branch_id = any(${uuidArray(allowed)})`}
        and (l->>'diffQty')::bigint < 0
        and (nullif(l->>'reason', '') is not null or s.note like ${`${LEGACY_WASTE_NOTE}%`})
      order by s.business_date desc, s.number desc, l->>'name'
      limit 5001`);
    const truncated = found.length > 5000;
    const rows: WasteRow[] = found.slice(0, 5000).map((r) => ({
      date: r.date,
      number: r.number,
      branchId: r.branch_id,
      variantId: r.variant_id,
      name: r.name,
      reason: r.reason ?? 'بلا سبب',
      qty: Number(r.qty),
      costMinor: Number(r.cost),
    }));
    const byReason = new Map<string, { reason: string; qty: number; costMinor: number; count: number }>();
    const byProduct = new Map<
      string,
      { variantId: string; name: string; qty: number; costMinor: number; count: number }
    >();
    for (const r of rows) {
      const a = byReason.get(r.reason) ?? { reason: r.reason, qty: 0, costMinor: 0, count: 0 };
      a.qty += r.qty;
      a.costMinor += r.costMinor;
      a.count += 1;
      byReason.set(r.reason, a);
      const p = byProduct.get(r.variantId) ?? {
        variantId: r.variantId,
        name: r.name,
        qty: 0,
        costMinor: 0,
        count: 0,
      };
      p.qty += r.qty;
      p.costMinor += r.costMinor;
      p.count += 1;
      byProduct.set(r.variantId, p);
    }
    const byCost = <T extends { costMinor: number }>(list: Iterable<T>) =>
      [...list].sort((a, b) => b.costMinor - a.costMinor);
    return {
      from: query.from,
      to: query.to,
      rows,
      byReason: byCost(byReason.values()),
      byProduct: byCost(byProduct.values()),
      totalCostMinor: rows.reduce((sum, r) => sum + r.costMinor, 0),
      baseCurrency: await baseCurrency(tx),
      ...(truncated ? { truncated } : {}),
    };
  });
}

/** The categories under `rootId` (itself included), by walking the tree */
async function categoryTree(
  tx: Transaction,
  rootId: string | undefined,
): Promise<{ list: CountSheet['categories']; ids: string[] | null }> {
  const all = await tx.execute<{ id: string; name: string; parent_id: string | null }>(
    sql`select id, name, parent_id from categories where archived_at is null order by sort_order, name`,
  );
  const list = all.map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id }));
  if (!rootId) return { list, ids: null };
  const ids = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of list) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return { list, ids: [...ids] };
}

/**
 * What a phone counts by: the branch's stocked items (all, or one category with its sub-categories), their
 * barcodes with the pieces each scan stands for, and what the books say is there. The phone keeps it, counts
 * against it with no connection, and posts the count (one stocktake with its own id) when it can.
 */
export function countSheet(
  db: Database,
  auth: AccessClaims,
  query: z.output<typeof countSheetQuery>,
  now: Date,
): Promise<CountSheet> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const branchId = await branchOf(tx, query.branchId);
    await requirePermission(tx, auth.userId, 'inventory.adjust', branchId);
    // The sheet's time is the database's clock, the one stock movements are stamped with: a count made against
    // it (countedAt) then leaves out exactly what moved after it, whatever the app server's clock says
    const [clock] = await tx.execute<{ at: Date | string }>(sql`select now() as at`);
    const stamp = new Date(clock?.at ?? now).toISOString();
    const tree = await categoryTree(tx, query.categoryId);
    if (query.categoryId && !tree.list.some((c) => c.id === query.categoryId)) {
      throw new AppError(404, 'not_found', 'هذا التصنيف غير موجود.');
    }
    const rows = await tx.execute<{
      variant_id: string;
      name: string;
      category_id: string | null;
      allows_fraction: boolean | null;
      qty: string;
    }>(sql`
      select l.variant_id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name, p.category_id,
             un.allows_fraction, l.qty::text
      from stock_levels l
      join variants v on v.tenant_id = l.tenant_id and v.id = l.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      left join units un on un.tenant_id = p.tenant_id and un.id = p.unit_id
      where l.branch_id = ${branchId}
        ${tree.ids ? sql`and p.category_id = any(${uuidArray(tree.ids)})` : sql``}
      order by name, l.variant_id`);
    const codes = rows.length
      ? await tx.execute<{ variant_id: string; code: string; pack_qty: number }>(sql`
          select variant_id, code, pack_qty from barcodes
          where variant_id = any(${uuidArray(rows.map((r) => r.variant_id))}) order by code`)
      : [];
    const byVariant = new Map<string, { code: string; packQty: number }[]>();
    for (const c of codes) {
      const list = byVariant.get(c.variant_id) ?? [];
      list.push({ code: c.code, packQty: c.pack_qty });
      byVariant.set(c.variant_id, list);
    }
    const items: CountSheetItem[] = rows.map((r) => ({
      variantId: r.variant_id,
      name: r.name,
      categoryId: r.category_id,
      allowsFraction: r.allows_fraction ?? false,
      qty: Number(r.qty),
      barcodes: byVariant.get(r.variant_id) ?? [],
    }));
    return {
      branchId,
      categoryId: query.categoryId ?? null,
      at: stamp,
      items,
      categories: tree.list,
    };
  });
}
