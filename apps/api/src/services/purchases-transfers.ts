import { inArray, sql } from 'drizzle-orm';
import {
  stockIn,
  stockOut,
  type TransferDetail,
  type TransferInput,
  type TransferListResponse,
  type TransferRow,
  type StockValue,
} from '@serva/core';
import { serials, transfers, withTenant, type Database, type Transaction } from '@serva/db';
import { inScope, requirePermission } from '../auth/permissions';
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
import { postEntry } from './posting';
import { recordBatchMovements, refreshBatches, takeBatches } from './batches';
import { outgoingSerials, relocateSerials } from './serials';
import { newId, invalid, baseCurrency, branchOf, nextNumber, stockedVariants } from './purchases-common';
import { moveStock } from './purchases-create';

/**
 * Whether a new transfer goes «بالطريق» (round 37, decision 16): when the request says so, or else by the
 * store's setting (auto: in transit when the store has more than one branch). Only a transfer between two
 * ordinary branches can be in transit: a van's loading and unloading, and the damaged location, stay instant
 * (the rep's settlement is its own confirmation).
 */
export async function sendsInTransit(
  tx: Transaction,
  mode: 'instant' | 'transit' | undefined,
  fromBranchId: string,
  toBranchId: string,
): Promise<boolean> {
  const kinds = await tx.execute<{ id: string; kind: string }>(
    sql`select id, kind from branches where id in (${fromBranchId}, ${toBranchId})`,
  );
  if (kinds.length < 2 || kinds.some((b) => b.kind !== 'store')) return false;
  if (mode) return mode === 'transit';
  return (await effectiveTransferMode(tx)) === 'transit';
}

/** The setting resolved: auto is in transit for a store with more than one ordinary branch */
export async function effectiveTransferMode(tx: Transaction): Promise<'instant' | 'transit'> {
  const [row] = await tx.execute<{ mode: string; stores: string }>(sql`
    select coalesce((select transfer_mode from tenant_settings limit 1), 'auto') as mode,
           (select count(*) from branches where kind = 'store' and is_active)::text as stores`);
  if (row?.mode === 'instant') return 'instant';
  if (row?.mode === 'transit') return 'transit';
  return Number(row?.stores ?? 0) > 1 ? 'transit' : 'instant';
}

/**
 * A transfer between branches (09 › transfers): every line out of the sender at its average cost
 * and into the receiver at that value, in one transaction. A line more than the sender has is
 * sent all the same (stock may go below nothing, as at the till) and costed as a sale would be.
 *
 * Round 37 (decision 16), sent «بالطريق»: only the sending half happens now (the stock and batches out, and
 * Dr 1900 / Cr 1300 at the sender); the serial numbers wait in transit. The receiving half (stock and batches
 * in, Dr 1300 / Cr 1900 at the receiver) happens when that branch confirms, in services/transfers.ts. The goods
 * on the way are in neither branch's stock, so each branch's stock still equals its movements and 1300.
 */
