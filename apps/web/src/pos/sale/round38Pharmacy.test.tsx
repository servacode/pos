import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { PharmacySettings, StockBatch } from '@serva/core/contracts/pharmacy';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { saleScreen, scan } from '../../test/renderPos';

/**
 * Round 38, the pharmacy pack at the till: an expired batch needs the manager's code only when the owner
 * allowed it (and the sale says who), «بدائل متوفرة» lists the same ingredient in stock, and «طلبو زبون
 * وما كان موجود» writes the shortage request, kept on the device while there is no connection.
 */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Pos = Awaited<ReturnType<typeof saleScreen>>;
const EXPIRED: StockBatch = { batchNo: 'A-01', expiry: '2020-01-31', qty: 9000, blocked: false };
const GOOD: StockBatch = { batchNo: 'G-1', expiry: '2099-01-31', qty: 3000, blocked: false };

/** Panadol (the tea fixture) with the given batches; Abimol (the sugar fixture) is the same medicine in stock */
function sets(options: {
  batches: StockBatch[];
  pharmacy: PharmacySettings | null;
  alternativeStock?: number;
}) {
  const s = posSets();
  s.products = s.products.map((p) => {
    if (p.id === PRODUCTS.tea.product.id)
      return {
        ...p,
        nameAr: 'بانادول 500',
        genericName: 'باراسيتامول',
        strength: '500 ملغ',
        dosageForm: 'أقراص',
      };
    if (p.id === PRODUCTS.sugar.product.id)
      return {
        ...p,
        nameAr: 'أبيمول 500',
        genericName: 'باراسيتامول',
        strength: '500 ملغ',
        dosageForm: 'أقراص',
      };
    if (p.id === PRODUCTS.milk.product.id)
      return {
        ...p,
        nameAr: 'بروفين 400',
        genericName: 'إيبوبروفين',
        strength: '400 ملغ',
        dosageForm: 'أقراص',
      };
    return p;
  });
  s.stock_levels = [
    {
      id: PRODUCTS.tea.variant.id,
      branchId: ids.tenant,
      variantId: PRODUCTS.tea.variant.id,
      qty: options.batches.reduce((sum, b) => sum + b.qty, 0),
      reservedQty: 0,
      batches: options.batches,
      version: 1,
    },
    {
      id: PRODUCTS.sugar.variant.id,
      branchId: ids.tenant,
      variantId: PRODUCTS.sugar.variant.id,
      qty: options.alternativeStock ?? 4000,
      reservedQty: 0,
      version: 1,
    },
    {
      id: PRODUCTS.milk.variant.id,
      branchId: ids.tenant,
      variantId: PRODUCTS.milk.variant.id,
      qty: 9000,
      reservedQty: 0,
      version: 1,
    },
  ];
  s.settings = s.settings.map((x) => ({
    ...x,
    pharmacy: options.pharmacy,
    till: { returnWindowDays: null, cardApprovalRequired: false },
  }));
  return s;
}

