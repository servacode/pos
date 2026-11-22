import { sql } from 'drizzle-orm';
import {
  distributionSettingsOf,
  type CurrencyCode,
  type RepSettlementCreateInput,
  type RepSettlementDetail,
  type RepSettlementRow,
  type RepVanCountInput,
  type SettlementCashLine,
  type SettlementCheque,
  type SettlementGoods,
  type SettlementItem,
  type SettlementListQuery,
  type SettlementPreview,
  type SettlementRepDebt,
  type SettlementStatus,
  type SettlementTreatment,
  type VanCountRecord,
} from '@serva/core';
import { withTenant, type Database, type Transaction } from '@serva/db';
import type { DeviceClaims } from '../auth/device-guard';
import { inScope, permissionScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { staleVersion } from './catalog/common';
import { baseCurrencyOf } from './contracts-common';
import { createStocktake, createTransfer, nextNumber } from './purchases';
import { postRepShortage, repDebtBalance } from './rep-debt';
import { cashRefundDrawers } from './refund-drawers';
import { assertRepsEnabled } from './subscription-gate';

/**
 * «تسوية المندوب» (RST, packages/core › contracts/distribution-ops.ts). A settlement is a RECORD: it
 * reads what the rep's day produced (his shift drawer, the safe drops, the cheques, sales, returns,
 * receipts and the van count) and sets it beside what the supervisor counted. Nothing is posted by
 * it. Approving it settles the van through the two ordinary documents: the van count (a stocktake of
 * the van to the counted figures) and the unloading transfer (van to its home branch).
 *
 * One entry is posted at approval (round 35, D6): a cash shortage is moved off the cash-difference loss the
 * shift close booked onto the rep, as a debt in 1250 (services/rep-debt.ts), unless the supervisor chose
 * to leave it as the shop's loss.
 */

const notFound = (what = 'هذه التسوية') => new AppError(404, 'not_found', `${what} غير موجودة.`);
const conflict = (message: string) => new AppError(409, 'conflict', message);
const bad = (field: string, message: string) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { [field]: message });

const num = (v: string | number | null | undefined) => Number(v ?? 0);
const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

async function guard(tx: Transaction, auth: AccessClaims, permission: 'rep.settle'): Promise<void> {
  await requirePermission(tx, auth.userId, permission);
  await assertRepsEnabled(tx);
}

interface RepInfo {
  id: string;
  userId: string;
  name: string;
  branchId: string;
  vanBranchId: string | null;
  vanName: string | null;
  parentBranchId: string | null;
  parentName: string | null;
  deviceId: string | null;
}

async function repInfo(tx: Transaction, repId: string): Promise<RepInfo> {
  const [r] = await tx.execute<{
    id: string;
    user_id: string;
    name: string;
    branch_id: string;
    van_branch_id: string | null;
    van_name: string | null;
    parent_branch_id: string | null;
    parent_name: string | null;
    device_id: string | null;
  }>(sql`
    select r.id, r.user_id, u.full_name as name, r.branch_id, r.van_branch_id, v.name as van_name,
           v.parent_branch_id, pb.name as parent_name, r.device_id
    from sales_reps r
    join users u on u.tenant_id = r.tenant_id and u.id = r.user_id
    left join branches v on v.tenant_id = r.tenant_id and v.id = r.van_branch_id
    left join branches pb on pb.tenant_id = v.tenant_id and pb.id = v.parent_branch_id
    where r.id = ${repId}`);
  if (!r) throw notFound('هذا المندوب');
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    branchId: r.branch_id,
    vanBranchId: r.van_branch_id,
    vanName: r.van_name,
    parentBranchId: r.parent_branch_id,
    parentName: r.parent_name,
    deviceId: r.device_id,
  };
}

