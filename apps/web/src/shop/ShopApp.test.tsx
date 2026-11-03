import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopHome, ShopProduct } from '@serva/core';
import { mockFetch, type MockRequest } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';
import { addLine, canPick, variantFor } from './cart';
import { openWhatsApp } from './open';

vi.mock('./open', () => ({ openWhatsApp: vi.fn() }));

const HOME: ShopHome = {
  store: {
    name: 'نور للأزياء',
    slug: 'nour',
    currency: 'SYP',
    whatsapp: '963933123456',
    delivery: true,
    pickup: true,
    note: 'التوصيل خلال يوم',
    orderMode: 'whatsapp',
  },
  categories: [
    { id: 'c-men', name: 'رجالي', parentId: null },
    { id: 'c-shirts', name: 'قمصان', parentId: 'c-men' },
    { id: 'c-kids', name: 'ولادي', parentId: null },
  ],
  products: [
    {
      id: 'p-shirt',
      name: 'قميص كتان',
      categoryId: 'c-shirts',
      imageUrl: '/v1/images/t/u1?size=thumb',
      currency: 'SYP',
      priceMinor: 450_000,
      maxPriceMinor: 460_000,
      available: true,
    },
    {
      id: 'p-pyjama',
      name: 'بيجاما',
      categoryId: 'c-kids',
      imageUrl: null,
      currency: 'SYP',
      priceMinor: 200_000,
      maxPriceMinor: 200_000,
      available: true,
    },
  ],
};

const attrs = (size: string, colour: string) => [
  { name: 'المقاس', value: size },
  { name: 'اللون', value: colour },
];
const SHIRT: ShopProduct = {
  id: 'p-shirt',
  name: 'قميص كتان',
  categoryId: 'c-shirts',
  currency: 'SYP',
  images: [
    { url: '/v1/images/t/u1', thumbUrl: '/v1/images/t/u1?size=thumb', optionValue: null },
    { url: '/v1/images/t/u2', thumbUrl: '/v1/images/t/u2?size=thumb', optionValue: 'أزرق' },
  ],
  options: [
    { name: 'المقاس', values: ['M', 'L'] },
    { name: 'اللون', values: ['أبيض', 'أزرق'] },
  ],
  variants: [
    { id: 'v-mw', label: 'M · أبيض', attributes: attrs('M', 'أبيض'), priceMinor: 450_000, available: true },
    { id: 'v-lw', label: 'L · أبيض', attributes: attrs('L', 'أبيض'), priceMinor: 460_000, available: true },
    { id: 'v-mb', label: 'M · أزرق', attributes: attrs('M', 'أزرق'), priceMinor: 450_000, available: false },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openWhatsApp).mockClear();
});

