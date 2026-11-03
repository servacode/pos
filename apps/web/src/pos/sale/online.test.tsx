import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import { validateDocumentPayload } from '@serva/core/contracts/documents';
import type { OnlineOrderRow } from '@serva/core/contracts/shop';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS, staffServer } from '../../test/pos';
import { openShift, renderPos, scan } from '../../test/renderPos';
import { ONLINE_SOLD_KEY, orderCart, waitingOrders } from './onlineOrders';

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const order = (over: Partial<OnlineOrderRow> = {}): OnlineOrderRow => ({
  id: '0192a3b4-c5d6-7e8f-9a0b-00000000a001',
  number: 'ONL-000001',
  status: 'accepted',
  customerName: 'ريم',
  phone: '+963944555666',
  fulfilment: 'pickup',
  address: null,
  note: null,
  currency: 'SYP',
  totalMinor: 50_000,
  depositCode: null,
  lines: [
    {
      variantId: PRODUCTS.oil.variant.id,
      productId: PRODUCTS.oil.product.id,
      name: 'زيت دوار الشمس 1 لتر',
      label: null,
      qty: 2,
      priceMinor: 25_000,
      totalMinor: 50_000,
    },
  ],
  version: 2,
  ...over,
});

async function signIn(user: ReturnType<typeof renderPos>['user']) {
  const list = await screen.findByRole('list', { name: 'الموظفون' });
  await user.click(within(list).getByRole('button', { name: /سامر/ }));
  await user.keyboard(PINS[ids.samer]!);
  await screen.findByRole('list', { name: 'الأصناف' });
}

describe('«طلبات المتجر» at the till (26 › حياة الطلب)', () => {
  it('opens an accepted order into the cart and the sale carries it, then it leaves the list', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = posSets();
    sets.online_orders = [order(), order({ id: '0192a3b4-c5d6-7e8f-9a0b-00000000a002', status: 'done' })];
    const { user, outbox } = renderPos({ local, sets });
    await signIn(user);
    await user.click(screen.getByRole('button', { name: 'طلبات المتجر (1)' }));
    const panel = await screen.findByRole('region', { name: 'طلبات المتجر' });
    const row = within(panel).getByRole('listitem', { name: 'الطلب ONL-000001' });
    expect(row).toHaveTextContent('ريم');
    await user.click(within(row).getByRole('button', { name: 'افتح في السلة' }));

    expect(await screen.findByText(/فُتح طلب المتجر ONL-000001/)).toBeInTheDocument();
    const lines = screen.getByRole('list', { name: 'أسطر الفاتورة' });
    expect(lines).toHaveTextContent('زيت دوار الشمس');
    expect(screen.getByText(/يُغلق عند الدفع/)).toBeInTheDocument();

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(validateDocumentPayload('sale', sale)).toEqual({ ok: true, checked: true });
    expect(sale.onlineOrderId).toBe(order().id);
    expect(sale.lines).toEqual([expect.objectContaining({ variantId: PRODUCTS.oil.variant.id, qty: 2000 })]);
    // Sold here: not offered again before the pull says it is done
    expect(screen.queryByRole('button', { name: /طلبات المتجر/ })).not.toBeInTheDocument();
    expect(await local.get(ONLINE_SOLD_KEY)).toEqual([order().id]);
  });

  it('does not open an order over a cart in progress', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = posSets();
    sets.online_orders = [order()];
    const { user } = renderPos({ local, sets });
    await signIn(user);
    await scan(user, PRODUCTS.tea.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'طلبات المتجر (1)' }));
    await user.click(await screen.findByRole('button', { name: 'افتح في السلة' }));
    expect(await screen.findByText(/أنهِ الفاتورة الحالية/)).toBeInTheDocument();
    expect(screen.queryByText(/يُغلق عند الدفع/)).not.toBeInTheDocument();
  });

  it('names the pieces this device does not have, and skips orders already sold here', () => {
    const catalog = { byVariant: new Map() };
    const { cart, missing } = orderCart(
      order({ lines: [{ ...order().lines[0]!, name: 'فستان', label: 'M' }] }),
      catalog,
    );
    expect(cart.lines).toEqual([]);
    expect(cart.onlineOrder).toEqual({ id: order().id, number: 'ONL-000001', customerName: 'ريم' });
    expect(missing).toEqual(['فستان (M)']);
    expect(waitingOrders([order()], [order().id])).toEqual([]);
  });
});

