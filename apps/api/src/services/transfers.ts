import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  businessDateOf,
  stockIn,
  type StockValue,
  type TransferFull,
  type TransferCancelInput,
  type TransferFullLine,
  type TransferReceiveInput,
  type TransferSettings,
  type TransferSettingsInput,
} from '@serva/core';
import {
  serials,
  stockLevels,
  transferReceipts,
  transfers,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import { inScope, requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { recordBatchMovements, refreshBatches } from './batches';
import { costLines, loadValues, saveValues, stockKey } from './costing';
import { postEntry } from './posting';
import { baseCurrency, createStocktakeIn, effectiveTransferMode, invalid, moveStock } from './purchases';

/**
 * Transfers «بالطريق» (round 37, decision 16). Sending is in services/purchases.ts › createTransfer: the goods
 * leave the sender and wait. Here the receiving branch confirms them:
 *
 * - everything that was sent enters the receiver at the value it left the sender with (Dr 1300 / Cr 1900 at the
 *   receiver), its batches and serial numbers with it, as an instant transfer would have;
 * - what arrived short is then written off at the receiver through the ordinary stocktake, with its reason
 *   (Dr 6300 / Cr 1300), so a shortage is an adjustment like any other and is counted, audited and reported there;
 * - a transfer is received once; more than was sent is refused (a surplus is a stocktake).
 *
 * While the goods are on the way they are in no branch's stock, and the sender's entry (Dr 1900 / Cr 1300) is
 * the only one: account 1900 holds exactly the value on the way.
 */

const newId = createUuidV7();
const conflict = (message: string) => new AppError(409, 'conflict', message);
const notFound = () => new AppError(404, 'not_found', 'هذا التحويل غير موجود.');

interface StoredLine {
  variantId: string;
  name: string;
  qty: number;
  valueMinor: number;
  serials?: string[];
}
interface ReceiptLine {
  variantId: string;
  name: string;
  sentQty: number;
  receivedQty: number;
  shortQty: number;
  serials?: string[];
}

// ─── The store's setting ─────────────────────────────────────────────────────

export function transferSettings(db: Database, auth: AccessClaims): Promise<TransferSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'inventory.adjust');
    return readSettings(tx);
  });
}

async function readSettings(tx: Transaction): Promise<TransferSettings> {
  const [row] = await tx.execute<{ mode: string }>(
    sql`select transfer_mode as mode from tenant_settings limit 1`,
  );
  const mode = row?.mode === 'instant' || row?.mode === 'transit' ? row.mode : 'auto';
  return { mode, effective: await effectiveTransferMode(tx) };
}

export function saveTransferSettings(
  db: Database,
  auth: AccessClaims,
  input: TransferSettingsInput,
  meta: RequestMeta,
): Promise<TransferSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const before = await readSettings(tx);
    await tx.execute(sql`update tenant_settings set transfer_mode = ${input.mode}`);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'transfer.mode',
        entity: 'tenant_settings',
        entityId: auth.tenantId,
        changes: { mode: [before.mode, input.mode] },
      },
      meta,
    );
    return readSettings(tx);
  });
}

/** A transfer cancelled while on the way is closed by a receipt at the SENDER: the goods came back to where they left */
export const cancelledReceipt = (t: { fromBranchId: string }, receipt: { branchId: string }): boolean =>
  receipt.branchId === t.fromBranchId;

// ─── Reading one transfer ────────────────────────────────────────────────────

export function readTransfer(db: Database, auth: AccessClaims, id: string): Promise<TransferFull> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const scope = await requirePermission(tx, auth.userId, 'inventory.adjust');
    const done = await full(tx, id);
    // A branch-scoped manager reads the transfers of his own branches only
    if (!inScope(scope, done.fromBranchId) && !inScope(scope, done.toBranchId)) throw notFound();
    return done;
  });
}