/** The shifts of the rep's van that belong to this business day (a close that came alone counts on its closing day) */
async function shiftsOf(tx: Transaction, vanBranchId: string | null, date: string) {
  if (!vanBranchId) return [];
  return tx.execute<{
    id: string;
    number: string | null;
    status: 'open' | 'closed';
    closed_at: string | null;
  }>(sql`
    select s.id, s.number, s.status, s.closed_at
    from shifts s
    where s.branch_id = ${vanBranchId}
      and coalesce(s.business_date,
            (select (s.closed_at at time zone t.timezone)::date from tenants t where t.id = s.tenant_id)) = ${date}::date
    order by coalesce(s.opened_at, s.closed_at), s.id`);
}

/** The drawer of each currency over these shifts, by the formula of the shift report (10 › مطابقة الصندوق) */
async function cashOf(tx: Transaction, shiftIds: string[]): Promise<SettlementCashLine[]> {
  if (shiftIds.length === 0) return [];
  const ids = uuidList(shiftIds);
  const opening = await tx.execute<{
    opening: { currency: CurrencyCode; amountMinor: number }[] | null;
    closing: { cash?: { currency: CurrencyCode; openingMinor: number; countedMinor: number }[] } | null;
  }>(sql`select opening, closing from shifts where id in (${ids})`);
  const flows = await tx.execute<{ currency: CurrencyCode; kind: string; amount: string }>(sql`
    select p.currency, 'cash_in' as kind, sum(p.amount_minor)::text as amount
    from invoice_payments p join invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
    where i.shift_id in (${ids}) and p.method = 'cash' group by p.currency
    union all
    select i.payload -> 'change' ->> 'currency', 'change', sum((i.payload -> 'change' ->> 'amountMinor')::bigint)::text
    from invoices i where i.shift_id in (${ids}) and jsonb_typeof(i.payload -> 'change') = 'object'
    group by i.payload -> 'change' ->> 'currency'
    union all
    select r.currency, 'receipt', sum(r.amount_minor)::text from receipts r
    where r.shift_id in (${ids}) and r.method = 'cash' group by r.currency
    union all
    select x.currency, 'refund', sum(x.amount)::text
    from (${cashRefundDrawers(sql`r.shift_id in (${ids})`)}) x group by x.currency
    union all
    select v.currency, 'receipt', sum(v.amount_minor)::text from vouchers v
    where v.shift_id in (${ids}) and v.kind in ('gift', 'deposit') and v.method = 'cash' group by v.currency
    union all
    select m.currency, m.kind, sum(m.amount_minor)::text from cash_movements m
    where m.shift_id in (${ids}) group by m.currency, m.kind`);

  const lines = new Map<CurrencyCode, SettlementCashLine>();
  const line = (currency: CurrencyCode) => {
    let l = lines.get(currency);
    if (!l) {
      l = {
        currency,
        openingMinor: 0,
        cashSalesMinor: 0,
        changeGivenMinor: 0,
        refundsMinor: 0,
        receiptsMinor: 0,
        payInMinor: 0,
        payOutMinor: 0,
        dropsMinor: 0,
        closingCountedMinor: null,
        expectedMinor: 0,
      };
      lines.set(currency, l);
    }
    return l;
  };
  for (const s of opening) {
    const start =
      s.opening ?? s.closing?.cash?.map((c) => ({ currency: c.currency, amountMinor: c.openingMinor }));
    for (const o of start ?? []) line(o.currency).openingMinor += o.amountMinor;
    for (const c of s.closing?.cash ?? []) {
      const l = line(c.currency);
      l.closingCountedMinor = (l.closingCountedMinor ?? 0) + c.countedMinor;
    }
  }
  for (const f of flows) {
    const l = line(f.currency);
    const amount = num(f.amount);
    if (f.kind === 'cash_in') l.cashSalesMinor += amount;
    else if (f.kind === 'change') l.changeGivenMinor += amount;
    else if (f.kind === 'refund') l.refundsMinor += amount;
    else if (f.kind === 'receipt') l.receiptsMinor += amount;
    else if (f.kind === 'pay_in') l.payInMinor += amount;
    else if (f.kind === 'pay_out' || f.kind === 'expense') l.payOutMinor += amount;
    else if (f.kind === 'safe_drop') l.dropsMinor += amount;
  }
  for (const l of lines.values()) {
    // What he should hand over in all: the drawer before any of it was dropped into the safe
    l.expectedMinor =
      l.openingMinor +
      l.cashSalesMinor -
      l.changeGivenMinor -
      l.refundsMinor +
      l.receiptsMinor +
      l.payInMinor -
      l.payOutMinor;
  }
  return [...lines.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

async function chequesOf(tx: Transaction, shiftIds: string[]): Promise<SettlementCheque[]> {
  if (shiftIds.length === 0) return [];
  const ids = uuidList(shiftIds);
  const rows = await tx.execute<{
    source_type: 'sale' | 'receipt';
    source_id: string;
    number: string;
    customer_name: string | null;
    amount: string;
    currency: CurrencyCode;
    reference: string | null;
    due_date: string | null;
  }>(sql`
    select 'sale' as source_type, i.id as source_id, i.number, coalesce(c.name, i.customer_name) as customer_name,
           p.amount_minor::text as amount, p.currency, p.reference,
           (select e->'cheque'->>'dueDate' from jsonb_array_elements(i.payload->'payments') e
             where (e->>'paymentNo')::int = p.payment_no limit 1) as due_date
    from invoice_payments p
    join invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
    left join customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
    where p.method = 'cheque' and i.shift_id in (${ids})
    union all
    select 'receipt', r.id, r.number, coalesce(c.name, r.payload->>'customerName'), r.amount_minor::text,
           r.currency, r.reference, r.payload->'cheque'->>'dueDate'
    from receipts r
    left join customers c on c.tenant_id = r.tenant_id and c.id = r.customer_id
    where r.method = 'cheque' and r.shift_id in (${ids})
    order by 3`);
  return rows.map((r) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    number: r.number,
    customerName: r.customer_name,
    amountMinor: num(r.amount),
    currency: r.currency,
    reference: r.reference,
    dueDate: r.due_date,
  }));
}

