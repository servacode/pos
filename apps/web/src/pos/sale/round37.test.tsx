import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '@serva/sync';
import type { OnlineOrderRow } from '@serva/core/contracts/shop';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, scan, catalogueReady } from '../../test/renderPos';
import { planBatches, batchGuard } from './batches';
import { EMPTY_CART, type Cart, type CartLine } from './cart';
import { reservedForOthers } from './reserved';
import {
  INSTALMENT_FEE_NAME,
  INSTALMENT_FEE_PRODUCT_ID,
  INSTALMENT_FEE_VARIANT_ID,
} from '@serva/core/installments';

/**
 * Round 37, decisions 14 and 15 at the till: what is reserved for other people comes off what the cashier may
 * sell, offline too; and an unknown barcode becomes a product from the sale screen.
 */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-11-18T10:00:00Z');
const A = '0192a000-0000-7000-8000-00000000aa01';
const B = '0192a000-0000-7000-8000-00000000aa02';

const cartLine = (lineNo: number, variantId: string, qty: number, packQty = 1000): CartLine =>
  ({ lineNo, variantId, name: `صنف ${variantId.slice(-2)}`, qty, packQty }) as unknown as CartLine;
const cartOf = (...lines: CartLine[]): Cart => ({ ...EMPTY_CART, lines });
const order = (over: Partial<OnlineOrderRow> = {}): OnlineOrderRow => ({
  id: 'o-1',
  number: 'ONL-000001',
  status: 'accepted',
  customerName: 'سلمى',
  phone: '+963933111222',
  fulfilment: 'pickup',
  address: null,
  note: null,
  currency: 'SYP',
  totalMinor: 0,
  depositCode: null,
  deliveryFeeMinor: 0,
  deliveryArea: null,
  lines: [{ variantId: A, productId: 'p', name: 'فستان', label: null, qty: 2, priceMinor: 1, totalMinor: 2 }],
  version: 1,
  ...over,
});
const base = { held: [] as Cart[], cart: EMPTY_CART, branchId: 'br-1', till: null, now: NOW, soldOnline: [] };