async function full(tx: Transaction, id: string): Promise<TransferFull> {
  const [t] = await tx.select().from(transfers).where(eq(transfers.id, id));
  if (!t) throw notFound();
  const [names] = await tx.execute<{ from_name: string; to_name: string }>(sql`
    select f.name as from_name, d.name as to_name from branches f, branches d
    where f.id = ${t.fromBranchId} and d.id = ${t.toBranchId}`);
  const [receipt] = await tx.select().from(transferReceipts).where(eq(transferReceipts.transferId, id));
  const stored = t.lines as StoredLine[];
  const got = new Map(((receipt?.lines ?? []) as ReceiptLine[]).map((l) => [l.variantId, l]));
  const lines: TransferFullLine[] = stored.map((l) => {
    const r = got.get(l.variantId);
    return {
      variantId: l.variantId,
      name: l.name,
      qty: l.qty,
      valueMinor: l.valueMinor,
      // An instant transfer arrived whole
      receivedQty: receipt
        ? cancelledReceipt(t, receipt)
          ? null
          : (r?.receivedQty ?? l.qty)
        : t.inTransit
          ? null
          : l.qty,
      shortQty: r?.shortQty ?? 0,
      ...(l.serials ? { serials: l.serials } : {}),
    };
  });
  let stocktakeNumber: string | null = null;
  if (receipt?.stocktakeId) {
    const [st] = await tx.execute<{ number: string }>(
      sql`select number from stocktakes where id = ${receipt.stocktakeId}`,
    );
    stocktakeNumber = st?.number ?? null;
  }
  return {
    id: t.id,
    number: t.number,
    date: t.businessDate,
    fromBranchId: t.fromBranchId,
    toBranchId: t.toBranchId,
    fromBranch: names?.from_name ?? '',
    toBranch: names?.to_name ?? '',
    status: !receipt
      ? t.inTransit
        ? 'in_transit'
        : 'received'
      : cancelledReceipt(t, receipt)
        ? 'cancelled'
        : 'received',
    note: t.note,
    lines,
    valueMinor: t.valueMinor,
    baseCurrency: await baseCurrency(tx),
    receipt: receipt
      ? {
          date: receipt.businessDate,
          shortPieces: receipt.shortPieces,
          shortValueMinor: receipt.shortValueMinor,
          reason: receipt.reason,
          stocktakeNumber,
        }
      : null,
  };
}

// ─── Confirming what arrived ─────────────────────────────────────────────────

