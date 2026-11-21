import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalePayload } from '@serva/core/contracts/documents';
import type { OnlineOrderRow, OrderCouponRule } from '@serva/core/contracts/shop';
import { memoryLocal } from '../../offline/local';
import { ids, PINS, posSets, PRODUCTS } from '../../test/pos';
import { openShift, renderPos } from '../../test/renderPos';
import { couponPromotion } from './cart';
import { orderCart } from './onlineOrders';

/** «كود الخصم»: the offer a shop order's code opened prices that order's sale at the till (26) */

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const RULE: OrderCouponRule = {
  id: '0192a3b4-c5d6-7e8f-9a0b-0000000000c1',
  name: 'خصم الصيف',
  kind: 'percent',
  percentBp: 1000,
  buyQty: null,
  getQty: null,
  scope: 'all',
  categoryIds: [],
  productIds: [],
  couponCode: 'SUMMER10',
};

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
  deliveryFeeMinor: 0,
  deliveryArea: null,
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
  couponRule: RULE,
  version: 2,
  ...over,
});

describe('the coupon of a shop order at the till', () => {
  it('turns the order’s offer into a promotion that runs for that sale alone', () => {
    expect(couponPromotion(RULE)).toMatchObject({
      name: 'خصم الصيف',
      percentBp: 1000,
      startsAt: null,
      endsAt: null,
      daysOfWeek: [],
      archived: false,
    });
    const { cart } = orderCart(order(), { byVariant: new Map() });
    expect(cart.onlineOrder?.couponRule).toEqual(RULE);
    // No coupon: the cart carries none
    expect(orderCart(order({ couponRule: null }), { byVariant: new Map() }).cart.onlineOrder).toEqual({
      id: order().id,
      number: 'ONL-000001',
      customerName: 'ريم',
    });
  });

  it('prices the opened order with the offer, and the sale carries the promotion’s discount', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = posSets();
    sets.online_orders = [order()];
    const { user, outbox } = renderPos({ local, sets });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    await user.click(screen.getByRole('button', { name: 'طلبات المتجر (1)' }));
    await user.click(await screen.findByRole('button', { name: 'افتح في السلة' }));
    await screen.findByText(/فُتح طلب المتجر ONL-000001/);
    // The line shows the offer's name as its discount's reason
    const lines = screen.getByRole('list', { name: 'أسطر الفاتورة' });
    expect(await within(lines).findByText(/خصم الصيف/)).toBeInTheDocument();

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('region', { name: 'الدفع' });
    await user.click(within(pay).getByRole('button', { name: /المبلغ تماماً/ }));
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: 'تمت البيعة' });
    const sale = outbox.find((e) => e.type === 'sale')!.doc.payload as unknown as SalePayload;
    expect(sale.onlineOrderId).toBe(order().id);
    expect(JSON.stringify(sale)).toContain('خصم الصيف');
  });

  it('applies no coupon offer to an ordinary sale', async () => {
    const local = memoryLocal();
    await openShift(local);
    const sets = posSets();
    // A coupon's promotion as the server sends it to every till: masked as stopped
    sets.promotions = [
      {
        ...RULE,
        startsAt: null,
        endsAt: null,
        daysOfWeek: [],
        fromTime: null,
        toTime: null,
        archived: true,
        version: 1,
      },
    ];
    sets.online_orders = [];
    const { user } = renderPos({ local, sets });
    const list = await screen.findByRole('list', { name: 'الموظفون' });
    await user.click(within(list).getByRole('button', { name: /سامر/ }));
    await user.keyboard(PINS[ids.samer]!);
    await screen.findByRole('list', { name: 'الأصناف' });
    expect(screen.queryByText(/خصم الصيف/)).not.toBeInTheDocument();
  });
});