describe('«احجز» at the till (03 › الألبسة: الحجز بعربون)', () => {
  function server(answer: () => Response) {
    const staff = staffServer();
    const holds: Record<string, unknown>[] = [];
    const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/v1/device/holds') {
        holds.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return answer();
      }
      return staff(url, init);
    });
    return { fetch: fn as unknown as typeof fetch, holds };
  }

  it('takes the deposit as a voucher, then holds the cart with its code', async () => {
    const local = memoryLocal();
    await openShift(local);
    const { fetch, holds } = server(
      () =>
        new Response(
          JSON.stringify({ id: 'h-1', number: 'ONL-000004', currency: 'SYP', totalMinor: 50_000 }),
          { status: 201 },
        ),
    );
    const { user, outbox } = renderPos({ local, fetch });
    await signIn(user);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'احجز' }));
    const panel = await screen.findByRole('region', { name: 'احجز للزبون' });
    await user.type(within(panel).getByLabelText('اسم الزبون'), 'سلمى');
    await user.type(within(panel).getByLabelText('جوال الزبون'), '0933111222');
    await user.type(within(panel).getByLabelText('العربون نقداً (اختياري)'), '100');
    await user.click(within(panel).getByRole('button', { name: 'احجز' }));

    expect(await screen.findByText(/حُجز ONL-000004/)).toBeInTheDocument();
    const voucher = outbox.find((e) => e.type === 'gift_voucher')!;
    expect(voucher.doc.payload).toMatchObject({ amountMinor: 10_000, method: 'cash' });
    expect(holds).toEqual([
      expect.objectContaining({
        customerName: 'سلمى',
        phone: '0933111222',
        depositCode: voucher.doc.number,
        lines: [{ variantId: PRODUCTS.oil.variant.id, qty: 2 }],
      }),
    ]);
    // The cart is empty for the next customer
    expect(screen.queryByRole('list', { name: 'أسطر الفاتورة' })).not.toBeInTheDocument();
  });

  it('keeps the deposit when the hold does not reach the server, and sends it again without a second one', async () => {
    const local = memoryLocal();
    await openShift(local);
    let up = false;
    const { fetch, holds } = server(() =>
      up
        ? new Response(
            JSON.stringify({ id: 'h-1', number: 'ONL-000005', currency: 'SYP', totalMinor: 25_000 }),
            {
              status: 201,
            },
          )
        : new Response('{}', { status: 503 }),
    );
    const { user, outbox } = renderPos({ local, fetch });
    await signIn(user);
    await scan(user, PRODUCTS.oil.barcode!.code);
    await user.click(screen.getByRole('button', { name: 'احجز' }));
    const panel = await screen.findByRole('region', { name: 'احجز للزبون' });
    await user.type(within(panel).getByLabelText('اسم الزبون'), 'سلمى');
    await user.type(within(panel).getByLabelText('جوال الزبون'), '0933111222');
    await user.type(within(panel).getByLabelText('العربون نقداً (اختياري)'), '50');
    await user.click(within(panel).getByRole('button', { name: 'احجز' }));
    expect(await within(panel).findByText(/ولم يصل الحجز إلى الخادم/)).toBeInTheDocument();
    up = true;
    await user.click(within(panel).getByRole('button', { name: 'أعد إرسال الحجز' }));
    expect(await screen.findByText(/حُجز ONL-000005/)).toBeInTheDocument();
    expect(outbox.filter((e) => e.type === 'gift_voucher')).toHaveLength(1);
    expect(holds).toHaveLength(2);
  });

  it('opens a hold at pickup with its deposit voucher offered first', () => {
    const { cart } = orderCart(order({ depositCode: 'GFT-001-001-0000009' }), { byVariant: new Map() });
    expect(cart.voucher).toBe('GFT-001-001-0000009');
  });
});