describe('the online shop', () => {
  it('browses by department, picks a size and colour on the shelf, fills the cart and orders on WhatsApp', async () => {
    const { requestsTo } = mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/products/p-shirt': { status: 200, body: SHIRT },
      'POST /v1/shop/nour/orders': (r: MockRequest) => {
        expect(r.body).toEqual({
          name: 'ريم',
          phone: '0944555666',
          fulfilment: 'delivery',
          address: 'المزة',
          note: null,
          lines: [
            { variantId: 'v-lw', qty: 2 },
            { variantId: 'v-mw', qty: 1 },
          ],
        });
        return {
          status: 201,
          body: {
            trackPath: '/shop/nour/o/t0',
            number: 'ONL-000007',
            currency: 'SYP',
            totalMinor: 1_370_000,
            message: 'طلب',
            whatsappUrl: 'https://wa.me/963933123456?text=x',
          },
        };
      },
    });
    const { user } = renderApp('/shop/nour');
    const grid = await screen.findByRole('list', { name: 'البضاعة' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2);
    // «رجالي» holds the shirts of its sub-category
    await user.click(screen.getByRole('button', { name: 'رجالي' }));
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1);
    expect(grid).toHaveTextContent('من');
    await user.click(within(grid).getByRole('link', { name: /قميص كتان/ }));

    const page = await screen.findByRole('article', { name: 'قميص كتان' });
    const add = within(page).getByRole('button', { name: /اختر/ });
    expect(add).toBeDisabled();
    // Blue comes only in M, and M blue ran out: with L chosen, blue cannot be picked
    await user.click(within(page).getByRole('button', { name: 'L' }));
    expect(within(page).getByRole('button', { name: 'أزرق' })).toBeDisabled();
    await user.click(within(page).getByRole('button', { name: 'أبيض' }));
    await user.click(within(page).getByRole('button', { name: 'زد' }));
    await user.click(within(page).getByRole('button', { name: 'أضف إلى السلة' }));
    expect(await screen.findByText('أُضيفت إلى السلة.')).toBeInTheDocument();
    // Then one M
    await user.click(within(page).getByRole('button', { name: 'M' }));
    await user.click(within(page).getByRole('button', { name: 'أنقص' }));
    await user.click(within(page).getByRole('button', { name: 'أضف إلى السلة' }));
    expect(screen.getByRole('link', { name: 'السلة، 3 قطعة' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'السلة، 3 قطعة' }));
    const cart = await screen.findByRole('region', { name: 'السلة' });
    expect(cart).toHaveTextContent('L · أبيض');
    expect(cart).toHaveTextContent('13,700');
    // The cart is kept on the phone
    expect(JSON.parse(localStorage.getItem('serva-shop-cart:nour')!)).toHaveLength(2);

    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.type(screen.getByLabelText('العنوان'), 'المزة');
    await user.click(screen.getByRole('button', { name: 'اطلب عبر واتساب' }));
    expect(await screen.findByRole('region', { name: 'وصل طلبك' })).toHaveTextContent('ONL-000007');
    expect(openWhatsApp).toHaveBeenCalledWith('https://wa.me/963933123456?text=x');
    expect(requestsTo('POST', '/v1/shop/nour/orders')).toHaveLength(1);
    expect(localStorage.getItem('serva-shop-cart:nour')).toBe('[]');
  });

  it('in «من المتجر مباشرة» confirms the phone by a code, then links the order’s own page', async () => {
    localStorage.setItem(
      'serva-shop-cart:nour',
      JSON.stringify([
        {
          variantId: 'v-lw',
          productId: 'p-shirt',
          name: 'قميص كتان',
          label: 'L · أبيض',
          imageUrl: null,
          priceMinor: 460_000,
          qty: 1,
        },
      ]),
    );
    const { requestsTo } = mockFetch({
      'GET /v1/shop/nour': {
        status: 200,
        body: { ...HOME, store: { ...HOME.store, orderMode: 'shop', whatsapp: null } },
      },
      'POST /v1/shop/nour/orders/code': (r: MockRequest) => {
        expect(r.body).toEqual({ phone: '0944555666' });
        return { status: 200, body: { challengeId: 'ch-1', expiresIn: 600, testCode: '424242' } };
      },
      'POST /v1/shop/nour/orders': (r: MockRequest) => {
        expect(r.body).toMatchObject({ challengeId: 'ch-1', code: '424242', fulfilment: 'pickup' });
        return {
          status: 201,
          body: {
            trackPath: '/shop/nour/o/abc123',
            number: 'ONL-000008',
            currency: 'SYP',
            totalMinor: 460_000,
            message: 'طلب',
            whatsappUrl: null,
          },
        };
      },
      'GET /v1/shop/nour/orders/abc123': {
        status: 200,
        body: {
          number: 'ONL-000008',
          status: 'accepted',
          fulfilment: 'pickup',
          currency: 'SYP',
          totalMinor: 460_000,
          lines: [{ name: 'قميص كتان', label: 'L · أبيض', qty: 1, totalMinor: 460_000 }],
          createdAt: '2026-11-03T10:00:00Z',
        },
      },
    });
    const { user } = renderApp('/shop/nour/cart');
    await screen.findByRole('region', { name: 'السلة' });
    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.click(screen.getByRole('button', { name: 'استلام من المحل' }));
    expect(screen.queryByRole('button', { name: 'اطلب عبر واتساب' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أرسل رمز التأكيد' }));
    const code = await screen.findByLabelText('رمز التأكيد');
    expect(screen.getByText('وضع التجربة: الرمز 424242')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أكّد الطلب' })).toBeDisabled();
    await user.type(code, '42-42 42');
    await user.click(screen.getByRole('button', { name: 'أكّد الطلب' }));
    const done = await screen.findByRole('region', { name: 'وصل طلبك' });
    expect(done).toHaveTextContent('وصل طلبك إلى المحل');
    expect(openWhatsApp).not.toHaveBeenCalled();
    expect(requestsTo('POST', '/v1/shop/nour/orders')).toHaveLength(1);

    await user.click(within(done).getByRole('link', { name: 'تابع طلبك' }));
    const page = await screen.findByRole('region', { name: 'طلبك' });
    expect(page).toHaveTextContent('ONL-000008');
    expect(within(page).getByRole('status')).toHaveTextContent('أكّد المحل طلبك');
  });

  it('says so when the link is not a shop', async () => {
    mockFetch({
      'GET /v1/shop/nothing': {
        status: 404,
        body: { error: { code: 'not_found', message: 'هذا المتجر غير موجود أو غير مفعّل.' } },
      },
    });
    renderApp('/shop/nothing');
    expect(await screen.findByText('هذا المتجر غير موجود أو غير مفعّل.')).toBeInTheDocument();
  });

  it('knows which piece the values name and which values are still possible', () => {
    expect(variantFor(SHIRT, { المقاس: 'L', اللون: 'أبيض' })?.id).toBe('v-lw');
    expect(variantFor(SHIRT, { المقاس: 'L' })).toBeNull();
    expect(canPick(SHIRT, {}, 'اللون', 'أزرق')).toBe(false);
    expect(canPick(SHIRT, { المقاس: 'M' }, 'اللون', 'أبيض')).toBe(true);
    const line = {
      variantId: 'v',
      productId: 'p',
      name: 'n',
      label: null,
      imageUrl: null,
      priceMinor: 1,
      qty: 40,
    };
    expect(addLine(addLine([], line), line)[0]!.qty).toBe(50);
  });
});
