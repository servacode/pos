import { sql } from 'drizzle-orm';
import { roundDiv, stockIn, type CurrencyCode, type StockValue, type StocktakeLineRow } from '@serva/core';
import { serials, stocktakes, type Transaction } from '@serva/db';
import { createUuidV7 } from '@serva/sync';
import type { AccessClaims } from '../../auth/tokens';
import type { RequestMeta } from '../../types';
import { audit } from '../audit';
import { recordBatchMovements, refreshBatches } from '../batches';
import { costPending, loadValues, saveValues, stockKey } from '../costing';
import { postEntry, type DraftLine } from '../posting';
import { baseCurrency, moveStock, nextNumber } from '../purchases';

const newId = createUuidV7();

/** One variant's opening quantity in one branch, thousandths, with what a unit of it cost. */
export interface OpeningLine {
  variantId: string;
  name: string;
  branchId: string;
  /** Thousandths of the base unit */
  qty: number;
  /** What one whole unit cost, base currency minor units; 0 when the file had no cost */
  unitCostMinor: number;
  /**
   * What of `qty` came in which batch, with its expiry and (for a serial-tracked item) its numbers.
   * The part of `qty` they do not cover is stock with no batch.
   */
  lots?: OpeningLot[];
}

/** One batch of an opening quantity. */
export interface OpeningLot {
  /** Thousandths of the base unit */
  qty: number;
  batchNo: string | null;
  /** YYYY-MM-DD */
  expiryDate: string | null;
  /** One number per piece, already checked against the item */
  serials: string[];
}

/** The value of `qty` thousandths at `unitCostMinor` per unit, rounded half away from zero. */
export const lineValue = (qty: number, unitCostMinor: number): number =>
  Number(roundDiv(BigInt(qty) * BigInt(unitCostMinor), 1000n));

/**
 * The stock a store starts with, as one document per branch: the same path as a count (movements
 * of kind «stocktake», stock levels, the running average cost) and its entry Dr 1300 المخزون / Cr 3900
 * الأرصدة الافتتاحية (docs/specs/05-migration.md), because nobody bought it from a supplier today.
 * Callers pass only variants with no earlier stock movement in the branch.
 */
export async function postOpeningStock(
  tx: Transaction,
  auth: AccessClaims,
  meta: RequestMeta,
  date: string,
  lines: OpeningLine[],
): Promise<void> {
  if (lines.length === 0) return;
  await costPending(tx, auth.tenantId);
  const currency: CurrencyCode = await baseCurrency(tx);
  const byBranch = new Map<string, OpeningLine[]>();
  for (const l of lines) byBranch.set(l.branchId, [...(byBranch.get(l.branchId) ?? []), l]);
  for (const [branchId, branchLines] of byBranch) {
    const keys = branchLines.map((l) => stockKey(branchId, l.variantId));
    const values = await loadValues(tx, auth.tenantId, keys);
    const empty: StockValue = { qty: 0, valueMinor: 0, refQty: 0, refValueMinor: 0 };
    const rows: StocktakeLineRow[] = [];
    let total = 0;
    for (const l of branchLines) {
      const value = lineValue(l.qty, l.unitCostMinor);
      const key = stockKey(branchId, l.variantId);
      values.set(key, stockIn(values.get(key) ?? empty, l.qty, value).after);
      rows.push({
        variantId: l.variantId,
        name: l.name,
        expectedQty: 0,
        countedQty: l.qty,
        diffQty: l.qty,
        diffValueMinor: value,
      });
      total += value;
    }
    await saveValues(tx, auth.tenantId, values);

    const id = newId();
    const number = await nextNumber(tx, auth.tenantId, 'OPN', date);
    await tx.insert(stocktakes).values({
      tenantId: auth.tenantId,
      id,
      number,
      branchId,
      businessDate: date,
      note: 'رصيد افتتاحي (استيراد)',
      lines: rows,
      diffValueMinor: total,
      createdBy: auth.userId,
    });
    await moveStock(
      tx,
      auth.tenantId,
      branchId,
      id,
      'stocktake',
      date,
      branchLines.map((l, i) => ({ lineNo: i + 1, variantId: l.variantId, qty: l.qty })),
    );
    await postOpeningLots(tx, auth.tenantId, branchId, id, date, branchLines);
    const debit: DraftLine = {
      account: { code: '1300' },
      baseMinor: total,
      currency,
      amountMinor: total,
      rate: null,
    };
    const credit: DraftLine = {
      account: { code: '3900' },
      baseMinor: -total,
      currency,
      amountMinor: -total,
      rate: null,
    };
    await postEntry(tx, {
      tenantId: auth.tenantId,
      branchId,
      date,
      sourceType: 'stocktake',
      sourceId: id,
      sourceNumber: number,
      memo: `رصيد افتتاحي للمخزون ${number}`,
      baseCurrency: currency,
      lines: [debit, credit],
    });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'stock.opening',
        entity: 'stocktake',
        entityId: id,
        changes: { number: [null, number], diffValueMinor: [null, total] },
        data: { lines: rows.length },
      },
      meta,
    );
  }
}

