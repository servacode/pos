import { and, eq, sql } from 'drizzle-orm';
import {
  stockBack,
  stockOut,
  wasteReasonsOf,
  type InventoryResponse,
  type ProfitReport,
  type StocktakeDetail,
  type StocktakeListResponse,
  LEGACY_WASTE_NOTE,
  type StocktakeInput,
  type StocktakeLineRow,
  type StockValue,
} from '@serva/core';
import { stockLevels, stocktakes, withTenant, type Database, type Transaction } from '@serva/db';
import { forbidden, inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
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
import { ledgerBranchOf } from './damaged-stock';
import { postEntry } from './posting';
import { recordBatchMovements, refreshBatches, batchPool, takeBatches, trackedVariants } from './batches';
import { countSerials } from './serials';
import { newId, invalid, baseCurrency, branchOf, nextNumber, stockedVariants } from './purchases-common';
import { moveStock } from './purchases-create';

export async function inventory(
  db: Database,
  auth: AccessClaims,
  query: { branchId?: string },
): Promise<InventoryResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'cost.view');
    // A role given for one branch reads that branch's stock only
    if (query.branchId && !inScope(scope, query.branchId)) throw forbidden();
    await costPending(tx, auth.tenantId);
    const rows = await tx.execute<{
      variant_id: string;
      branch_id: string;
      branch_name: string;
      branch_kind: string;
      name: string;
      qty: string;
      value_minor: string;
      ref_qty: string;
      ref_value_minor: string;
      dead_qty: string;
      last_cost: string | null;
      typical_cost: string | null;
      attributes: { name: string; value: string }[] | null;
      product_id: string;
      product_name: string;
      allows_fraction: boolean | null;
      min_stock: string | null;
      tracks_serial: boolean;
    }>(sql`
      select l.variant_id, l.branch_id, br.name as branch_name, br.kind as branch_kind, v.min_stock_qty::text as min_stock, p.tracks_serial,
             trim(p.name_ar || ' ' || coalesce(v.label, '')) as name,
             v.attributes, p.id as product_id, p.name_ar as product_name, un.allows_fraction,
             l.qty::text, coalesce(sv.value_minor, 0)::text as value_minor,
             coalesce(sv.ref_qty, 0)::text as ref_qty, coalesce(sv.ref_value_minor, 0)::text as ref_value_minor,
             (select coalesce(sum(bm.q), 0) from (
                select m.batch_no, m.expiry_date, sum(m.qty) as q from batch_movements m
                where m.tenant_id = l.tenant_id and m.variant_id = l.variant_id and m.branch_id = l.branch_id
                group by m.batch_no, m.expiry_date having sum(m.qty) > 0) bm
              where bm.expiry_date < (now() at time zone coalesce((select timezone from tenants limit 1), 'UTC'))::date
                 or exists (select 1 from batch_blocks bl
                            where bl.tenant_id = l.tenant_id and bl.variant_id = l.variant_id
                              and bl.batch_no = bm.batch_no and bl.released_at is null))::text as dead_qty,
             (select (pl.cost_minor * 1000.0 / pl.qty)::text from purchase_lines pl
              join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
              where pl.tenant_id = l.tenant_id and pl.variant_id = l.variant_id and pl.qty > 0 and pl.cost_minor > 0
              and not exists (select 1 from purchase_reversals rv where rv.tenant_id = pu.tenant_id and rv.purchase_id = pu.id)
              order by pu.business_date desc, pu.created_at desc, pl.line_no desc limit 1) as last_cost,
             (select (percentile_cont(0.5) within group (order by t.c))::text from (
                select pl.cost_minor * 1000.0 / pl.qty as c from purchase_lines pl
                join purchases pu on pu.tenant_id = pl.tenant_id and pu.id = pl.purchase_id
                where pl.tenant_id = l.tenant_id and pl.variant_id = l.variant_id and pl.qty > 0 and pl.cost_minor > 0
              and not exists (select 1 from purchase_reversals rv where rv.tenant_id = pu.tenant_id and rv.purchase_id = pu.id)
                order by pu.business_date desc, pu.created_at desc, pl.line_no desc limit 5) t) as typical_cost
      from stock_levels l
      join variants v on v.tenant_id = l.tenant_id and v.id = l.variant_id
      join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
      join branches br on br.tenant_id = l.tenant_id and br.id = l.branch_id
      left join units un on un.tenant_id = p.tenant_id and un.id = p.unit_id
      left join stock_values sv on sv.tenant_id = l.tenant_id and sv.branch_id = l.branch_id and sv.variant_id = l.variant_id
      ${
        query.branchId
          ? sql`where l.branch_id = ${query.branchId}`
          : // The damaged goods have their own page (round 35, D7): this one is the stock a shop can sell
            sql`where l.branch_id not in (select id from branches where kind = 'damaged')`
      }
      ${scope.all ? sql`` : sql`and l.branch_id = any(${uuidArray([...scope.branchIds])})`}
      order by name, l.variant_id`);
    const items = rows.map((r) => {
      const qty = Number(r.qty);
      const value = Number(r.value_minor);
      return {
        variantId: r.variant_id,
        branchId: r.branch_id,
        branchName: r.branch_name,
        branchKind: r.branch_kind,
        name: r.name,
        attributes: r.attributes ?? [],
        productId: r.product_id,
        productName: r.product_name,
        allowsFraction: r.allows_fraction ?? false,
        minStockQty: r.min_stock === null ? null : Number(r.min_stock),
        tracksSerial: r.tracks_serial,
        qty,
        valueMinor: value,
        sellableQty: Math.max(0, qty - Number(r.dead_qty)),
        refQty: Number(r.ref_qty),
        refValueMinor: Number(r.ref_value_minor),
        unitCostMinor: qty > 0 ? Math.round((value * 1000 * 10_000) / qty) / 10_000 : null,
        lastCostMinor: r.last_cost === null ? null : Math.round(Number(r.last_cost) * 100) / 100,
        typicalCostMinor: r.typical_cost === null ? null : Math.round(Number(r.typical_cost) * 100) / 100,
      };
    });
    // Round 38: the reasons «سجّل هدراً» offers, the store's own list or the built-in one
    const [till] = await tx.execute<{ reasons: string[] | null }>(
      sql`select (till->'wasteReasons') as reasons from tenant_settings`,
    );
    // The database's clock: a write-off made from this list counts what moved after it (see createStocktakeIn)
    const [clock] = await tx.execute<{ at: Date | string }>(sql`select now() as at`);
    return {
      items,
      totalValueMinor: items.reduce((sum, i) => sum + i.valueMinor, 0),
      baseCurrency: await baseCurrency(tx),
      wasteReasons: wasteReasonsOf(till?.reasons),
      asOf: new Date(clock?.at ?? Date.now()).toISOString(),
    };
  });
}

