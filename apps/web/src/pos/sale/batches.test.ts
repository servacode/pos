import { describe, expect, it } from 'vitest';
import type { OutboxEntry } from '@serva/sync';
import type { StockBatch } from '@serva/core/contracts/pharmacy';
import { batchGuard, planBatches, soldHere } from './batches';
import { EMPTY_CART, type Cart, type CartLine } from './cart';

const TODAY = '2026-10-30';
const batch = (batchNo: string, expiry: string | null, qty: number, blocked = false): StockBatch => ({
  batchNo,
  expiry,
  qty,
  blocked,
});

const line = (lineNo: number, variantId: string, qty: number, packQty = 1000): CartLine =>
  ({ lineNo, variantId, name: `صنف ${variantId}`, qty, packQty }) as unknown as CartLine;
const cartOf = (...lines: CartLine[]): Cart => ({ ...EMPTY_CART, lines });
const catalogOf = (
  items: Record<string, { stockBatches?: StockBatch[] | null; stockQty?: number | null }>,
) => ({
  byVariant: new Map(
    Object.entries(items).map(([id, i]) => [id, { variantId: id, name: `صنف ${id}`, ...i } as never]),
  ),
});
const sale = (
  lines: { variantId: string; baseQty: number; batches?: object[]; batchNo?: string; batchExpiry?: string }[],
): OutboxEntry =>
  ({ status: 'pending', doc: { type: 'sale', payload: { lines } } }) as unknown as OutboxEntry;

const pharmacy = { prescription: 'optional' as const };

