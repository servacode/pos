import type { BatchAllocation, SalePayload } from '@serva/core/contracts/documents';
import type { PharmacySettings, StockBatch } from '@serva/core/contracts/pharmacy';
import {
  allocateFefo,
  batchState,
  overStock,
  sameBatch,
  uncoveredAction,
  usesAutoBatch,
} from '@serva/core/pharmacy';
import { lineBaseQty } from '@serva/core/sale';
import type { OutboxEntry } from '@serva/sync';
import type { Catalog } from '../catalog';
import type { Cart } from './cart';

/**
 * What the cart takes from each batch and from the shelf (03 › الصيدليات: الدفعة، FEFO). The till
 * works offline, so it knows only what it last pulled for its branch minus what it sold itself and
 * has not sent yet: those unsent sales come off the batches and the stock before the cart is planned.
 */

/** A line no valid batch covers (all gone, expired or blocked) */
export interface BatchIssue {
  lineNo: number;
  name: string;
  /** Base units no valid batch covers */
  uncovered: number;
  /** What sits in expired or blocked batches, so the message can say why */
  expiredQty: number;
  blockedQty: number;
}

/** An item the cart takes more of than this branch holds */
export interface StockIssue {
  variantId: string;
  name: string;
  /** What the branch holds (zero when it holds none or less), base units */
  onHand: number;
  wanted: number;
  /** The shortfall counts only what can be sold: the expired and blocked batches are left out of `onHand` */
  validOnly?: true;
}

export interface BatchPlan {
  /** Per line: the batches it takes from, in order; absent for a line of an item with no batches */
  allocations: Map<number, BatchAllocation[]>;
  uncovered: BatchIssue[];
  stock: StockIssue[];
  /** Names what the cart lacks, so an approval is good only for what the manager saw */
  signature: string;
}

interface Sold {
  total: Map<string, number>;
  batches: Map<string, BatchAllocation[]>;
}

/** What this till sold since it last sent: unsent sales, per item and per batch. */
export function soldHere(entries: readonly OutboxEntry[]): Sold {
  const sold: Sold = { total: new Map(), batches: new Map() };
  for (const entry of entries) {
    if (entry.status !== 'pending' || entry.doc.type !== 'sale') continue;
    for (const line of (entry.doc.payload as unknown as SalePayload).lines ?? []) {
      sold.total.set(line.variantId, (sold.total.get(line.variantId) ?? 0) + line.baseQty);
      const taken = line.batches?.length
        ? line.batches
        : line.batchNo
          ? [{ batchNo: line.batchNo, expiry: line.batchExpiry ?? null, qty: line.baseQty }]
          : [];
      if (taken.length > 0)
        sold.batches.set(line.variantId, [...(sold.batches.get(line.variantId) ?? []), ...taken]);
    }
  }
  return sold;
}

/** The branch's batches of an item less what this till already sold from them */
function poolOf(stock: readonly StockBatch[], taken: readonly BatchAllocation[]): StockBatch[] {
  const pool = stock.map((b) => ({ ...b }));
  for (const t of taken) {
    const at = pool.find((b) => sameBatch(b, t));
    if (at) at.qty -= t.qty;
  }
  return pool;
}

/** What can be sold from the batches, or null when none is expired or blocked (then the stock is the stock) */
function sellableOf(pool: readonly StockBatch[], today: string): number | null {
  let ok = 0;
  let left = false;
  for (const b of pool) {
    const state = batchState(b, today);
    if (state === 'ok') ok += b.qty;
    else if (state === 'empty' && b.qty < 0 && !b.batchNo) ok += b.qty;
    else if (state === 'expired' || state === 'blocked') left = true;
  }
  return left ? ok : null;
}

export function planBatches(input: {
  cart: Cart;
  catalog: Pick<Catalog, 'byVariant'>;
  today: string;
  pending: readonly OutboxEntry[];
  pharmacy: PharmacySettings | null | undefined;
}): BatchPlan {
  const { cart, catalog, today, pending, pharmacy } = input;
  const sold = soldHere(pending);
  const pools = new Map<string, StockBatch[]>();
  const wanted = new Map<string, number>();
  const allocations = new Map<number, BatchAllocation[]>();
  const uncovered: BatchIssue[] = [];
  const uncoveredItems = new Set<string>();
  for (const line of cart.lines) {
    const item = catalog.byVariant.get(line.variantId);
    if (!item) continue;
    const base = lineBaseQty(line.qty, line.packQty);
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + base);
    // The branch's balances arrived (stock_levels.batches, even an empty list): the cart is planned from them
    const tracks = usesAutoBatch(pharmacy) && Array.isArray(item.stockBatches);
    if (!tracks) continue;
    const pool =
      pools.get(line.variantId) ?? poolOf(item.stockBatches!, sold.batches.get(line.variantId) ?? []);
    const result = allocateFefo(pool, base, today);
    pools.set(line.variantId, result.remaining);
    allocations.set(line.lineNo, result.allocations);
    if (result.uncovered > 0) {
      uncoveredItems.add(line.variantId);
      uncovered.push({
        lineNo: line.lineNo,
        name: line.name,
        uncovered: result.uncovered,
        expiredQty: result.expiredQty,
        blockedQty: result.blockedQty,
      });
    }
  }
  const stock: StockIssue[] = [];
  for (const [variantId, want] of wanted) {
    const item = catalog.byVariant.get(variantId)!;
    if (item.stockQty === null || item.stockQty === undefined) continue;
    const heldHere = item.stockQty - (sold.total.get(variantId) ?? 0);
    // An item that keeps batches counts only the batches that can be sold, never past the stock itself
    const valid =
      usesAutoBatch(pharmacy) && Array.isArray(item.stockBatches)
        ? sellableOf(poolOf(item.stockBatches, sold.batches.get(variantId) ?? []), today)
        : null;
    const onHand = valid === null ? heldHere : Math.min(heldHere, valid);
    // A shortfall only in sellable stock is already said by the line no valid batch covers
    const sayBatchOnly = !overStock(heldHere, want) && uncoveredItems.has(variantId);
    if (overStock(onHand, want) && !sayBatchOnly)
      stock.push({
        variantId,
        name: item.name,
        onHand: Math.max(0, onHand),
        wanted: want,
        ...(onHand < heldHere ? { validOnly: true as const } : {}),
      });
  }
  return {
    allocations,
    uncovered,
    stock,
    signature: uncovered.map((u) => `${u.lineNo}:${u.uncovered}`).join(','),
  };
}

/** What the till does about the plan: lines refused, lines waiting for a manager, and whether stock blocks. */
export function batchGuard(
  plan: BatchPlan,
  pharmacy: PharmacySettings | null | undefined,
  blockNegativeStock: boolean,
): { blocks: BatchIssue[]; approvals: BatchIssue[]; stockBlocks: StockIssue[]; stockWarns: StockIssue[] } {
  // A batch blocked for a recall is never sold, whatever the store's setting: no manager code reaches it
  const action = (i: BatchIssue) =>
    i.blockedQty > 0 && i.uncovered > 0 ? 'block' : uncoveredAction(pharmacy, true, i.uncovered);
  return {
    blocks: plan.uncovered.filter((i) => action(i) === 'block'),
    approvals: plan.uncovered.filter((i) => action(i) === 'approve'),
    stockBlocks: blockNegativeStock ? plan.stock : [],
    stockWarns: blockNegativeStock ? [] : plan.stock,
  };
}