export async function createTransfer(
  db: Database,
  auth: AccessClaims,
  input: TransferInput,
  meta: RequestMeta,
): Promise<TransferDetail> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // The goods leave the sending branch: the right must hold THERE, not only somewhere
    const from = await branchOf(tx, input.fromBranchId);
    await requirePermission(tx, auth.userId, 'inventory.adjust', from);
    const to = await branchOf(tx, input.toBranchId);
    const inTransit = await sendsInTransit(tx, input.mode, from, to);
    if (inTransit) {
      // A transfer on the way keeps one line per item: the receipt confirms what arrived item by item
      const seen = new Set<string>();
      for (const [i, l] of input.lines.entries()) {
        if (seen.has(l.variantId))
          throw invalid({ [`lines.${i}.variantId`]: 'هذا الصنف مكرر في التحويل: اجمع كمياته في سطر واحد' });
        seen.add(l.variantId);
      }
    }
    const names = await stockedVariants(
      tx,
      input.lines.map((l) => l.variantId),
    );
    const missing = input.lines.findIndex((l) => !names.has(l.variantId));
    if (missing >= 0) throw invalid({ [`lines.${missing}.variantId`]: 'صنف غير موجود أو خدمة لا مخزون لها' });
    await costPending(tx, auth.tenantId);
    // A tracked product travels with its serial numbers, which move to the receiving branch
    const outgoing = await outgoingSerials(tx, from, input.lines);

    const keys: StockKey[] = input.lines.flatMap((l) => [
      stockKey(from, l.variantId),
      stockKey(to, l.variantId),
    ]);
    const values = await loadValues(tx, auth.tenantId, keys);
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    const lines: TransferDetail['lines'] = [];
    let costDiff = 0;
    if (input.strictStock) {
      // The screen asks for this: more than the sender holds is a typing slip, not a sale below nothing
      const asked = new Map<string, number>();
      for (const l of input.lines) asked.set(l.variantId, (asked.get(l.variantId) ?? 0) + l.qty);
      for (const [i, l] of input.lines.entries()) {
        const held = values.get(stockKey(from, l.variantId))?.qty ?? 0;
        if ((asked.get(l.variantId) ?? 0) > Math.max(0, held)) {
          throw invalid({
            [`lines.${i}.qty`]: `عند المرسِل ${Math.max(0, held) / 1000} فقط من هذا الصنف. اكتب كمية أقل`,
          });
        }
      }
    }
    for (const l of input.lines) {
      const outKey = stockKey(from, l.variantId);
      const inKey = stockKey(to, l.variantId);
      const out = stockOut(values.get(outKey) ?? empty, l.qty);
      values.set(outKey, out.after);
      if (!inTransit) {
        const into = stockIn(values.get(inKey) ?? empty, l.qty, Math.max(0, out.costMinor));
        values.set(inKey, into.after);
        costDiff += into.costMinor;
      }
      lines.push({
        variantId: l.variantId,
        name: names.get(l.variantId)!,
        qty: l.qty,
        valueMinor: out.costMinor,
      });
    }
    await saveValues(tx, auth.tenantId, values);

    const id = newId();
    const inId = newId();
    const number = await nextNumber(tx, auth.tenantId, 'TRF', input.date);
    const valueMinor = lines.reduce((sum, l) => sum + l.valueMinor, 0);
    await tx.insert(transfers).values({
      tenantId: auth.tenantId,
      id,
      inId,
      number,
      fromBranchId: from,
      toBranchId: to,
      businessDate: input.date,
      note: input.note ?? null,
      lines: inTransit ? await withSerialNumbers(tx, lines, outgoing) : lines,
      valueMinor,
      inTransit,
      createdBy: auth.userId,
    });
    if (inTransit) {
      // The pieces leave the sender's shelf and wait: nobody sells them until the receiver confirms
      if (outgoing.length > 0)
        await tx
          .update(serials)
          .set({ status: 'in_transit' })
          .where(inArray(serials.id, [...outgoing]));
    } else {
      await relocateSerials(tx, outgoing, to);
    }
    const moves = (sign: 1 | -1) =>
      input.lines.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, qty: sign * l.qty }));
    await moveStock(tx, auth.tenantId, from, id, 'transfer', input.date, moves(-1));
    if (!inTransit) await moveStock(tx, auth.tenantId, to, inId, 'transfer', input.date, moves(1));
    // The same batches leave the sender and arrive at the receiver (earliest expiry first when none is named)
    const sent = await takeBatches(
      tx,
      from,
      input.lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
      (i) => `lines.${i}.qty`,
    );
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId: from, kind: 'transfer_out', docId: id, date: input.date },
      sent.map((r) => ({ ...r, qty: -r.qty })),
    );
    if (!inTransit) {
      await recordBatchMovements(
        tx,
        { tenantId: auth.tenantId, branchId: to, kind: 'transfer_in', docId: inId, date: input.date },
        sent,
      );
    }
    await refreshBatches(
      tx,
      inTransit ? [from] : [from, to],
      input.lines.map((l) => l.variantId),
    );
    const currency = await baseCurrency(tx);
    const memo = `تحويل ${number}${input.note ? `: ${input.note}` : ''}`;
    // The sender: Dr 1900 / Cr 1300; the receiver: Dr 1300 / Cr 1900 (and what its oversold
    // pieces really cost against cost of sales, as a purchase does)
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: from,
      date: input.date,
      sourceType: 'transfer',
      sourceId: id,
      sourceNumber: number,
      memo,
      baseCurrency: currency,
      lines: costLines(valueMinor, currency, '1900'),
    });
    if (!inTransit) {
      await postEntry(tx, {
        tenantId: auth.tenantId,
        branchId: to,
        date: input.date,
        sourceType: 'transfer',
        sourceId: inId,
        sourceNumber: number,
        memo,
        baseCurrency: currency,
        lines: [
          ...costLines(-valueMinor, currency, '1900'),
          ...(costDiff !== 0 ? costLines(costDiff, currency) : []),
        ],
      });
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: inTransit ? 'transfer.send' : 'transfer.create',
        entity: 'transfer',
        entityId: id,
        changes: { number: [null, number], valueMinor: [null, valueMinor] },
      },
      meta,
    );
    return {
      id,
      number,
      date: input.date,
      fromBranchId: from,
      toBranchId: to,
      lines,
      valueMinor,
      baseCurrency: currency,
      status: inTransit ? 'in_transit' : 'received',
    };
  });
}