describe('planBatches', () => {
  it('allocates first expiry first and splits a line over batches', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 6000)),
      catalog: catalogOf({
        a: { stockBatches: [batch('N', '2027-01-01', 5000), batch('O', '2026-12-01', 2000)], stockQty: 7000 },
      }),
      today: TODAY,
      pending: [],
      pharmacy,
    });
    expect(plan.allocations.get(1)).toEqual([
      { batchNo: 'O', expiry: '2026-12-01', qty: 2000 },
      { batchNo: 'N', expiry: '2027-01-01', qty: 4000 },
    ]);
    expect(plan.uncovered).toEqual([]);
    expect(plan.stock).toEqual([]);
    expect(plan.signature).toBe('');
  });

  it('shares one item’s batches between two lines of the cart, never promising a box twice', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 3000), line(2, 'a', 3000)),
      catalog: catalogOf({ a: { stockBatches: [batch('N', '2027-01-01', 4000)], stockQty: 4000 } }),
      today: TODAY,
      pending: [],
      pharmacy,
    });
    expect(plan.allocations.get(1)).toEqual([{ batchNo: 'N', expiry: '2027-01-01', qty: 3000 }]);
    expect(plan.allocations.get(2)).toEqual([{ batchNo: 'N', expiry: '2027-01-01', qty: 1000 }]);
    expect(plan.uncovered).toEqual([
      { lineNo: 2, name: expect.any(String), uncovered: 2000, expiredQty: 0, blockedQty: 0 },
    ]);
    expect(plan.signature).toBe('2:2000');
  });

  it('takes off what this till sold and has not sent, per batch and in all', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 2000)),
      catalog: catalogOf({
        a: { stockBatches: [batch('O', '2026-12-01', 3000), batch('N', '2027-01-01', 5000)], stockQty: 8000 },
      }),
      today: TODAY,
      pending: [
        sale([
          { variantId: 'a', baseQty: 2000, batches: [{ batchNo: 'O', expiry: '2026-12-01', qty: 2000 }] },
        ]),
        sale([{ variantId: 'a', baseQty: 1000, batchNo: 'O', batchExpiry: '2026-12-01' }]),
        sale([{ variantId: 'a', baseQty: 500 }]),
        {
          status: 'confirmed',
          doc: { type: 'sale', payload: { lines: [{ variantId: 'a', baseQty: 9000 }] } },
        } as unknown as OutboxEntry,
        { status: 'pending', doc: { type: 'return', payload: {} } } as unknown as OutboxEntry,
      ],
      pharmacy,
    });
    expect(plan.allocations.get(1)).toEqual([{ batchNo: 'N', expiry: '2027-01-01', qty: 2000 }]);
    expect(soldHere([sale([{ variantId: 'a', baseQty: 5 }])]).total.get('a')).toBe(5);
  });

  it('counts a pack by its pieces, and ignores items it knows nothing of or that keep no batches', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 2000, 12000), line(2, 'ghost', 1000), line(3, 'plain', 1000)),
      catalog: catalogOf({
        a: { stockBatches: [batch('N', '2027-01-01', 30000)], stockQty: 30000 },
        plain: { stockBatches: null, stockQty: 5000 },
      }),
      today: TODAY,
      pending: [],
      pharmacy,
    });
    expect(plan.allocations.get(1)).toEqual([{ batchNo: 'N', expiry: '2027-01-01', qty: 24000 }]);
    expect(plan.allocations.has(2)).toBe(false);
    expect(plan.allocations.has(3)).toBe(false);
  });

  it('plans nothing when the store turned batch picking off', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 1000)),
      catalog: catalogOf({ a: { stockBatches: [], stockQty: 0 } }),
      today: TODAY,
      pending: [],
      pharmacy: { prescription: 'optional', autoBatch: false },
    });
    expect(plan.allocations.size).toBe(0);
    expect(plan.uncovered).toEqual([]);
  });

  it('reports a line no valid batch covers with why, and the stock it goes over', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 3000), line(2, 'b', 2000)),
      catalog: catalogOf({
        a: {
          stockBatches: [batch('E', '2026-01-01', 9000), batch('B', '2027-01-01', 1000, true)],
          stockQty: 10000,
        },
        b: { stockBatches: [], stockQty: 500 },
      }),
      today: TODAY,
      pending: [],
      pharmacy,
    });
    expect(plan.uncovered.map((u) => [u.lineNo, u.uncovered, u.expiredQty, u.blockedQty])).toEqual([
      [1, 3000, 9000, 1000],
      [2, 2000, 0, 0],
    ]);
    expect(plan.stock).toEqual([{ variantId: 'b', name: 'صنف b', onHand: 500, wanted: 2000 }]);
  });

  it('turns the plan into what blocks, what waits for a manager, and what only warns', () => {
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 3000), line(2, 'b', 2000)),
      catalog: catalogOf({ a: { stockBatches: [], stockQty: 10000 }, b: { stockQty: 500 } }),
      today: TODAY,
      pending: [],
      pharmacy,
    });
    const warn = batchGuard(plan, pharmacy, false);
    expect(warn.approvals).toHaveLength(1);
    expect(warn.blocks).toEqual([]);
    expect(warn.stockWarns.map((s) => s.variantId)).toEqual(['b']);
    expect(warn.stockBlocks).toEqual([]);
    const hard = batchGuard(plan, { prescription: 'optional', blockNoBatch: true }, true);
    expect(hard.blocks).toHaveLength(1);
    expect(hard.approvals).toEqual([]);
    expect(hard.stockBlocks.map((s) => s.variantId)).toEqual(['b']);
    expect(hard.stockWarns).toEqual([]);
  });

  it('a batch blocked for a recall is refused even when the store lets a manager approve', () => {
    const pharmacy = { prescription: 'optional' as const, blockNoBatch: false };
    const plan = planBatches({
      cart: cartOf(line(1, 'a', 5000), line(2, 'b', 5000)),
      catalog: catalogOf({
        a: { stockBatches: [batch('R1', '2027-01-01', 10000, true)] },
        b: { stockBatches: [batch('E1', '2026-01-01', 10000)] },
      }),
      today: TODAY,
      pending: [],
      pharmacy,
    });
    const guard = batchGuard(plan, pharmacy, false);
    // The recalled one is a hard refusal; the expired one still waits for the manager's code
    expect(guard.blocks.map((i) => i.lineNo)).toEqual([1]);
    expect(guard.approvals.map((i) => i.lineNo)).toEqual([2]);
  });
});
