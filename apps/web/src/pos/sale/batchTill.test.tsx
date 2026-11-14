import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { PharmacySettings, StockBatch } from '@serva/core/contracts/pharmacy';
import { stripBidiControls } from '@serva/core/text';
import { ids, PINS, posSets, PRODUCTS } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/**
 * 03 › الصيدليات: the till allocates a sale across the batches of its branch, first expiry first,
 * splits a line over batches, prints them, and refuses (or asks a manager about) what no valid batch
 * covers. It also warns, or refuses, a sale above the stock on hand.
 */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const plain = (el: Element) => stripBidiControls(el.textContent ?? '');
type Pos = Awaited<ReturnType<typeof saleScreen>>;

const OLD: StockBatch = { batchNo: 'G-OLD', expiry: '2099-01-01', qty: 2000, blocked: false };
const NEW: StockBatch = { batchNo: 'G-NEW', expiry: '2099-06-01', qty: 5000, blocked: false };
const EXPIRED: StockBatch = { batchNo: 'A-01', expiry: '2020-01-31', qty: 9000, blocked: false };

function sets(options: {
  batches: StockBatch[];
  stockQty?: number;
  pharmacy?: PharmacySettings | null;
  blockNegativeStock?: boolean;
}) {
  const s = posSets();
  s.products = s.products.map((p) =>
    p.id === PRODUCTS.tea.product.id ? { ...p, nameAr: 'بانادول 500' } : p,
  );
  s.variants = s.variants.map((v) =>
    v.id === PRODUCTS.tea.variant.id
      ? { ...v, shelfBatches: options.batches.map((b) => ({ batchNo: b.batchNo, expiry: b.expiry! })) }
      : v,
  );
  s.stock_levels = [
    {
      id: PRODUCTS.tea.variant.id,
      branchId: ids.tenant,
      variantId: PRODUCTS.tea.variant.id,
      qty: options.stockQty ?? options.batches.reduce((sum, b) => sum + b.qty, 0),
      reservedQty: 0,
      batches: options.batches,
      version: 1,
    },
  ];
  s.settings = s.settings.map((x) => ({
    ...x,
    pharmacy: options.pharmacy ?? { prescription: 'optional' },
    till: {
      returnWindowDays: null,
      cardApprovalRequired: false,
      blockNegativeStock: options.blockNegativeStock,
    },
  }));
  return s;
}

async function payExact(user: Pos['user']) {
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('region', { name: 'الدفع' });
  await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
  await user.keyboard('{Enter}');
  await screen.findByRole('region', { name: 'تمت البيعة' });
}

const soldPayload = (outbox: Pos['outbox']) =>
  outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;

describe('the till allocates batches first expiry first', () => {
  it('splits one line over two batches, records each, and prints them on the receipt', async () => {
    const { user, outbox } = await saleScreen({ sets: sets({ batches: [NEW, OLD] }) });
    // Three boxes: two from the nearer batch, one from the next. Not all three from one label.
    for (let n = 0; n < 3; n += 1) await scan(user, PRODUCTS.tea.barcode!.code);
    await payExact(user);
    const line = soldPayload(outbox).lines[0]!;
    expect(line.qty).toBe(3000);
    expect(line.batches).toEqual([
      { batchNo: 'G-OLD', expiry: '2099-01-01', qty: 2000 },
      { batchNo: 'G-NEW', expiry: '2099-06-01', qty: 1000 },
    ]);
    // The older single-batch fields still name the first
    expect(line).toMatchObject({ batchNo: 'G-OLD', batchExpiry: '2099-01-01' });
    const receipt = screen.getByRole('region', { name: 'تمت البيعة' });
    expect(plain(receipt)).toContain('G-OLD');
    expect(plain(receipt)).toContain('G-NEW');
  });

  it('never takes an expired batch, and leaves a sale the batches cover untouched', async () => {
    const { user, outbox } = await saleScreen({ sets: sets({ batches: [EXPIRED, NEW] }) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(screen.queryByText(/لا دفعة صالحة/)).toBeNull();
    await payExact(user);
    expect(soldPayload(outbox).lines[0]!.batches).toEqual([
      { batchNo: 'G-NEW', expiry: '2099-06-01', qty: 1000 },
    ]);
  });

  it('counts what this till sold and has not sent, so the same box is not promised twice', async () => {
    const { user, outbox } = await saleScreen({ sets: sets({ batches: [{ ...OLD, qty: 1000 }, NEW] }) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await payExact(user);
    await scan(user, PRODUCTS.tea.barcode!.code);
    await payExact(user);
    const sales = outbox
      .filter((e) => e.type === 'sale')
      .map((e) => (e.doc.payload as unknown as SalePayload).lines[0]!);
    expect(sales.map((l) => l.batches?.[0]?.batchNo)).toEqual(['G-OLD', 'G-NEW']);
  });
});

describe('what no valid batch covers', () => {
  it('is refused when the store blocks sales without a valid batch', async () => {
    const { user } = await saleScreen({
      sets: sets({ batches: [EXPIRED], pharmacy: { prescription: 'optional', blockNoBatch: true } }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(
      await screen.findByText(/لا دفعة صالحة تكفي «بانادول 500».*دفعات منتهية.*لا يُباع بلا دفعة صالحة/),
    ).toBeInTheDocument();
    await user.keyboard('{F12}');
    expect(screen.queryByRole('region', { name: 'الدفع' })).toBeNull();
  });

  it('waits for the manager code otherwise, and goes through once it is given', async () => {
    const { user, outbox } = await saleScreen({ sets: sets({ batches: [EXPIRED] }) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(/لا دفعة صالحة تكفي «بانادول 500».*يلزم رمز المدير/)).toBeInTheDocument();
    await user.keyboard('{F12}');
    expect(screen.queryByRole('region', { name: 'الدفع' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'رمز المدير' }));
    await screen.findByRole('region', { name: 'رمز المدير' });
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await payExact(user);
    // Nothing was allocated: the line carries no batch
    expect(soldPayload(outbox).lines[0]!.batches).toBeUndefined();
  });
});

describe('selling above the stock', () => {
  it('warns with the quantity on hand and still sells', async () => {
    const { user, outbox } = await saleScreen({
      sets: sets({
        batches: [NEW],
        stockQty: 1000,
        pharmacy: { prescription: 'optional', autoBatch: false },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(/«بانادول 500».*الموجود/)).toBeInTheDocument();
    await payExact(user);
    expect(soldPayload(outbox).lines[0]!.qty).toBe(2000);
  });

  it('refuses when the store forbids it', async () => {
    const { user } = await saleScreen({
      sets: sets({
        batches: [NEW],
        stockQty: 1000,
        pharmacy: { prescription: 'optional', autoBatch: false },
        blockNegativeStock: true,
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(await screen.findByText(/الموجود.*فقط.*لا يُباع فوق المخزون/)).toBeInTheDocument();
    await user.keyboard('{F12}');
    expect(screen.queryByRole('region', { name: 'الدفع' })).toBeNull();
  });
});