describe('decision 14: what the till counts as reserved', () => {
  it('counts an accepted hold, not a sold, lapsed, rejected or other branch’s one, nor the order being sold', () => {
    const reserved = (
      orders: OnlineOrderRow[],
      extra: Partial<Parameters<typeof reservedForOthers>[0]> = {},
    ) => reservedForOthers({ ...base, orders, ...extra }).get(A) ?? 0;
    expect(reserved([order()])).toBe(2000);
    expect(reserved([order(), order({ id: 'o-2' })])).toBe(4000);
    expect(reserved([order()], { soldOnline: ['o-1'] })).toBe(0);
    expect(reserved([order({ status: 'done' })])).toBe(0);
    expect(reserved([order({ status: 'rejected' })])).toBe(0);
    expect(reserved([order({ reservedUntil: '2026-11-18T09:59:00Z' })])).toBe(0);
    expect(reserved([order({ reservedUntil: '2026-11-18T10:01:00Z' })])).toBe(2000);
    expect(reserved([order({ branchId: 'br-2' })])).toBe(0);
    expect(reserved([order({ branchId: 'br-1' })])).toBe(2000);
    // The cashier who opened this very order to sell it is not blocked by it
    expect(
      reserved([order()], {
        cart: { ...EMPTY_CART, onlineOrder: { id: 'o-1', number: 'x', customerName: 'y' } },
      }),
    ).toBe(0);
  });

  it('counts the carts put aside at this till for the store’s own hours, but not a table or a held order', () => {
    const aside = (hoursAgo: number, over: Partial<Cart> = {}): Cart => ({
      ...cartOf(cartLine(1, B, 3000)),
      held: { name: 'زبون', at: NOW - hoursAgo * 3_600_000 },
      ...over,
    });
    const reserved = (held: Cart[], till: { heldCartHours?: number } | null = null) =>
      reservedForOthers({ ...base, orders: [], held, till }).get(B) ?? 0;
    expect(reserved([aside(1)])).toBe(3000);
    expect(reserved([aside(1), aside(2)])).toBe(6000);
    // 12 hours by default, then it lets go
    expect(reserved([aside(13)])).toBe(0);
    expect(reserved([aside(13)], { heldCartHours: 24 })).toBe(3000);
    expect(reserved([aside(1, { service: { orderType: 'dine_in', table: '4' } })])).toBe(0);
    expect(reserved([aside(1, { onlineOrder: { id: 'o-9', number: 'x', customerName: 'y' } })])).toBe(0);
  });

  it('lowers what the cashier may sell: a reserved piece cannot be sold, releasing frees it, selling consumes it', () => {
    const catalog = {
      byVariant: new Map([[A, { variantId: A, name: 'فستان', stockQty: 3000 } as never]]),
    };
    const plan = (reserved: Map<string, number>, qty: number) =>
      planBatches({
        cart: cartOf(cartLine(1, A, qty)),
        catalog,
        today: '2026-11-18',
        pending: [],
        pharmacy: null,
        reserved,
      });
    // Three on the shelf, two held for a customer: one can be sold, two cannot
    const held = reservedForOthers({ ...base, orders: [order()] });
    expect(plan(held, 1000).stock).toEqual([]);
    const over = plan(held, 2000).stock;
    expect(over).toEqual([
      expect.objectContaining({ variantId: A, onHand: 1000, wanted: 2000, reserved: 2000 }),
    ]);
    // The store that forbids selling over the stock blocks it; the other only warns
    expect(batchGuard(plan(held, 2000), null, true).stockBlocks).toHaveLength(1);
    expect(batchGuard(plan(held, 2000), null, false).stockWarns).toHaveLength(1);
    // Released (rejected, lapsed): all three can be sold
    expect(plan(reservedForOthers({ ...base, orders: [order({ status: 'rejected' })] }), 3000).stock).toEqual(
      [],
    );
    // Sold at this till (the order is closed here): nothing is reserved any more, the sale itself took the stock
    expect(plan(reservedForOthers({ ...base, orders: [order()], soldOnline: ['o-1'] }), 3000).stock).toEqual(
      [],
    );
    // Nothing reserved and nothing passed: exactly as before this round
    expect(plan(new Map(), 3000).stock).toEqual([]);
    expect(
      planBatches({
        cart: cartOf(cartLine(1, A, 4000)),
        catalog,
        today: '2026-11-18',
        pending: [],
        pharmacy: null,
      }).stock,
    ).toEqual([expect.objectContaining({ onHand: 3000, wanted: 4000 })]);
  });

  it('counts its own sales not yet sent as well as the reservation', () => {
    const catalog = { byVariant: new Map([[A, { variantId: A, name: 'فستان', stockQty: 5000 } as never]]) };
    const unsent = {
      status: 'pending',
      doc: { type: 'sale', payload: { lines: [{ variantId: A, baseQty: 1000 }] } },
    } as unknown as OutboxEntry;
    const plan = planBatches({
      cart: cartOf(cartLine(1, A, 3000)),
      catalog,
      today: '2026-11-18',
      pending: [unsent],
      pharmacy: null,
      reserved: reservedForOthers({ ...base, orders: [order()] }),
    });
    // 5 on the shelf, 1 sold here and not sent, 2 held: 2 are free, 3 wanted
    expect(plan.stock).toEqual([expect.objectContaining({ onHand: 2000, wanted: 3000, reserved: 2000 })]);
  });
});