async function openWarnings(user: Pos['user']) {
  const row = await screen.findByRole('button', { name: /^(تنبيه واحد|تنبيهان|d+ تنبيهات)$/ });
  if (row.getAttribute('aria-expanded') !== 'true') await user.click(row);
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

describe('an expired batch at the till', () => {
  it('is sold with the manager’s code when the owner allowed it, and the sale says who approved it', async () => {
    const { user, outbox } = await saleScreen({
      sets: sets({
        batches: [EXPIRED],
        pharmacy: { prescription: 'optional', blockNoBatch: true, allowExpiredWithCode: true },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(
      await screen.findByText(/لا دفعة صالحة تكفي «بانادول 500».*دفعات منتهية.*يلزم رمز المدير/),
    ).toBeInTheDocument();
    await user.keyboard('{F12}');
    expect(screen.queryByRole('region', { name: 'الدفع' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'رمز المدير' }));
    await screen.findByRole('region', { name: 'رمز المدير' });
    expect(screen.getByText(/دفعة منتهية الصلاحية/)).toBeInTheDocument();
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await payExact(user);
    const sale = soldPayload(outbox);
    // It takes from the expired batch, and the document names the manager
    expect(sale.lines[0]!.batches).toEqual([{ batchNo: 'A-01', expiry: '2020-01-31', qty: 1000 }]);
    expect(sale.batchApproval).toMatchObject({ userId: ids.maryam, method: 'pin' });
  });

  it('prefers the valid batch, and only the rest comes from the expired one', async () => {
    const { user, outbox } = await saleScreen({
      sets: sets({
        batches: [EXPIRED, { ...GOOD, qty: 1000 }],
        pharmacy: { prescription: 'optional', blockNoBatch: true, allowExpiredWithCode: true },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(await screen.findByRole('button', { name: 'رمز المدير' }));
    await screen.findByRole('region', { name: 'رمز المدير' });
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await payExact(user);
    expect(soldPayload(outbox).lines[0]!.batches).toEqual([
      { batchNo: 'G-1', expiry: '2099-01-31', qty: 1000 },
      { batchNo: 'A-01', expiry: '2020-01-31', qty: 1000 },
    ]);
  });

  it('is refused for good when the owner said no, even where a manager may approve other shortages', async () => {
    const { user } = await saleScreen({
      sets: sets({
        batches: [EXPIRED],
        pharmacy: { prescription: 'optional', blockNoBatch: false, allowExpiredWithCode: false },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await openWarnings(user);
    expect(
      await screen.findByText(/لا دفعة صالحة تكفي «بانادول 500».*لا يُباع بلا دفعة صالحة/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'رمز المدير' })).toBeNull();
    await user.keyboard('{F12}');
    expect(screen.queryByRole('region', { name: 'الدفع' })).toBeNull();
  });

  it('a sale of a valid batch carries no approval', async () => {
    const { user, outbox } = await saleScreen({
      sets: sets({
        batches: [EXPIRED, GOOD],
        pharmacy: { prescription: 'optional', blockNoBatch: true, allowExpiredWithCode: true },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await payExact(user);
    const sale = soldPayload(outbox);
    expect(sale.lines[0]!.batches).toEqual([{ batchNo: 'G-1', expiry: '2099-01-31', qty: 1000 }]);
    expect(sale.batchApproval).toBeUndefined();
  });
});

describe('«بدائل متوفرة»', () => {
  it('lists the same medicine in stock from the warning, and one tap puts it in the cart', async () => {
    const { user } = await saleScreen({
      sets: sets({
        batches: [EXPIRED],
        pharmacy: { prescription: 'optional', blockNoBatch: true },
      }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await openWarnings(user);
    await user.click(await screen.findByRole('button', { name: 'بدائل متوفرة' }));
    const panel = await screen.findByRole('region', { name: 'بدائل متوفرة' });
    const list = within(panel).getByRole('list', { name: 'البدائل' });
    // The same ingredient, strength and form; the other ingredient is not offered
    expect(within(list).getByText('أبيمول 500')).toBeInTheDocument();
    expect(within(list).queryByText('بروفين 400')).toBeNull();
    expect(within(panel).getByText(/باراسيتامول · 500 ملغ · أقراص/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /أبيمول 500/ }));
    const cart = await screen.findByRole('list', { name: 'أسطر الفاتورة' });
    expect(within(cart).getByText(/أبيمول 500/)).toBeInTheDocument();
  });

  it('opens from the cart’s «بدائل» button for the selected line', async () => {
    const { user } = await saleScreen({
      sets: sets({ batches: [GOOD], pharmacy: { prescription: 'optional' } }),
    });
    expect(screen.getByRole('button', { name: 'بدائل الصنف' })).toBeDisabled();
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'بدائل الصنف' }));
    const panel = await screen.findByRole('region', { name: 'بدائل متوفرة' });
    expect(within(panel).getByText('أبيمول 500')).toBeInTheDocument();
  });

  it('says so when nothing in stock is the same medicine', async () => {
    const { user } = await saleScreen({
      sets: sets({ batches: [GOOD], pharmacy: { prescription: 'optional' }, alternativeStock: 0 }),
    });
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'بدائل الصنف' }));
    expect(await screen.findByText(/لا بديل متوفر الآن/)).toBeInTheDocument();
  });

  it('is not there for a store that is not a pharmacy', async () => {
    const { user } = await saleScreen({ sets: sets({ batches: [GOOD], pharmacy: null }) });
    await scan(user, PRODUCTS.tea.barcode!.code);
    expect(screen.queryByRole('button', { name: 'بدائل الصنف' })).toBeNull();
  });
});

describe('«طلبو زبون وما كان موجود»', () => {
  function shortageFetch(s: ReturnType<typeof sets>, status = 201) {
    const staff = staffServer(s);
    return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/v1/device/shortages') return new Response(JSON.stringify({}), { status });
      return staff(url, init);
    });
  }

  async function openAlternatives(user: Pos['user']) {
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'بدائل الصنف' }));
    await screen.findByRole('region', { name: 'بدائل متوفرة' });
  }

  it('writes the request on the server with its own id', async () => {
    const s = sets({ batches: [GOOD], pharmacy: { prescription: 'optional' } });
    const fetch = shortageFetch(s);
    const { user } = await saleScreen({ sets: s, fetch: fetch as unknown as typeof globalThis.fetch });
    await openAlternatives(user);
    await user.click(screen.getByRole('button', { name: 'طلبو زبون وما كان موجود' }));
    expect(await screen.findByText('سُجّل في النواقص.')).toBeInTheDocument();
    const call = fetch.mock.calls.find(([url]) => String(url) === '/v1/device/shortages')!;
    const body = JSON.parse(String(call[1]!.body)) as {
      id: string;
      variantId: string;
      name: string;
      qty: number;
    };
    expect(body).toMatchObject({ variantId: PRODUCTS.tea.variant.id, name: 'بانادول 500', qty: 1000 });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps it on the device while offline, and sends it later with the same id', async () => {
    const s = sets({ batches: [GOOD], pharmacy: { prescription: 'optional' } });
    const fetch = shortageFetch(s);
    const pos = await saleScreen({ sets: s, fetch: fetch as unknown as typeof globalThis.fetch });
    pos.setOnline(false);
    await openAlternatives(pos.user);
    await pos.user.click(screen.getByRole('button', { name: 'طلبو زبون وما كان موجود' }));
    expect(await screen.findByText(/سُجّل على هذا الجهاز/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url) === '/v1/device/shortages')).toBe(false);
    const queued = await pos.local.get<{ id: string }[]>('pending-shortages');
    expect(queued).toHaveLength(1);

    const { flushShortages } = await import('./shortages');
    pos.setOnline(true);
    expect(await flushShortages(pos.services)).toBe(0);
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url) === '/v1/device/shortages')).toBe(true),
    );
    const sent = JSON.parse(
      String(fetch.mock.calls.find(([url]) => String(url) === '/v1/device/shortages')![1]!.body),
    );
    expect(sent.id).toBe(queued![0]!.id);
    expect(await pos.local.get('pending-shortages')).toEqual([]);
  });

  it('keeps it when the server cannot be reached, and drops it when the server will never take it', async () => {
    const s = sets({ batches: [GOOD], pharmacy: { prescription: 'optional' } });
    const down = shortageFetch(s, 503);
    const pos = await saleScreen({ sets: s, fetch: down as unknown as typeof globalThis.fetch });
    const { askShortage, flushShortages } = await import('./shortages');
    expect(await askShortage(pos.services, { variantId: null, name: 'سيروم', qty: 1000 })).toBe('queued');
    expect(await pos.local.get<unknown[]>('pending-shortages')).toHaveLength(1);

    const refused = shortageFetch(s, 400);
    expect(
      await flushShortages({ ...pos.services, fetch: refused as unknown as typeof globalThis.fetch }),
    ).toBe(0);
    expect(await pos.local.get('pending-shortages')).toEqual([]);
  });
});
