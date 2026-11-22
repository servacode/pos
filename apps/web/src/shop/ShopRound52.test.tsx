import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShopHome } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';

/** Round 52: «توصيل مجاني فوق مبلغ» in the shop, the confirmation's total with delivery. */

const HOME: ShopHome = {
  store: {
    name: 'نور للأزياء',
    slug: 'nour',
    currency: 'SYP',
    whatsapp: '963933123456',
    delivery: true,
    pickup: true,
    note: null,
    orderMode: 'whatsapp',
    showPrices: true,
    deliveryFeeMinor: 10_000,
    freeDeliveryOverMinor: 500_000,
    deliveryAreas: [],
  },
  categories: [],
  products: [
    {
      id: 'p-shirt',
      name: 'قميص كتان',
      categoryId: null,
      imageUrl: null,
      currency: 'SYP',
      priceMinor: 450_000,
      maxPriceMinor: 450_000,
      wasPriceMinor: null,
      offer: null,
      available: true,
      createdAt: '2026-11-01T10:00:00.000Z',
      options: [],
    },
  ],
};

const cartWith = (qty: number) =>
  localStorage.setItem(
    'serva-shop-cart:nour',
    JSON.stringify([
      {
        variantId: 'v-1',
        productId: 'p-shirt',
        name: 'قميص كتان',
        label: null,
        imageUrl: null,
        priceMinor: 450_000,
        qty,
      },
    ]),
  );

beforeEach(() => localStorage.clear());

describe('round 52: free delivery over an amount', () => {
  it('announces it at the top of the shop', async () => {
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME } });
    renderApp('/shop/nour');
    expect(await screen.findByText(/توصيل مجاني للطلبات فوق/)).toHaveTextContent('5,000');
  });

  it('does not announce it for a store that keeps its prices to itself', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: { ...HOME, store: { ...HOME.store, showPrices: false } } },
    });
    renderApp('/shop/nour');
    await screen.findByRole('list', { name: 'البضاعة' });
    expect(screen.queryByText(/توصيل مجاني للطلبات فوق/)).toBeNull();
  });

  it('tells the customer how much is missing, then drops the courier fee once the cart reaches it', async () => {
    cartWith(1);
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME } });
    const { user } = renderApp('/shop/nour/cart');
    const cart = await screen.findByRole('region', { name: 'السلة' });
    // 4,500 is short of 5,000: the fee stays and the gap is named
    expect(cart).toHaveTextContent('أجرة التوصيل (للمندوب)');
    expect(cart).toHaveTextContent(/أضف بقيمة[^]*500[^]*ويصبح التوصيل مجاناً/);
    await user.click(screen.getByRole('button', { name: 'زد' }));
    expect(cart).toHaveTextContent('مجاني');
    expect(cart).not.toHaveTextContent('أجرة التوصيل (للمندوب)');
    expect(cart).not.toHaveTextContent('ويصبح التوصيل مجاناً');
  });

  it('picking up from the store never shows the gap or a fee', async () => {
    cartWith(1);
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME } });
    const { user } = renderApp('/shop/nour/cart');
    const cart = await screen.findByRole('region', { name: 'السلة' });
    await user.click(screen.getByRole('button', { name: 'استلام من المحل' }));
    expect(cart).not.toHaveTextContent('ويصبح التوصيل مجاناً');
    expect(cart).not.toHaveTextContent('أجرة التوصيل');
  });

  it('after ordering, the receipt shows the total with the delivery', async () => {
    cartWith(1);
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'POST /v1/shop/nour/orders': {
        status: 201,
        body: {
          trackPath: '/shop/nour/o/t1',
          number: 'ONL-000009',
          currency: 'SYP',
          totalMinor: 450_000,
          deliveryFeeMinor: 10_000,
          message: 'طلب',
          whatsappUrl: 'https://wa.me/963933123456?text=x',
        },
      },
    });
    const { user } = renderApp('/shop/nour/cart');
    await screen.findByRole('region', { name: 'السلة' });
    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.type(screen.getByLabelText('العنوان'), 'المزة');
    await user.click(screen.getByRole('button', { name: 'اطلب عبر واتساب' }));
    const done = await screen.findByRole('region', { name: 'وصل طلبك' });
    expect(done).toHaveTextContent('المجموع مع التوصيل');
    expect(done).toHaveTextContent('4,600');
  });
});