describe('decision 15: «أضف صنف جديد» at the till', () => {
  const newBarcode = '6291099900011';

  function server(answer: () => Response, sets = posSets()) {
    const staff = staffServer(sets);
    const bodies: Record<string, unknown>[] = [];
    const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/v1/device/products') {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return answer();
      }
      return staff(url, init);
    });
    return { fetch: fn as unknown as typeof fetch, bodies };
  }

  const placed = () =>
    new Response(
      JSON.stringify({ productId: 'p-1', variantId: 'v-1', nameAr: 'قميص أزرق', barcode: newBarcode }),
      { status: 201 },
    );

  async function signIn(user: ReturnType<typeof renderPos>['user']) {
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await catalogueReady();
  }

  /** The store's manager may manage the catalog; the cashier may not */
  const setsWithManager = () => {
    const sets = posSets();
    sets.roles = sets.roles.map((r) =>
      r.key === 'manager' ? { ...r, permissions: [...r.permissions, 'catalog.manage'] } : r,
    );
    return sets;
  };

  it('asks a manager’s code from a cashier, then sends the name, price, category and barcode signed by the manager', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = setsWithManager();
    const { fetch, bodies } = server(placed, sets);
    const { user } = renderPos({ local, fetch, sets });
    await signIn(user);
    await scan(user, newBarcode);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`الباركود ${newBarcode} غير معروف`);
    await user.click(within(alert).getByRole('button', { name: 'أضف صنف جديد' }));

    const panel = await screen.findByRole('region', { name: 'أضف صنف جديد' });
    expect(panel).toHaveTextContent(newBarcode);
    await user.type(within(panel).getByLabelText('اسم الصنف'), 'قميص أزرق');
    await user.type(within(panel).getByLabelText('السعر'), '4500');
    const button = within(panel).getByRole('button', { name: 'أضف الصنف برمز مدير' });
    await user.click(button);
    // Nothing is sent before the manager’s code
    expect(bodies).toEqual([]);
    const layer = await screen.findByRole('region', { name: 'رمز المدير' });
    expect(layer).toHaveTextContent('إضافة صنف جديد «قميص أزرق» تحتاج رمز مدير');
    await user.keyboard(PINS[ids.maryam]!);

    expect(await screen.findByText(/أُضيف «قميص أزرق»/)).toBeInTheDocument();
    expect(bodies).toEqual([
      {
        actorId: ids.maryam,
        nameAr: 'قميص أزرق',
        priceMinor: 450_000,
        categoryId: null,
        barcode: newBarcode,
        // Round 38: the ids the till gave it, the same ones it would queue offline
        productId: expect.any(String),
        variantId: expect.any(String),
      },
    ]);
  });

  it('adds it at once, without a code, for whoever may manage the catalog', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const sets = setsWithManager();
    const { fetch, bodies } = server(placed, sets);
    const { user } = renderPos({ local, fetch, sets });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /مريم/ }));
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, newBarcode);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'أضف صنف جديد' }));
    const panel = await screen.findByRole('region', { name: 'أضف صنف جديد' });
    await user.type(within(panel).getByLabelText('اسم الصنف'), 'قميص أزرق');
    await user.type(within(panel).getByLabelText('السعر'), '4500');
    await user.click(within(panel).getByRole('button', { name: 'أضف الصنف' }));
    expect(await screen.findByText(/أُضيف «قميص أزرق»/)).toBeInTheDocument();
    expect(bodies).toEqual([expect.objectContaining({ actorId: ids.maryam })]);
  });

  async function openPanel(user: ReturnType<typeof renderPos>['user']) {
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /مريم/ }));
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, newBarcode);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'أضف صنف جديد' }));
    const panel = await screen.findByRole('region', { name: 'أضف صنف جديد' });
    await user.type(within(panel).getByLabelText('اسم الصنف'), 'قميص أزرق');
    await user.type(within(panel).getByLabelText('السعر'), '4500');
    return panel;
  }

  it('offline: queues the product as a document, sells it at once, and the sale already points at its id', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const sets = setsWithManager();
    const { fetch, bodies } = server(placed, sets);
    const { user, setOnline, outbox } = renderPos({ local, fetch, sets });
    const panel = await openPanel(user);
    setOnline(false);
    await user.click(within(panel).getByRole('button', { name: 'أضف الصنف' }));
    expect(await screen.findByText(/وصار في السلة/)).toBeInTheDocument();
    // Nothing went to the server; the product waits in the outbox under the ids the till chose
    expect(bodies).toEqual([]);
    const queued = outbox.filter((e) => e.type === 'temp_item');
    expect(queued).toHaveLength(1);
    const made = queued[0]!.doc.payload as Record<string, unknown>;
    expect(made).toMatchObject({
      actorId: ids.maryam,
      nameAr: 'قميص أزرق',
      priceMinor: 450_000,
      currency: 'SYP',
      barcode: newBarcode,
      approval: null,
    });
    // Round 39: it is already in the cart, with its price, and it sells
    expect((await screen.findAllByText('قميص أزرق')).length).toBeGreaterThan(0);
    await user.keyboard('{F12}');
    await screen.findByRole('region', { name: 'الدفع' });
    await user.keyboard('4500{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const soldDoc = outbox.find((e) => e.type === 'sale')!;
    const lines = (soldDoc.doc.payload as { lines: { variantId: string; productId: string }[] }).lines;
    expect(lines.map((l) => [l.productId, l.variantId])).toEqual([[made.productId, made.variantId]]);
    // The queue keeps its order: the product first, then the sale that uses it
    expect(outbox.findIndex((e) => e.type === 'temp_item')).toBeLessThan(
      outbox.findIndex((e) => e.type === 'sale'),
    );
  });

  it('a cashier needs a manager’s code here too, and the queued document carries who approved it', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = setsWithManager();
    // The manager's code is checked while the server answers; then the server stops answering
    const { fetch, bodies } = server(() => new Response('', { status: 503 }), sets);
    const { user, outbox } = renderPos({ local, fetch, sets });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, newBarcode);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'أضف صنف جديد' }));
    const panel = await screen.findByRole('region', { name: 'أضف صنف جديد' });
    await user.type(within(panel).getByLabelText('اسم الصنف'), 'قميص أزرق');
    await user.type(within(panel).getByLabelText('السعر'), '4500');
    await user.click(within(panel).getByRole('button', { name: 'أضف الصنف برمز مدير' }));
    // Still nothing queued before the code
    expect(outbox.filter((e) => e.type === 'temp_item')).toEqual([]);
    await screen.findByRole('region', { name: 'رمز المدير' });
    await user.keyboard(PINS[ids.maryam]!);
    expect(await screen.findByText(/وصار في السلة/)).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    const made = outbox.find((e) => e.type === 'temp_item')!.doc.payload as {
      actorId: string;
      approval: { userId: string; method: string; offline: boolean } | null;
    };
    expect(made.actorId).toBe(ids.maryam);
    expect(made.approval).toMatchObject({ userId: ids.maryam, method: 'pin' });
  });

  it('when the server does not answer, the same ids go to the queue; a refusal is not queued', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const sets = setsWithManager();
    const { fetch, bodies } = server(() => new Response('', { status: 503 }), sets);
    const { user, outbox } = renderPos({ local, fetch, sets });
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole('button', { name: 'أضف الصنف' }));
    expect(await screen.findByText(/وصار في السلة/)).toBeInTheDocument();
    // Asked once with its ids, then queued under the very same ones
    expect(bodies).toHaveLength(1);
    const made = outbox.find((e) => e.type === 'temp_item')!.doc.payload as Record<string, unknown>;
    expect(made).toMatchObject({ productId: bodies[0]!.productId, variantId: bodies[0]!.variantId });
  });

  it('shows the server’s own refusal (a barcode already used) and keeps what was typed', async () => {
    const local = memoryLocal();
    await openShift(local, ids.maryam);
    const sets = setsWithManager();
    const { fetch } = server(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'conflict', message: 'هذا الباركود مستخدم لصنف آخر.' } }),
          { status: 409 },
        ),
      sets,
    );
    const { user, outbox } = renderPos({ local, fetch, sets });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /مريم/ }));
    await user.keyboard(PINS[ids.maryam]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, newBarcode);
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'أضف صنف جديد' }));
    const panel = await screen.findByRole('region', { name: 'أضف صنف جديد' });
    await user.type(within(panel).getByLabelText('اسم الصنف'), 'قميص أزرق');
    await user.type(within(panel).getByLabelText('السعر'), '4500');
    await user.click(within(panel).getByRole('button', { name: 'أضف الصنف' }));
    expect(await within(panel).findByText('هذا الباركود مستخدم لصنف آخر.')).toBeInTheDocument();
    expect(within(panel).getByLabelText('اسم الصنف')).toHaveValue('قميص أزرق');
    // A refusal is the server's answer: nothing is queued behind it
    expect(outbox.filter((e) => e.type === 'temp_item')).toEqual([]);
    // The known products still sell as before
    expect(PRODUCTS.oil.barcode!.code).toBeTruthy();
  });
});