export async function receiveTransfer(
  db: Database,
  auth: AccessClaims,
  transferId: string,
  input: TransferReceiveInput,
  meta: RequestMeta,
  now: Date,
): Promise<TransferFull> {
  return withTenant(db, auth.tenantId, async (tx) => {
    const [t] = await tx.select().from(transfers).where(eq(transfers.id, transferId));
    if (!t) throw notFound();
    // The branch that receives is the one whose permission counts
    await requirePermission(tx, auth.userId, 'inventory.adjust', t.toBranchId);
    if (!t.inTransit) throw conflict('هذا التحويل تمّ في خطوة واحدة، لا يحتاج استلاماً.');
    const [done] = await tx
      .select({ id: transferReceipts.id })
      .from(transferReceipts)
      .where(eq(transferReceipts.transferId, transferId));
    if (done) throw conflict('استُلم هذا التحويل من قبل.');

    const sent = t.lines as StoredLine[];
    const zone = await tx.execute<{ timezone: string }>(
      sql`select timezone from tenants where id = ${auth.tenantId}`,
    );
    const date = input.date ?? businessDateOf(now, zone[0]?.timezone ?? 'Asia/Damascus');
    if (date < t.businessDate) throw invalid({ date: 'تاريخ الاستلام قبل تاريخ إرسال التحويل' });

    // What arrived: nothing said means all of it
    const said = new Map<string, { receivedQty: number; serials?: string[] | undefined }>();
    for (const [i, l] of (input.lines ?? []).entries()) {
      if (!sent.some((s) => s.variantId === l.variantId) || said.has(l.variantId)) {
        throw invalid({ [`lines.${i}.variantId`]: 'هذا الصنف ليس في التحويل أو مكرر' });
      }
      said.set(l.variantId, l);
    }
    if (input.lines && said.size !== sent.length) {
      throw invalid({ lines: 'اكتب الكمية المستلمة لكل صنف في التحويل' });
    }
    const lines: ReceiptLine[] = [];
    for (const [i, s] of sent.entries()) {
      const got = said.get(s.variantId);
      const receivedQty = got ? got.receivedQty : s.qty;
      if (receivedQty > s.qty) {
        throw invalid({
          [`lines.${i}.receivedQty`]: 'لا يُستلم أكثر مما أُرسل. إن وجدت زيادة فسجّلها في الجرد',
        });
      }
      let arrived: string[] | undefined;
      if (s.serials && s.serials.length > 0) {
        arrived = got?.serials ?? (receivedQty === s.qty ? s.serials : undefined);
        const own = new Set(s.serials);
        if (
          !arrived ||
          arrived.length * 1000 !== receivedQty ||
          new Set(arrived).size !== arrived.length ||
          arrived.some((x) => !own.has(x))
        ) {
          throw invalid({
            [`lines.${i}.serials`]: `اكتب الأرقام التسلسلية للقطع التي وصلت (${receivedQty / 1000}) من أرقام التحويل`,
          });
        }
      }
      lines.push({
        variantId: s.variantId,
        name: s.name,
        sentQty: s.qty,
        receivedQty,
        shortQty: s.qty - receivedQty,
        ...(arrived ? { serials: arrived } : {}),
      });
    }
    const shorts = lines.filter((l) => l.shortQty > 0);
    const reason = input.reason?.trim() || null;
    if (shorts.length > 0 && (!reason || reason.length < 2)) {
      throw invalid({ reason: 'اكتب سبب النقص: ضاع، تالف، أو عدّ خاطئ' });
    }

    // Everything that was sent comes in at the value it left with
    const receiver = t.toBranchId;
    const values = await loadValues(
      tx,
      auth.tenantId,
      sent.map((l) => stockKey(receiver, l.variantId)),
    );
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    let costDiff = 0;
    for (const l of sent) {
      const key = stockKey(receiver, l.variantId);
      const into = stockIn(values.get(key) ?? empty, l.qty, Math.max(0, l.valueMinor));
      values.set(key, into.after);
      costDiff += into.costMinor;
    }
    await saveValues(tx, auth.tenantId, values);

    await moveStock(
      tx,
      auth.tenantId,
      receiver,
      t.inId,
      'transfer',
      date,
      sent.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, qty: l.qty })),
    );
    // The batches that left arrive
    const left = await tx.execute<{
      variant_id: string;
      batch_no: string;
      expiry: string | null;
      qty: string;
      line_no: number;
      alloc_no: number;
    }>(sql`
      select variant_id, batch_no, expiry_date::text as expiry, (-qty)::text as qty, line_no, alloc_no
      from batch_movements where kind = 'transfer_out' and doc_id = ${transferId}`);
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId: receiver, kind: 'transfer_in', docId: t.inId, date },
      left.map((r) => ({
        variantId: r.variant_id,
        batchNo: r.batch_no === '' ? null : r.batch_no,
        expiry: r.expiry,
        qty: Number(r.qty),
        lineNo: r.line_no,
        allocNo: r.alloc_no,
      })),
    );
    await refreshBatches(
      tx,
      [receiver],
      sent.map((l) => l.variantId),
    );

    // The serial numbers: those that arrived are on the receiver's shelf, the rest are lost
    const wanted = sent.flatMap((l) => l.serials ?? []);
    if (wanted.length > 0) {
      const arrivedNumbers = lines.flatMap((l) => l.serials ?? []);
      if (arrivedNumbers.length > 0) {
        await tx
          .update(serials)
          .set({ status: 'in_stock', branchId: receiver })
          .where(and(inArray(serials.serial, arrivedNumbers), eq(serials.status, 'in_transit')));
      }
      const missing = wanted.filter((x) => !arrivedNumbers.includes(x));
      if (missing.length > 0) {
        await tx
          .update(serials)
          .set({ status: 'lost' })
          .where(and(inArray(serials.serial, missing), eq(serials.status, 'in_transit')));
      }
    }

    const currency = await baseCurrency(tx);
    const valueMinor = sent.reduce((sum, l) => sum + l.valueMinor, 0);
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: receiver,
      date,
      sourceType: 'transfer',
      sourceId: t.inId,
      sourceNumber: t.number,
      memo: `استلام تحويل ${t.number}`,
      baseCurrency: currency,
      lines: [
        ...costLines(-valueMinor, currency, '1900'),
        ...(costDiff !== 0 ? costLines(costDiff, currency) : []),
      ],
      createdBy: auth.userId,
    });

    // What did not arrive is written off through the stocktake, in this same transaction
    let stocktakeId: string | null = null;
    let shortValueMinor = 0;
    if (shorts.length > 0) {
      const levels = await tx
        .select({ variantId: stockLevels.variantId, qty: stockLevels.qty })
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.branchId, receiver),
            inArray(
              stockLevels.variantId,
              shorts.map((l) => l.variantId),
            ),
          ),
        );
      const held = new Map(levels.map((l) => [l.variantId, l.qty]));
      const count = await createStocktakeIn(
        tx,
        auth,
        {
          branchId: receiver,
          date,
          note: `نقص في التحويل ${t.number}: ${(reason ?? '').slice(0, 120)}`,
          lines: shorts.map((l) => ({
            variantId: l.variantId,
            countedQty: Math.max(0, (held.get(l.variantId) ?? 0) - l.shortQty),
          })),
        },
        meta,
      );
      stocktakeId = count.id;
      shortValueMinor = -count.diffValueMinor;
    }
    // The receipt is written once, last. Two people confirming at once: the second is refused by its unique key
    try {
      await tx.insert(transferReceipts).values({
        tenantId: auth.tenantId,
        id: newId(),
        transferId,
        branchId: receiver,
        businessDate: date,
        lines,
        shortPieces: shorts.reduce((sum, l) => sum + l.shortQty, 0),
        shortValueMinor,
        reason,
        stocktakeId,
        receivedBy: auth.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'transfer_receipts_transfer_unique'))
        throw conflict('استُلم هذا التحويل من قبل.');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'transfer.receive',
        entity: 'transfer',
        entityId: transferId,
        changes: {
          number: [null, t.number],
          shortPieces: [null, shorts.reduce((sum, l) => sum + l.shortQty, 0)],
          shortValueMinor: [null, shortValueMinor],
          reason: [null, reason],
        },
      },
      meta,
    );
    return full(tx, transferId);
  });
}