async function itemsOf(
  tx: Transaction,
  vanBranchId: string | null,
  counts: Map<string, number> | null,
): Promise<SettlementItem[]> {
  if (!vanBranchId) return [];
  const book = await tx.execute<{ variant_id: string; qty: string }>(sql`
    select variant_id, qty::text from stock_levels where branch_id = ${vanBranchId} and qty <> 0`);
  const expected = new Map(book.map((b) => [b.variant_id, num(b.qty)]));
  const ids = [...new Set([...expected.keys(), ...(counts?.keys() ?? [])])];
  if (ids.length === 0) return [];
  const names = await tx.execute<{ id: string; name: string }>(sql`
    select v.id, trim(p.name_ar || ' ' || coalesce(v.label, '')) as name
    from variants v join products p on p.tenant_id = v.tenant_id and p.id = v.product_id
    where v.id in (${uuidList(ids)}) and p.type = 'stock'`);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return ids
    .filter((id) => nameOf.has(id))
    .map((id) => {
      const counted = counts?.has(id) ? counts.get(id)! : null;
      const was = expected.get(id) ?? 0;
      return {
        variantId: id,
        name: nameOf.get(id)!,
        expectedQty: was,
        countedQty: counted,
        diffQty: counted === null ? null : counted - was,
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** The settlement that already covers this rep and day (a cancelled one does not) */
async function existingOf(tx: Transaction, repId: string, date: string) {
  const [e] = await tx.execute<{ id: string; number: string; status: SettlementStatus }>(sql`
    select id, number, status from rep_settlements
    where rep_id = ${repId} and business_date = ${date}::date and status <> 'cancelled' limit 1`);
  return e ?? null;
}

async function buildPreview(
  tx: Transaction,
  tenantId: string,
  rep: RepInfo,
  date: string,
  override: RepSettlementCreateInput['vanCount'],
): Promise<SettlementPreview> {
  const shifts = await shiftsOf(tx, rep.vanBranchId, date);
  const shiftIds = shifts.map((s) => s.id);
  const cash = await cashOf(tx, shiftIds);
  const ids = shiftIds.length > 0 ? uuidList(shiftIds) : sql`null::uuid`;
  const [sales] = await tx.execute<{ n: string; total: string }>(
    sql`select count(*)::text as n, coalesce(sum(total_minor), 0)::text as total from invoices where shift_id in (${ids})`,
  );
  const [returns] = await tx.execute<{ n: string; total: string }>(
    sql`select count(*)::text as n, coalesce(sum(total_minor), 0)::text as total from sale_returns where shift_id in (${ids})`,
  );
  const [receipts] = await tx.execute<{ n: string }>(
    sql`select count(*)::text as n from receipts where shift_id in (${ids})`,
  );
  const [visits] = await tx.execute<{ n: string }>(sql`
    select count(*)::text as n from rep_visits v join rep_days d on d.tenant_id = v.tenant_id and d.id = v.rep_day_id
    where v.rep_id = ${rep.id} and d.business_date = ${date}::date`);
  const [day] = await tx.execute<{ van_count: VanCountRecord | null }>(
    sql`select van_count from rep_days where rep_id = ${rep.id} and business_date = ${date}::date`,
  );
  const phoneCount = day?.van_count ?? null;
  let counts: Map<string, number> | null = null;
  let countedAt: string | null = null;
  if (override) {
    counts = new Map(override.map((l) => [l.variantId, l.countedQty]));
    countedAt = new Date().toISOString();
  } else if (phoneCount) {
    counts = new Map(phoneCount.lines.map((l) => [l.variantId, num(l.counted)]));
    countedAt = phoneCount.at;
  }
  const [device] = await tx.execute<{ unsent: number | null }>(sql`
    select unsent_count as unsent from devices
    where kind = 'rep_phone' and (id = ${rep.deviceId}::uuid or branch_id = ${rep.vanBranchId}::uuid)
    order by (id = ${rep.deviceId}::uuid) desc nulls last, last_heartbeat_at desc nulls last limit 1`);
  const [settingsRow] = await tx.execute<{ distribution: Record<string, unknown> | null }>(
    sql`select distribution from tenant_settings where tenant_id = ${tenantId}`,
  );
  const existing = await existingOf(tx, rep.id, date);
  return {
    repId: rep.id,
    repName: rep.name,
    businessDate: date,
    branchId: rep.branchId,
    vanBranchId: rep.vanBranchId,
    vanName: rep.vanName,
    unloadBranchId: rep.parentBranchId,
    unloadBranchName: rep.parentName,
    baseCurrency: await baseCurrencyOf(tx, tenantId),
    shifts: shifts.map((s) => ({
      id: s.id,
      number: s.number,
      status: s.status,
      closedAt: iso(s.closed_at),
    })),
    cash,
    sales: {
      count: num(sales?.n),
      totalMinor: num(sales?.total),
      returnsCount: num(returns?.n),
      returnsTotalMinor: num(returns?.total),
      receiptsCount: num(receipts?.n),
      visits: num(visits?.n),
    },
    cheques: await chequesOf(tx, shiftIds),
    items: await itemsOf(tx, rep.vanBranchId, counts),
    vanCountAt: countedAt,
    pendingDocs: device?.unsent ?? 0,
    keepStockInVan: distributionSettingsOf(settingsRow?.distribution).keepStockInVanOvernight,
    existing,
    repDebtMinor: await repDebtBalance(tx, rep.userId),
  };
}

/** GET /v1/rep-settlements/preview?repId&date */
export function previewSettlement(
  db: Database,
  auth: AccessClaims,
  query: { repId: string; date: string },
): Promise<SettlementPreview> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth, 'rep.settle');
    const rep = await repInfo(tx, query.repId);
    await requirePermission(tx, auth.userId, 'rep.settle', rep.branchId);
    return buildPreview(tx, auth.tenantId, rep, query.date, undefined);
  });
}