/** What the transfer keeps of each line's serial numbers while the goods are on the way */
async function withSerialNumbers(
  tx: Transaction,
  lines: TransferDetail['lines'],
  serialIds: readonly string[],
): Promise<TransferDetail['lines']> {
  if (serialIds.length === 0) return lines;
  const rows = await tx
    .select({ serial: serials.serial, variantId: serials.variantId })
    .from(serials)
    .where(inArray(serials.id, [...serialIds]));
  return lines.map((l) => {
    const own = rows.filter((r) => r.variantId === l.variantId).map((r) => r.serial);
    return own.length > 0 ? { ...l, serials: own } : l;
  });
}

export function listTransfers(
  db: Database,
  auth: AccessClaims,
  query: { limit?: number | undefined; cursor?: string | undefined } = {},
): Promise<TransferListResponse> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'inventory.adjust');
    // The page is the newest ones; every transfer still on the way is on the first page whatever its age, so one that
    // is old can still be received (round 44). The cursor is how many of the rest came before.
    const limit = query.limit ?? 50;
    const offset = /^o:\d{1,7}$/.test(query.cursor ?? '') ? Number(query.cursor!.slice(2)) : 0;
    const mine = scope.all
      ? sql``
      : sql`and (t.from_branch_id = any(${uuidArray([...scope.branchIds])}) or t.to_branch_id = any(${uuidArray([...scope.branchIds])}))`;
    const pending = sql`(t.in_transit and r.id is null)`;
    const pick = (where: ReturnType<typeof sql>, tail: ReturnType<typeof sql>) => sql`
      select t.id, t.number, t.business_date::text as date, f.name as from_name, d.name as to_name,
             coalesce((select sum((l ->> 'qty')::bigint) from jsonb_array_elements(t.lines) l), 0)::text as pieces,
             t.value_minor::text as value, t.from_branch_id as from_id, t.to_branch_id as to_id, t.in_transit,
             (r.id is not null) as received, (r.id is not null and r.branch_id = t.from_branch_id) as cancelled,
             coalesce(r.short_pieces, 0)::text as short
      from transfers t
      join branches f on f.id = t.from_branch_id
      join branches d on d.id = t.to_branch_id
      left join transfer_receipts r on r.tenant_id = t.tenant_id and r.transfer_id = t.id
      where ${where} ${mine}
      order by t.business_date desc, t.created_at desc ${tail}`;
    type Found = {
      id: string;
      number: string;
      date: string;
      from_name: string;
      to_name: string;
      pieces: string;
      value: string;
      from_id: string;
      to_id: string;
      in_transit: boolean;
      received: boolean;
      cancelled: boolean;
      short: string;
    };
    const waiting = offset === 0 ? await tx.execute<Found>(pick(pending, sql``)) : [];
    const rest = await tx.execute<Found>(pick(sql`not ${pending}`, sql`limit ${limit + 1} offset ${offset}`));
    const [count] = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from transfers t
      left join transfer_receipts r on r.tenant_id = t.tenant_id and r.transfer_id = t.id
      where ${pending} ${mine}`);
    const more = rest.length > limit;
    const row = (r: Found): TransferRow => {
      const onWay = r.in_transit && !r.received;
      return {
        id: r.id,
        number: r.number,
        date: r.date,
        fromBranch: r.from_name,
        toBranch: r.to_name,
        pieces: Number(r.pieces),
        valueMinor: Number(r.value),
        status: onWay ? 'in_transit' : r.cancelled ? 'cancelled' : 'received',
        fromBranchId: r.from_id,
        toBranchId: r.to_id,
        ...(Number(r.short) > 0 ? { shortPieces: Number(r.short) } : {}),
        canReceive: onWay && inScope(scope, r.to_id),
        canCancel: onWay && inScope(scope, r.from_id),
      };
    };
    return {
      items: [...waiting, ...rest.slice(0, limit)].map(row),
      nextCursor: more ? `o:${offset + limit}` : null,
      inTransit: Number(count?.n ?? 0),
    };
  });
}