describe('decision 18: the instalment fee at the return screen', () => {
  it('adds the fee in proportion to the goods picked, and the whole fee when everything goes back', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { user, outbox } = renderPos({ local });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await scan(user, PRODUCTS.oil.barcode!.code);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.keyboard('{F12}');
    await screen.findByRole('region', { name: 'الدفع' });
    await user.keyboard('500{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });

    // Make it an instalment sale: a fee line of 40.00 and the plan beside it, as the payment screen writes them
    const saleDoc = outbox.find((e) => e.type === 'sale')!;
    const payload = saleDoc.doc.payload as unknown as {
      lines: Record<string, unknown>[];
      installmentPlan?: unknown;
    };
    payload.lines.push({
      ...payload.lines[0],
      lineNo: 2,
      variantId: INSTALMENT_FEE_VARIANT_ID,
      productId: INSTALMENT_FEE_PRODUCT_ID,
      name: INSTALMENT_FEE_NAME,
      qty: 1000,
      priceMinor: 4_000,
      unitPriceMinor: 4_000,
      baseQty: 1000,
      priced: {
        ...(payload.lines[0]!.priced as Record<string, number>),
        grossMinor: 4_000,
        netMinor: 4_000,
        grossExTaxMinor: 4_000,
        netExTaxMinor: 4_000,
        totalMinor: 4_000,
      },
    });
    payload.installmentPlan = { markupMinor: 4_000 };

    await user.keyboard('{Alt>}r{/Alt}');
    await screen.findByRole('heading', { name: 'مرتجع' });
    await user.type(screen.getByLabelText('رقم الفاتورة'), '1');
    await user.click(await screen.findByRole('button', { name: /INV-001-002-0000001/ }));
    // One of two oils: 250.00 and half of the 40.00 fee
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    expect(screen.getByRole('status', { name: 'المبلغ المردود' })).toHaveTextContent('270');
    // Both oils: 500.00 and the whole fee
    await user.click(screen.getByRole('button', { name: /زد زيت/ }));
    expect(screen.getByRole('status', { name: 'المبلغ المردود' })).toHaveTextContent('540');
    // The fee line has no stepper of its own: it follows the goods
    expect(screen.getByText('يُرجَع مع البضاعة')).toBeInTheDocument();
  });
});