// ─── The record ─────────────────────────────────────────────────────────────

type Row = {
  id: string;
  number: string;
  rep_id: string;
  rep_name: string;
  branch_id: string;
  business_date: string;
  status: SettlementStatus;
  expected_cash: Record<string, number> | null;
  counted_cash: Record<string, number> | null;
  cash_difference: Record<string, number> | null;
  cheques: { received?: string[] } | null;
  goods_difference: (SettlementGoods & { claimedAt?: string }) | null;
  treatment: SettlementTreatment | null;
  rep_debt: SettlementRepDebt | null;
  pending_docs: number;
  approved_at: string | null;
  approved_by_name: string | null;
  created_by_name: string | null;
  note: string | null;
  snapshot: SettlementPreview | null;
  version: number;
};

const select = sql`
  select s.id, s.number, s.rep_id, ru.full_name as rep_name, s.branch_id, s.business_date::text as business_date,
         s.status, s.expected_cash, s.counted_cash, s.cash_difference, s.cheques, s.goods_difference, s.treatment,
         s.rep_debt, s.pending_docs, s.approved_at, au.full_name as approved_by_name, cu.full_name as created_by_name, s.note,
         s.snapshot, s.version
  from rep_settlements s
  join sales_reps r on r.tenant_id = s.tenant_id and r.id = s.rep_id
  join users ru on ru.tenant_id = r.tenant_id and ru.id = r.user_id
  left join users au on au.tenant_id = s.tenant_id and au.id = s.approved_by
  left join users cu on cu.tenant_id = s.tenant_id and cu.id = s.created_by`;