/** A stocktake already made with this id, as its detail; null when there is none */
export async function stocktakeById(tx: Transaction, id: string): Promise<StocktakeDetail | null> {
  const [row] = await tx.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    date: row.businessDate,
    branchId: row.branchId,
    lines: row.lines as StocktakeLineRow[],
    diffValueMinor: row.diffValueMinor,
    baseCurrency: await baseCurrency(tx),
  };
}

/** The counts already made, newest first, with who made them (round 44), inside the branches the role is held in */
export function listStocktakes(
  db: Database,
  auth: AccessClaims,
  query: { limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<StocktakeListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'inventory.adjust');
    const limit = query.limit ?? 20;
    const offset = /^o:\d{1,6}$/.test(query.cursor ?? '') ? Number(query.cursor!.slice(2)) : 0;
    const rows = await tx.execute<{
      id: string;
      number: string;
      date: string;
      branch_id: string;
      branch_name: string;
      by: string | null;
      items: string;
      diff: string;
      note: string | null;
      waste: boolean;
    }>(sql`
      select s.id, s.number, s.business_date::text as date, s.branch_id, b.name as branch_name, u.full_name as by,
             jsonb_array_length(s.lines)::text as items, s.diff_value_minor::text as diff, s.note,
             exists (select 1 from jsonb_array_elements(s.lines) l where nullif(l->>'reason', '') is not null) as waste
      from stocktakes s
      join branches b on b.tenant_id = s.tenant_id and b.id = s.branch_id
      left join users u on u.tenant_id = s.tenant_id and u.id = s.created_by
      ${scope.all ? sql`` : sql`where s.branch_id = any(${uuidArray([...scope.branchIds])})`}
      order by s.business_date desc, s.created_at desc
      limit ${limit + 1} offset ${offset}`);
    return {
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        number: r.number,
        date: r.date,
        branchId: r.branch_id,
        branchName: r.branch_name,
        by: r.by ?? '',
        kind:
          r.waste || r.note === LEGACY_WASTE_NOTE
            ? ('waste' as const)
            : r.note?.startsWith('نقص في التحويل')
              ? ('shortage' as const)
              : ('count' as const),
        items: Number(r.items),
        diffValueMinor: Number(r.diff),
        note: r.note,
      })),
      nextCursor: rows.length > limit ? `o:${offset + limit}` : null,
    };
  });
}