// ─── Cancelling a transfer that is still on the way ──────────────────────────

/**
 * A transfer sent «بالطريق» that nobody has received can be cancelled by the sender (a wrong quantity, a wrong
 * branch): everything that left comes back to the sender at the value it left with (Dr 1300 / Cr 1900 at the
 * sender, so account 1900 closes), its batches and serial numbers with it. It is closed by a receipt at the
 * SENDER's branch (see cancelledReceipt), whose unique key also makes a receive and a cancel exclude each other.
 */
export async function cancelTransfer(
  db: Database,
  auth: AccessClaims,
  transferId: string,
  input: TransferCancelInput,
  meta: RequestMeta,
  now: Date,
): Promise<TransferFull> {
  return withTenant(db, auth.tenantId, async (tx) => {
    // Two clicks together: one cancels, the other is told it is done
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`transfer:${transferId}`}, 0))`);
    const [t] = await tx.select().from(transfers).where(eq(transfers.id, transferId));
    if (!t) throw notFound();
    await requirePermission(tx, auth.userId, 'inventory.adjust', t.fromBranchId);
    if (!t.inTransit) throw conflict('هذا التحويل تمّ في خطوة واحدة، لا يُلغى من هنا.');
    const [done] = await tx
      .select({ id: transferReceipts.id })
      .from(transferReceipts)
      .where(eq(transferReceipts.transferId, transferId));
    if (done) throw conflict('انتهى أمر هذا التحويل من قبل: استُلم أو أُلغي.');

    const zone = await tx.execute<{ timezone: string }>(
      sql`select timezone from tenants where id = ${auth.tenantId}`,
    );
    const date = input.date ?? businessDateOf(now, zone[0]?.timezone ?? 'Asia/Damascus');
    if (date < t.businessDate) throw invalid({ date: 'تاريخ الإلغاء قبل تاريخ إرسال التحويل' });
    const sent = t.lines as StoredLine[];
    const sender = t.fromBranchId;

    const values = await loadValues(
      tx,
      auth.tenantId,
      sent.map((l) => stockKey(sender, l.variantId)),
    );
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    let costDiff = 0;
    for (const l of sent) {
      const key = stockKey(sender, l.variantId);
      const into = stockIn(values.get(key) ?? empty, l.qty, Math.max(0, l.valueMinor));
      values.set(key, into.after);
      costDiff += into.costMinor;
    }
    await saveValues(tx, auth.tenantId, values);
    await moveStock(
      tx,
      auth.tenantId,
      sender,
      t.inId,
      'transfer',
      date,
      sent.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, qty: l.qty })),
    );
    const left = await tx.execute<{
      variant_id: string;
      batch_no: string;
      expiry: string | null;
      qty: string;
      line_no: number;
      alloc_no: number;
    }>(sql`
      select variant_id, batch_no, expiry_date::text as expiry, (-qty)::text as qty, line_no, alloc_no
      from batch_movements where kind = 'transfer_out' and doc_id = ${transferId}`);
    await recordBatchMovements(
      tx,
      { tenantId: auth.tenantId, branchId: sender, kind: 'transfer_in', docId: t.inId, date },
      left.map((r) => ({
        variantId: r.variant_id,
        batchNo: r.batch_no === '' ? null : r.batch_no,
        expiry: r.expiry,
        qty: Number(r.qty),
        lineNo: r.line_no,
        allocNo: r.alloc_no,
      })),
    );
    await refreshBatches(
      tx,
      [sender],
      sent.map((l) => l.variantId),
    );
    const back = sent.flatMap((l) => l.serials ?? []);
    if (back.length > 0) {
      await tx
        .update(serials)
        .set({ status: 'in_stock', branchId: sender })
        .where(and(inArray(serials.serial, back), eq(serials.status, 'in_transit')));
    }

    const currency = await baseCurrency(tx);
    const valueMinor = sent.reduce((sum, l) => sum + l.valueMinor, 0);
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId: sender,
      date,
      sourceType: 'transfer',
      sourceId: t.inId,
      sourceNumber: t.number,
      memo: `إلغاء تحويل ${t.number}`,
      baseCurrency: currency,
      lines: [
        ...costLines(-valueMinor, currency, '1900'),
        ...(costDiff !== 0 ? costLines(costDiff, currency) : []),
      ],
      createdBy: auth.userId,
    });
    const reason = input.reason?.trim() || null;
    try {
      await tx.insert(transferReceipts).values({
        tenantId: auth.tenantId,
        id: newId(),
        transferId,
        branchId: sender,
        businessDate: date,
        lines: sent.map((l) => ({
          variantId: l.variantId,
          name: l.name,
          sentQty: l.qty,
          receivedQty: 0,
          shortQty: 0,
        })),
        shortPieces: 0,
        shortValueMinor: 0,
        reason,
        stocktakeId: null,
        receivedBy: auth.userId,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'transfer_receipts_transfer_unique'))
        throw conflict('انتهى أمر هذا التحويل من قبل: استُلم أو أُلغي.');
      throw error;
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'transfer.cancel',
        entity: 'transfer',
        entityId: transferId,
        changes: { number: [null, t.number], valueMinor: [null, valueMinor], reason: [null, reason] },
      },
      meta,
    );
    return full(tx, transferId);
  });
}