const rowOf = (r: Row): RepSettlementRow => ({
  id: r.id,
  number: r.number,
  repId: r.rep_id,
  repName: r.rep_name,
  businessDate: r.business_date,
  status: r.status,
  expectedCash: r.expected_cash ?? {},
  countedCash: r.counted_cash ?? {},
  cashDifference: r.cash_difference ?? {},
  treatment: r.treatment,
  pendingDocs: r.pending_docs,
  approvedAt: iso(r.approved_at),
  note: r.note,
  version: r.version,
});

function detailOf(r: Row): RepSettlementDetail {
  const preview = r.snapshot!;
  const received = new Set(r.cheques?.received ?? []);
  const goods = r.goods_difference;
  return {
    ...rowOf(r),
    approvedByName: r.approved_by_name,
    createdByName: r.created_by_name,
    preview,
    cheques: {
      received: [...received],
      unmatched: preview.cheques.filter((c) => !received.has(c.sourceId)),
    },
    goods: {
      counted: goods?.counted ?? false,
      stocktakeId: goods?.stocktakeId ?? null,
      stocktakeNumber: goods?.stocktakeNumber ?? null,
      transferId: goods?.transferId ?? null,
      transferNumber: goods?.transferNumber ?? null,
      lines: goods?.lines ?? [],
    },
    repDebt: r.rep_debt ?? null,
  };
}

async function readRow(tx: Transaction, auth: AccessClaims, id: string): Promise<Row> {
  const [row] = await tx.execute<Row>(sql`${select} where s.id = ${id}`);
  if (!row) throw notFound();
  await requirePermission(tx, auth.userId, 'rep.settle', row.branch_id);
  return row;
}

/** GET /v1/rep-settlements */
export function listSettlements(
  db: Database,
  auth: AccessClaims,
  query: SettlementListQuery,
): Promise<RepSettlementRow[]> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth, 'rep.settle');
    const where = [
      query.repId ? sql`s.rep_id = ${query.repId}` : sql`true`,
      query.status ? sql`s.status = ${query.status}` : sql`true`,
      query.from ? sql`s.business_date >= ${query.from}::date` : sql`true`,
      query.to ? sql`s.business_date <= ${query.to}::date` : sql`true`,
    ];
    const rows = await tx.execute<Row>(
      sql`${select} where ${sql.join(where, sql` and `)} order by s.business_date desc, s.created_at desc limit 300`,
    );
    const scope = await permissionScope(tx, auth.userId, 'rep.settle');
    return rows.filter((r) => inScope(scope, r.branch_id)).map(rowOf);
  });
}