/** The variants among `variantIds` that already have a stock movement in `branchId`. */
export async function variantsWithMovements(
  tx: Transaction,
  branchId: string,
  variantIds: string[],
): Promise<Set<string>> {
  if (variantIds.length === 0) return new Set();
  const rows = await tx.execute<{ variant_id: string }>(sql`
    select distinct variant_id from stock_movements
    where branch_id = ${branchId} and variant_id in (${sql.join(
      variantIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`);
  return new Set(rows.map((r) => r.variant_id));
}

/**
 * A party's opening balance: Dr 1200 (the customer owes) or Cr 2100 (the store owes the supplier),
 * against 3900 الأرصدة الافتتاحية. A manual entry, so the owner can see it in the journal and reverse it.
 * `balanceMinor` is positive when the party owes the store (a customer) or the store owes the party
 * (a supplier), negative the other way.
 */
export async function postOpeningBalance(
  tx: Transaction,
  auth: AccessClaims,
  meta: RequestMeta,
  input: {
    party: 'customer' | 'supplier';
    partyId: string;
    name: string;
    balanceMinor: number;
    date: string;
  },
): Promise<void> {
  if (input.balanceMinor === 0) return;
  const currency: CurrencyCode = await baseCurrency(tx);
  const amount = input.balanceMinor;
  // Debit-signed amounts: a customer's balance is a debit on 1200, a supplier's a credit on 2100
  const partyDebit = input.party === 'customer' ? amount : -amount;
  const memo = `رصيد افتتاحي — ${input.name}`;
  const partyLine: DraftLine = {
    account: { code: input.party === 'customer' ? '1200' : '2100' },
    baseMinor: partyDebit,
    currency,
    amountMinor: partyDebit,
    rate: null,
    party: { type: input.party, id: input.partyId },
    memo,
  };
  const openingLine: DraftLine = {
    account: { code: '3900' },
    baseMinor: -partyDebit,
    currency,
    amountMinor: -partyDebit,
    rate: null,
    memo,
  };
  const entryId = newId();
  await postEntry(tx, {
    tenantId: auth.tenantId,
    branchId: null,
    date: input.date,
    sourceType: 'manual',
    sourceId: entryId,
    sourceNumber: null,
    memo,
    baseCurrency: currency,
    lines: [partyLine, openingLine],
    kind: 'manual',
    createdBy: auth.userId,
  });
  await audit(
    tx,
    {
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'journal.opening_balance',
      entity: input.party,
      entityId: input.partyId,
      changes: { balanceMinor: [null, input.balanceMinor] },
    },
    meta,
  );
}

/**
 * The batches and serial numbers of an opening document: the same ledgers a purchase receipt feeds
 * (the batch ledger as a «count» of the stocktake, and one `serials` row per piece), so the expiry
 * report, the recall and the warranty find opening stock exactly as they find bought stock. Only the
 * rows of the stocktake document are written; stock, cost and the entry are the opening path's own.
 */
async function postOpeningLots(
  tx: Transaction,
  tenantId: string,
  branchId: string,
  docId: string,
  date: string,
  lines: readonly OpeningLine[],
): Promise<void> {
  const batchRows = lines.flatMap((l, i) =>
    (l.lots ?? [])
      .filter((lot) => lot.batchNo !== null || lot.expiryDate !== null)
      .map((lot, n) => ({
        variantId: l.variantId,
        batchNo: lot.batchNo,
        expiry: lot.expiryDate,
        qty: lot.qty,
        lineNo: i + 1,
        allocNo: n,
      })),
  );
  await recordBatchMovements(tx, { tenantId, branchId, kind: 'count', docId, date }, batchRows);
  await refreshBatches(
    tx,
    [branchId],
    batchRows.map((r) => r.variantId),
  );
  const pieces = lines.flatMap((l) =>
    (l.lots ?? []).flatMap((lot) =>
      lot.serials.map((serial) => ({
        tenantId,
        variantId: l.variantId,
        serial,
        status: 'in_stock',
        purchaseId: null,
        branchId,
      })),
    ),
  );
  if (pieces.length > 0) await tx.insert(serials).values(pieces);
}