export function createStocktake(
  db: Database,
  auth: AccessClaims,
  input: StocktakeInput,
  meta: RequestMeta,
  opts: { lenientSerials?: boolean } = {},
): Promise<StocktakeDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // The count is of one branch: the permission must hold there, not only somewhere
    await requirePermission(tx, auth.userId, 'inventory.adjust', await branchOf(tx, input.branchId));
    // A count made against a phone's older sheet is never refused for want of serial numbers (it was counted offline)
    // Round 66: a store that asks for the numbers on every write-off refuses one that names none (the till's own waste is not asked)
    const [till] = await tx.execute<{ on: string | null }>(
      sql`select (till->>'serialsOnWaste') as "on" from tenant_settings`,
    );
    return createStocktakeIn(tx, auth, input, meta, {
      strictSerials: !input.countedAt && !opts.lenientSerials,
      serialsOnWaste: till?.on === 'true',
    });
  });
}

/** The count itself, inside the caller's transaction (a transfer's shortage is written off through it) */
export async function createStocktakeIn(
  tx: Transaction,
  auth: AccessClaims,
  input: StocktakeInput,
  meta: RequestMeta,
  opts: { strictSerials?: boolean; serialsOnWaste?: boolean } = {},
): Promise<StocktakeDetail> {
  await requirePermission(tx, auth.userId, 'inventory.adjust');
  // Round 38: a count with an id the device made (a phone's offline count, a till's waste) posts once: the
  // same id again answers the document it made
  if (input.id) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stocktake:${input.id}`}, 0))`);
    const made = await stocktakeById(tx, input.id);
    if (made) return made;
  }
  const branchId = await branchOf(tx, input.branchId);
  const names = await stockedVariants(
    tx,
    input.lines.map((l) => l.variantId),
  );
  const missing = input.lines.findIndex((l) => !names.has(l.variantId));
  if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
  await costPending(tx, auth.tenantId);

  // A line with a batch counts (or writes off) that batch alone: the item's stock moves by the
  // batch's difference. A line without one counts the whole item. An item is counted one way.
  const isBatchLine = (l: (typeof input.lines)[number]) => Boolean(l.batchNo || l.expiryDate);
  const wholeCounted = new Set(input.lines.filter((l) => !isBatchLine(l)).map((l) => l.variantId));
  // An item is counted once: two whole counts of it would each be compared with the same book figure and both applied
  const seenWhole = new Set<string>();
  for (const [i, l] of input.lines.entries()) {
    if (isBatchLine(l)) continue;
    if (seenWhole.has(l.variantId))
      throw invalid({ [`lines.${i}.variantId`]: 'هذا الصنف مكرر في الجرد: اجمع عدّاته في سطر واحد' });
    seenWhole.add(l.variantId);
  }
  const mixed = input.lines.findIndex((l) => isBatchLine(l) && wholeCounted.has(l.variantId));
  if (mixed >= 0) {
    throw invalid({ [`lines.${mixed}.batchNo`]: 'عُدّ الصنف كاملاً أو دفعةً دفعة، لا الاثنين معاً' });
  }
  const batchLines = input.lines.filter(isBatchLine);
  const pool = await batchPool(
    tx,
    branchId,
    batchLines.map((l) => l.variantId),
  );
  const deltas: { variantId: string; batchNo: string | null; expiry: string | null; delta: number }[] = [];
  for (const l of batchLines) {
    const held = (pool.get(l.variantId) ?? []).find(
      (b) => (b.batchNo ?? '') === (l.batchNo ?? '') && (b.expiry ?? null) === (l.expiryDate ?? null),
    );
    deltas.push({
      variantId: l.variantId,
      batchNo: l.batchNo ?? null,
      expiry: l.expiryDate ?? null,
      delta: l.countedQty - Math.max(0, held?.qty ?? 0),
    });
  }
  const wholeLines = input.lines.filter((l) => !isBatchLine(l));
  const sums = new Map<string, number>();
  for (const d of deltas) sums.set(d.variantId, (sums.get(d.variantId) ?? 0) + d.delta);

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
  const keys: StockKey[] = [...new Set(input.lines.map((l) => l.variantId))].map((v) =>
    stockKey(branchId, v),
  );
  const values = await loadValues(tx, auth.tenantId, keys);
  const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };

  // One count line per item: the counted total of a whole count, or the stock plus its batches' differences
  // A count made against an older sheet: what moved since (a sale) is already off the shelf the phone counted
  const movedSince = new Map<string, number>();
  if (input.countedAt && wholeLines.length > 0) {
    const moved = await tx.execute<{ variant_id: string; qty: string }>(sql`
      select variant_id, sum(qty)::text as qty from stock_movements
      where branch_id = ${branchId} and created_at > ${input.countedAt}::timestamptz
        and variant_id = any(${uuidArray(wholeLines.map((l) => l.variantId))})
      group by variant_id`);
    for (const m of moved) movedSince.set(m.variant_id, Number(m.qty));
  }
  const countLines: { variantId: string; countedQty: number }[] = [
    ...wholeLines.map((l) => ({
      variantId: l.variantId,
      countedQty: Math.max(0, l.countedQty + (movedSince.get(l.variantId) ?? 0)),
    })),
    ...[...sums].map(([variantId, delta]) => ({
      variantId,
      countedQty: Math.max(0, (expected.get(variantId) ?? 0) + delta),
    })),
  ];
  const rows: StocktakeLineRow[] = [];
  const moves: { lineNo: number; variantId: string; qty: number }[] = [];
  // A waste line says why (round 38): the reason rides on the item's count line for the waste report
  const reasonOf = new Map<string, string>();
  for (const l of input.lines)
    if (l.wasteReason && !reasonOf.has(l.variantId)) reasonOf.set(l.variantId, l.wasteReason);
  for (const [i, l] of countLines.entries()) {
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
      ...(reasonOf.has(l.variantId) ? { reason: reasonOf.get(l.variantId)! } : {}),
    });
    moves.push({ lineNo: i + 1, variantId: l.variantId, qty: diff });
  }
  await saveValues(tx, auth.tenantId, values);
  // A tracked product's count says which serial numbers left, so the serial list and the stock agree (round 60)
  const serialsOf = new Map<string, string[]>();
  for (const l of input.lines) if (l.serials?.length) serialsOf.set(l.variantId, l.serials);
  // A write-off line: it names a reason, or its page said the numbers come later
  const wasteOf = new Set(
    input.lines.filter((l) => l.wasteReason || input.serialsLater === true).map((l) => l.variantId),
  );
  await countSerials(
    tx,
    auth.tenantId,
    branchId,
    rows.map((r) => ({
      variantId: r.variantId,
      diffQty: r.diffQty,
      serials: serialsOf.get(r.variantId),
      waste: wasteOf.has(r.variantId),
    })),
    !opts.strictSerials,
    opts.serialsOnWaste === true,
  );

  const id = input.id ?? newId();
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
  // The batch ledger: a batch's own count or write-off, and a whole-item loss taken earliest-expiry first
  const lineOf = new Map(moves.map((m) => [m.variantId, m.lineNo]));
  const keepsBatches = await trackedVariants(
    tx,
    branchId,
    moves.map((m) => m.variantId),
  );
  const ledger = [
    ...deltas.map((d, n) => ({
      variantId: d.variantId,
      batchNo: d.batchNo,
      expiry: d.expiry,
      qty: d.delta,
      lineNo: lineOf.get(d.variantId)!,
      allocNo: n,
    })),
    ...(
      await takeBatches(
        tx,
        branchId,
        moves
          .filter((m) => m.qty < 0 && wholeCounted.has(m.variantId))
          .map((m) => ({ lineNo: m.lineNo, variantId: m.variantId, qty: -m.qty })),
        () => 'lines',
      )
    ).map((r) => ({ ...r, qty: -r.qty })),
    // A whole count that finds more of an item that keeps batches: the extra pieces sit on the no-batch row
    ...moves
      .filter((m) => m.qty > 0 && wholeCounted.has(m.variantId) && keepsBatches.has(m.variantId))
      .map((m) => ({ variantId: m.variantId, batchNo: null, expiry: null, qty: m.qty, lineNo: m.lineNo })),
  ];
  await recordBatchMovements(
    tx,
    { tenantId: auth.tenantId, branchId, kind: 'count', docId: id, date: input.date },
    ledger,
  );
  await refreshBatches(
    tx,
    [branchId],
    moves.map((m) => m.variantId),
  );
  const currency = await baseCurrency(tx);
  // A loss (negative difference) is Dr 6300 / Cr 1300
  await postEntry(tx, {
    tenantId: auth.tenantId,
    branchId: await ledgerBranchOf(tx, branchId),
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
    // The products that sold for less than they cost in the period: the count is what the margin
    // hint says, the list (worst first) is what its link shows
    const belowRows = await tx.execute<{
      product_id: string;
      name: string;
      qty: string;
      sold: string;
      cost: string;
    }>(sql`
      select l.product_id, min(l.name) as name,
             sum(case when c.kind = 'sale' then l.base_qty else -l.base_qty end)::text as qty,
             sum(case when c.kind = 'sale' then l.total_minor - l.tax_minor else l.tax_minor - l.total_minor end)::text as sold,
             sum(c.cost_minor)::text as cost
      from movement_costs c
      join invoice_lines l on l.tenant_id = c.tenant_id and l.invoice_id = c.doc_id and l.line_no = c.line_no
      where c.business_date between ${query.from} and ${query.to}
        ${query.branchId ? sql`and c.branch_id = ${query.branchId}` : sql``}
      group by l.product_id
      having sum(case when c.kind = 'sale' then l.total_minor - l.tax_minor else l.tax_minor - l.total_minor end)
             < sum(c.cost_minor)
      order by sum(c.cost_minor) - sum(case when c.kind = 'sale' then l.total_minor - l.tax_minor else l.tax_minor - l.total_minor end) desc`);
    const belowCost = belowRows.slice(0, 100).map((r) => ({
      productId: r.product_id,
      name: r.name,
      qty: Number(r.qty),
      soldMinor: Number(r.sold),
      costMinor: Number(r.cost),
      lossMinor: Number(r.cost) - Number(r.sold),
    }));
    const net = Number(row?.net ?? 0);
    const cost = Number(row?.cost ?? 0);
    return {
      from: query.from,
      to: query.to,
      netSalesMinor: net,
      costOfSalesMinor: cost,
      grossProfitMinor: net - cost,
      stockLossMinor: Number(row?.loss ?? 0),
      belowCostCount: belowRows.length,
      belowCost,
      baseCurrency: await baseCurrency(tx),
    };
  });
}