/** GET /v1/rep-settlements/{id} */
export function getSettlement(db: Database, auth: AccessClaims, id: string): Promise<RepSettlementDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth, 'rep.settle');
    return detailOf(await readRow(tx, auth, id));
  });
}

/** POST /v1/rep-settlements: records the settlement as a draft (nothing posted, nothing moved) */
export function createSettlement(
  db: Database,
  auth: AccessClaims,
  input: RepSettlementCreateInput,
  meta: RequestMeta,
): Promise<RepSettlementDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth, 'rep.settle');
    const rep = await repInfo(tx, input.repId);
    await requirePermission(tx, auth.userId, 'rep.settle', rep.branchId);
    // One settlement per rep and day: the numbers are taken under a lock so two screens cannot both make it
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rep_settlement'), hashtext(${input.repId}))`);
    if (await existingOf(tx, rep.id, input.businessDate)) {
      throw conflict('لهذا المندوب تسوية في هذا اليوم. ألغِ المسودة ثم أنشئ غيرها.');
    }
    const preview = await buildPreview(tx, auth.tenantId, rep, input.businessDate, input.vanCount);
    const expected: Record<string, number> = {};
    for (const c of preview.cash) expected[c.currency] = c.expectedMinor;
    const difference: Record<string, number> = {};
    for (const currency of new Set([...Object.keys(expected), ...Object.keys(input.countedCash)])) {
      difference[currency] = (input.countedCash[currency] ?? 0) - (expected[currency] ?? 0);
    }
    const known = new Set(preview.cheques.map((c) => c.sourceId));
    const unknown = (input.receivedCheques ?? []).find((c) => !known.has(c));
    if (unknown) throw bad('receivedCheques', 'شيك ليس من شيكات هذا اليوم');
    const goods: SettlementGoods = {
      counted: preview.vanCountAt !== null && preview.items.some((i) => i.countedQty !== null),
      stocktakeId: null,
      stocktakeNumber: null,
      transferId: null,
      transferNumber: null,
      lines: preview.items,
    };
    const number = await nextNumber(tx, auth.tenantId, 'RST', input.businessDate);
    const [made] = await tx.execute<{ id: string }>(sql`
      insert into rep_settlements (tenant_id, number, rep_id, branch_id, business_date, status, expected_cash,
        counted_cash, cash_difference, cheques, goods_difference, treatment, pending_docs, snapshot, note, created_by)
      values (${auth.tenantId}, ${number}, ${rep.id}, ${rep.branchId}, ${input.businessDate}::date, 'draft',
        ${JSON.stringify(expected)}::jsonb, ${JSON.stringify(input.countedCash)}::jsonb,
        ${JSON.stringify(difference)}::jsonb, ${JSON.stringify({ received: input.receivedCheques ?? [] })}::jsonb,
        ${JSON.stringify(goods)}::jsonb, ${input.treatment ?? null}, ${preview.pendingDocs},
        ${JSON.stringify(preview)}::jsonb, ${input.note ?? null}, ${auth.userId})
      returning id`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep_settlement.create',
        entity: 'rep_settlement',
        entityId: made!.id,
        changes: { number: [null, number], cashDifference: [null, difference] },
      },
      meta,
    );
    return detailOf(await readRow(tx, auth, made!.id));
  });
}

/** POST /v1/rep-settlements/{id}/cancel: a draft only; an approved one has already moved the van's stock */
export function cancelSettlement(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: { version: number; reason: string },
  meta: RequestMeta,
): Promise<RepSettlementDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth, 'rep.settle');
    const row = await readRow(tx, auth, id);
    if (row.version !== input.version) throw staleVersion();
    if (row.status !== 'draft')
      throw conflict('لا تُلغى إلا المسودة. التسوية المعتمدة نُفّذ جردها وتحويلها.');
    await tx.execute(sql`
      update rep_settlements set status = 'cancelled', note = ${input.reason}, version = version + 1, updated_at = now()
      where id = ${id}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'rep_settlement.cancel',
        entity: 'rep_settlement',
        entityId: id,
        reason: input.reason,
      },
      meta,
    );
    return detailOf(await readRow(tx, auth, id));
  });
}

const withoutClaim = (goods: SettlementGoods): SettlementGoods => {
  const { claimedAt: _claimedAt, ...rest } = goods as SettlementGoods & { claimedAt?: string };
  return rest;
};

/**
 * POST /v1/rep-settlements/{id}/approve. Nothing is posted by the settlement; this settles the van
 * through the ordinary documents: the van count (stocktake of the van to the counted figures), then
 * the unloading transfer of what was counted to the van's home branch (not when the store keeps stock
 * in the van overnight). Each step is saved as it is done, so an approval that stopped half way
 * continues from there and never makes a document twice.
 */
export async function approveSettlement(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: { version: number },
  meta: RequestMeta,
): Promise<RepSettlementDetail> {
  // 1. Claim it: only one approval works at a time (a claim older than two minutes is a crashed one)
  const claimed = await withTenant(db, auth.tenantId, async (tx) => {
    await guard(tx, auth, 'rep.settle');
    const row = await readRow(tx, auth, id);
    if (row.version !== input.version) throw staleVersion();
    if (row.status !== 'draft') throw conflict('هذه التسوية ليست مسودة.');
    const [taken] = await tx.execute<{ id: string }>(sql`
      update rep_settlements
      set goods_difference = coalesce(goods_difference, '{}'::jsonb) || jsonb_build_object('claimedAt', now()::text)
      where id = ${id} and status = 'draft'
        and (goods_difference ->> 'claimedAt' is null
             or (goods_difference ->> 'claimedAt')::timestamptz < now() - interval '2 minutes')
      returning id`);
    if (!taken) throw conflict('تُعتمد هذه التسوية الآن من شاشة أخرى.');
    return row;
  });

  const goods: SettlementGoods = {
    counted: false,
    stocktakeId: null,
    stocktakeNumber: null,
    transferId: null,
    transferNumber: null,
    lines: [],
    ...claimed.goods_difference,
  };
  const preview = claimed.snapshot!;
  const save = (patch: Partial<SettlementGoods>) =>
    withTenant(db, auth.tenantId, async (tx) => {
      Object.assign(goods, patch);
      await tx.execute(sql`
        update rep_settlements set goods_difference = ${JSON.stringify(withoutClaim(goods))}::jsonb || jsonb_build_object('claimedAt', now()::text)
        where id = ${id}`);
    });
  try {
    const van = preview.vanBranchId;
    const counted = goods.lines.filter((l) => l.countedQty !== null);
    if (goods.counted && van && counted.length > 0) {
      if (!goods.stocktakeId) {
        const made = await createStocktake(
          db,
          auth,
          {
            branchId: van,
            date: claimed.business_date,
            note: `تسوية المندوب ${claimed.number}`,
            lines: counted.map((l) => ({ variantId: l.variantId, countedQty: l.countedQty! })),
          },
          meta,
          { lenientSerials: true },
        );
        await save({ stocktakeId: made.id, stocktakeNumber: made.number });
      }
      const toSend = counted.filter((l) => l.countedQty! > 0);
      if (!goods.transferId && !preview.keepStockInVan && preview.unloadBranchId && toSend.length > 0) {
        const made = await createTransfer(
          db,
          auth,
          {
            fromBranchId: van,
            toBranchId: preview.unloadBranchId,
            date: claimed.business_date,
            note: `تفريغ سيارة المندوب ${claimed.number}`,
            lines: toSend.map((l) => ({ variantId: l.variantId, qty: l.countedQty! })),
          },
          meta,
        );
        await save({ transferId: made.id, transferNumber: made.number });
      }
    }
    return await withTenant(db, auth.tenantId, async (tx) => {
      // A shortage the supervisor counted becomes the rep's debt, unless he chose to leave it as the shop's loss
      const debt =
        claimed.treatment === 'shop_loss'
          ? null
          : await postRepShortage(tx, {
              tenantId: auth.tenantId,
              settlementId: id,
              settlementNumber: claimed.number,
              businessDate: claimed.business_date,
              branchId: preview.vanBranchId ?? claimed.branch_id,
              repUserId: (await repInfo(tx, claimed.rep_id)).userId,
              shiftIds: preview.shifts.map((s) => s.id),
              cashDifference: claimed.cash_difference ?? {},
              baseCurrency: preview.baseCurrency,
            });
      await tx.execute(sql`
        update rep_settlements
        set status = 'approved', approved_by = ${auth.userId}, approved_at = now(), version = version + 1,
            updated_at = now(), goods_difference = ${JSON.stringify(withoutClaim(goods))}::jsonb,
            rep_debt = ${debt ? JSON.stringify(debt) : null}::jsonb
        where id = ${id} and status = 'draft'`);
      // The rep's day keeps the two documents it ended with
      await tx.execute(sql`
        update rep_days set stocktake_id = ${goods.stocktakeId}::uuid, unload_transfer_id = ${goods.transferId}::uuid,
          status = 'closed', ended_at = coalesce(ended_at, now()), updated_at = now()
        where rep_id = ${claimed.rep_id} and business_date = ${claimed.business_date}::date`);
      await audit(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: 'rep_settlement.approve',
          entity: 'rep_settlement',
          entityId: id,
          changes: {
            status: ['draft', 'approved'],
            stocktake: [null, goods.stocktakeNumber],
            transfer: [null, goods.transferNumber],
          },
        },
        meta,
      );
      return detailOf(await readRow(tx, auth, id));
    });
  } catch (error) {
    // Release the claim so the supervisor can try again at once (what was done stays saved)
    await withTenant(db, auth.tenantId, async (tx) => {
      await tx.execute(sql`
        update rep_settlements set goods_difference = goods_difference - 'claimedAt' where id = ${id} and status = 'draft'`);
    }).catch(() => undefined);
    throw error;
  }
}

// ─── The rep's phone sends its blind van count ──────────────────────────────

/** POST /v1/device/rep/van-count: the count is kept on the rep's day; sent again it replaces the last one of that day */
export function saveVanCount(
  db: Database,
  device: DeviceClaims,
  input: RepVanCountInput,
): Promise<{ id: string }> {
  return withTenant(db, device.tenantId, async (tx) => {
    await assertRepsEnabled(tx);
    const [d] = await tx.execute<{ kind: string }>(
      sql`select kind from devices where id = ${device.deviceId}`,
    );
    if (d?.kind !== 'rep_phone') throw new AppError(403, 'forbidden', 'هذا الجهاز ليس هاتف مندوب.');
    const [rep] = await tx.execute<{ id: string }>(sql`
      select id from sales_reps where van_branch_id = ${device.branchId} and status = 'active'`);
    if (!rep) throw new AppError(403, 'forbidden', 'لا مندوب فعّال على سيارة هذا الجهاز.');
    const variants = [...new Set(input.lines.map((l) => l.variantId))];
    if (variants.length > 0) {
      const found = await tx.execute<{ id: string }>(
        sql`select id from variants where id in (${uuidList(variants)})`,
      );
      if (found.length !== variants.length) throw bad('lines', 'صنف غير موجود');
    }
    const record: VanCountRecord = {
      at: new Date().toISOString(),
      lines: input.lines.map((l) => ({ variantId: l.variantId, counted: l.counted })),
    };
    const [made] = await tx.execute<{ id: string; status: string }>(sql`
      insert into rep_days (tenant_id, rep_id, business_date, status, started_at, van_count)
      values (${device.tenantId}, ${rep.id}, ${input.businessDate}::date, 'open', now(), ${JSON.stringify(record)}::jsonb)
      on conflict (tenant_id, rep_id, business_date) do update
        set van_count = excluded.van_count, updated_at = now()
      returning id, status`);
    return { id: made!.id };
  });
}
