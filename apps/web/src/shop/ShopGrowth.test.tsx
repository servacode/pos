import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopHome, ShopOrderTrack, ShopProduct } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';
import { canChoose, canPick } from './cart';
import { accentStyle } from './ShopExtras';
import { openWhatsApp } from './open';

vi.mock('./open', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openWhatsApp: vi.fn(),
}));

/** The shop's growth: its look, the product's text, «أبلغني عند التوفر», the coupon and the delivery stage */

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
    deliveryFeeMinor: 0,
    deliveryAreas: [],
    tagline: 'أناقة كل يوم',
    accent: 'teal',
    logoUrl: '/v1/images/t/logo?size=thumb',
    coverUrl: '/v1/images/t/cover',
  },
  categories: [],
  products: [
    {
      id: 'p-shirt',
      name: 'قميص كتان',
      categoryId: null,
      imageUrl: null,
      currency: 'SYP',
      priceMinor: 500_000,
      maxPriceMinor: 500_000,
      wasPriceMinor: null,
      offer: null,
      available: true,
      createdAt: '2026-11-01T10:00:00.000Z',
      options: [{ name: 'المقاس', values: ['M'] }],
    },
  ],
};

const SHIRT: ShopProduct = {
  id: 'p-shirt',
  name: 'قميص كتان',
  categoryId: null,
  currency: 'SYP',
  showPrices: true,
  images: [],
  options: [{ name: 'المقاس', values: ['M', 'L'] }],
  variants: [
    {
      id: 'v-m',
      label: 'M',
      attributes: [{ name: 'المقاس', value: 'M' }],
      priceMinor: 500_000,
      wasPriceMinor: null,
      available: true,
      left: null,
    },
    {
      id: 'v-l',
      label: 'L',
      attributes: [{ name: 'المقاس', value: 'L' }],
      priceMinor: 500_000,
      wasPriceMinor: null,
      available: false,
      left: null,
    },
  ],
  offer: null,
  description: 'قميص ناعم.\nيُغسل بالماء البارد',
  sizeGuide: 'M: 38 <script>window.hacked = 1</script>',
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openWhatsApp).mockClear();
});

describe('the shop’s look', () => {
  it('shows the logo, the tagline and the cover, and takes the accent from the identity’s tokens', async () => {
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME } });
    renderApp('/shop/nour');
    await screen.findByRole('list', { name: 'البضاعة' });
    const header = screen.getByRole('banner');
    expect(within(header).getByText('أناقة كل يوم')).toBeInTheDocument();
    expect(header.querySelector('img')).toHaveAttribute('src', '/v1/images/t/logo?size=thumb');
    expect(document.querySelector('img[src="/v1/images/t/cover"]')).not.toBeNull();
    const root = header.closest('[dir="rtl"]') as HTMLElement;
    expect(root.style.getPropertyValue('--color-brand')).toBe('var(--color-accent)');
    expect(root.style.getPropertyValue('--color-on-brand')).toBe('var(--color-on-accent)');
  });

  it('keeps the brand emerald when the accent is emerald or unknown, and never takes a free colour', () => {
    expect(accentStyle('emerald')).toBeUndefined();
    expect(accentStyle(undefined)).toBeUndefined();
    const blue = accentStyle('blue') as Record<string, string>;
    expect(blue['--color-brand']).toBe('var(--color-info)');
    expect(Object.values(blue).every((v) => v.startsWith('var(--color-'))).toBe(true);
  });

  it('falls back to the monogram without a logo', async () => {
    mockFetch({
      'GET /v1/shop/nour': {
        status: 200,
        body: { ...HOME, store: { ...HOME.store, logoUrl: null, coverUrl: null, tagline: null } },
      },
    });
    renderApp('/shop/nour');
    await screen.findByRole('list', { name: 'البضاعة' });
    const header = screen.getByRole('banner');
    expect(header.querySelector('img')).toBeNull();
  });
});

describe('the product page’s text and «أبلغني عند التوفر»', () => {
  it('shows the description and the size guide as plain text, markup and all', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/products/p-shirt': { status: 200, body: SHIRT },
    });
    renderApp('/shop/nour/p/p-shirt');
    const page = await screen.findByRole('article', { name: 'قميص كتان' });
    expect(within(page).getByRole('region', { name: 'وصف المنتج' })).toHaveTextContent('يُغسل بالماء البارد');
    const guide = within(page).getByRole('region', { name: 'دليل المقاسات' });
    // The markup is read as typed, never run
    expect(guide).toHaveTextContent('<script>window.hacked = 1</script>');
    expect(page.querySelector('script')).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it('lets a piece that ran out be chosen, to wait for it, while a piece that does not exist cannot', () => {
    expect(canPick(SHIRT, { المقاس: 'M' }, 'المقاس', 'L')).toBe(false);
    expect(canChoose(SHIRT, {}, 'المقاس', 'L')).toBe(true);
    expect(canChoose(SHIRT, {}, 'المقاس', 'XL')).toBe(false);
  });

  it('shows nothing of the sort when the store wrote none', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/products/p-shirt': {
        status: 200,
        body: { ...SHIRT, description: null, sizeGuide: null },
      },
    });
    renderApp('/shop/nour/p/p-shirt');
    const page = await screen.findByRole('article', { name: 'قميص كتان' });
    expect(within(page).queryByRole('region', { name: 'وصف المنتج' })).not.toBeInTheDocument();
    expect(within(page).queryByRole('region', { name: 'دليل المقاسات' })).not.toBeInTheDocument();
  });

  it('leaves a phone on a piece that ran out, once, and says what is wrong with a bad one', async () => {
    let calls = 0;
    const { requestsTo } = mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/products/p-shirt': { status: 200, body: SHIRT },
      'POST /v1/shop/nour/products/p-shirt/notify': (r: MockRequest) => {
        calls += 1;
        expect(r.body).toEqual({ variantId: 'v-l', phone: calls === 1 ? '12' : '0944555666' });
        return calls === 1
          ? apiError(400, 'validation_failed', 'خطأ', { phone: 'رقم غير صحيح' })
          : { status: 204 };
      },
    });
    const { user } = renderApp('/shop/nour/p/p-shirt');
    const page = await screen.findByRole('article', { name: 'قميص كتان' });
    // A piece on the shelf offers no waiting list
    await user.click(within(page).getByRole('button', { name: 'M' }));
    expect(within(page).queryByRole('form', { name: 'أبلغني عند التوفر' })).not.toBeInTheDocument();
    await user.click(within(page).getByRole('button', { name: /^L/ }));
    const form = await within(page).findByRole('form', { name: 'أبلغني عند التوفر' });
    await user.type(within(form).getByLabelText('رقم الجوال'), '12');
    await user.click(within(form).getByRole('button', { name: 'أبلغني عند التوفر' }));
    expect(await within(form).findByText('رقم غير صحيح')).toBeInTheDocument();
    await user.clear(within(form).getByLabelText('رقم الجوال'));
    await user.type(within(form).getByLabelText('رقم الجوال'), '0944555666');
    await user.click(within(form).getByRole('button', { name: 'أبلغني عند التوفر' }));
    expect(await within(page).findByText(/سجّلنا رقمك/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/shop/nour/products/p-shirt/notify')).toHaveLength(2);
  });
});

describe('the coupon in the cart', () => {
  const placed = {
    trackPath: '/shop/nour/o/t1',
    number: 'ONL-000001',
    currency: 'SYP',
    showPrices: true,
    totalMinor: 450_000,
    deliveryFeeMinor: 0,
    message: 'طلب',
    whatsappUrl: null,
  };

  async function toCart(routes: Parameters<typeof mockFetch>[0]) {
    localStorage.setItem(
      'serva-shop-cart:nour',
      JSON.stringify([
        {
          variantId: 'v-m',
          productId: 'p-shirt',
          name: 'قميص كتان',
          label: 'M',
          imageUrl: null,
          priceMinor: 500_000,
          qty: 1,
        },
      ]),
    );
    const mock = mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME }, ...routes });
    const { user } = renderApp('/shop/nour/cart');
    await screen.findByRole('region', { name: 'السلة' });
    return { ...mock, user };
  }

  it('checks the code with the server, shows its offer and sends it with the order', async () => {
    const { user, requestsTo } = await toCart({
      'GET /v1/shop/nour/coupon?code=summer10': { status: 200, body: { name: 'خصم الصيف', percentBp: 1000 } },
      'POST /v1/shop/nour/orders': (r: MockRequest) => {
        expect((r.body as { coupon?: string }).coupon).toBe('summer10');
        return { status: 201, body: placed };
      },
    });
    const box = screen.getByRole('form', { name: 'كود الخصم' });
    await user.type(within(box).getByLabelText('كود الخصم (اختياري)'), 'summer10');
    await user.click(within(box).getByRole('button', { name: 'طبّق' }));
    expect(await screen.findByText(/خصم الصيف/)).toBeInTheDocument();
    // 10% off 5,000 as the cart can tell it
    const cart = screen.getByRole('region', { name: 'السلة' });
    expect(cart).toHaveTextContent('خصم الكود');
    expect(cart).toHaveTextContent('4,500');

    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.type(screen.getByLabelText('العنوان'), 'المزة');
    await user.click(screen.getByRole('button', { name: 'اطلب عبر واتساب' }));
    expect(await screen.findByRole('region', { name: 'وصل طلبك' })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/shop/nour/orders')).toHaveLength(1);
  });

  it('says the code is wrong and orders without one; a code can be taken off', async () => {
    const { user, requestsTo } = await toCart({
      'GET /v1/shop/nour/coupon?code=nope': apiError(400, 'validation_failed', 'خطأ', {
        coupon: 'هذا الكود غير صحيح أو انتهت مدته.',
      }),
      'GET /v1/shop/nour/coupon?code=ok': { status: 200, body: { name: 'عرض', percentBp: null } },
      'POST /v1/shop/nour/orders': (r: MockRequest) => {
        expect(r.body).not.toHaveProperty('coupon');
        return { status: 201, body: placed };
      },
    });
    const box = screen.getByRole('form', { name: 'كود الخصم' });
    await user.type(within(box).getByLabelText('كود الخصم (اختياري)'), 'nope');
    await user.click(within(box).getByRole('button', { name: 'طبّق' }));
    expect(await screen.findByText('هذا الكود غير صحيح أو انتهت مدته.')).toBeInTheDocument();
    await user.clear(within(box).getByLabelText('كود الخصم (اختياري)'));
    await user.type(within(box).getByLabelText('كود الخصم (اختياري)'), 'ok');
    await user.click(within(box).getByRole('button', { name: 'طبّق' }));
    expect(await screen.findByRole('button', { name: 'أزل الكود' })).toBeInTheDocument();
    // An offer with no percent shows no figure
    expect(screen.getByRole('region', { name: 'السلة' })).not.toHaveTextContent('خصم الكود');
    await user.click(screen.getByRole('button', { name: 'أزل الكود' }));
    expect(screen.getByRole('form', { name: 'كود الخصم' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.type(screen.getByLabelText('العنوان'), 'المزة');
    await user.click(screen.getByRole('button', { name: 'اطلب عبر واتساب' }));
    expect(await screen.findByRole('region', { name: 'وصل طلبك' })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/shop/nour/orders')).toHaveLength(1);
  });

  it('shows no discount figure when the store hides its prices', async () => {
    localStorage.setItem(
      'serva-shop-cart:nour',
      JSON.stringify([
        {
          variantId: 'v-m',
          productId: 'p-shirt',
          name: 'قميص كتان',
          label: 'M',
          imageUrl: null,
          priceMinor: 0,
          qty: 1,
        },
      ]),
    );
    mockFetch({
      'GET /v1/shop/nour': {
        status: 200,
        body: { ...HOME, store: { ...HOME.store, showPrices: false } },
      },
      'GET /v1/shop/nour/coupon?code=ok': { status: 200, body: { name: 'عرض', percentBp: null } },
    });
    const { user } = renderApp('/shop/nour/cart');
    await screen.findByRole('region', { name: 'السلة' });
    await user.type(screen.getByLabelText('كود الخصم (اختياري)'), 'ok');
    await user.click(screen.getByRole('button', { name: 'طبّق' }));
    expect(await screen.findByText(/عرض/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'السلة' })).not.toHaveTextContent('خصم الكود');
  });
});

describe('the delivery stage on the order’s page', () => {
  const TRACK: ShopOrderTrack = {
    number: 'ONL-000021',
    status: 'accepted',
    deliveryStage: 'out',
    customerName: 'ريم',
    fulfilment: 'delivery',
    area: 'المزة',
    currency: 'SYP',
    showPrices: true,
    totalMinor: 500_000,
    deliveryFeeMinor: 10_000,
    lines: [{ name: 'قميص كتان', label: 'M', qty: 1, totalMinor: 500_000 }],
    createdAt: '2026-11-03T10:00:00Z',
  };

  it('says it went out for delivery, with its four steps, then that it was delivered', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/orders/abc': { status: 200, body: TRACK },
    });
    renderApp('/shop/nour/o/abc');
    const page = await screen.findByRole('region', { name: 'طلبك' });
    expect(page).toHaveTextContent('خرج طلبك للتوصيل');
    const steps = within(within(page).getByRole('list', { name: 'مراحل الطلب' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['وصل الطلب', 'أكّده المحل', 'خرج للتوصيل', 'سُلّم']);
  });

  it('says it was delivered', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/orders/abc': { status: 200, body: { ...TRACK, deliveryStage: 'delivered' } },
    });
    renderApp('/shop/nour/o/abc');
    expect(await screen.findByText('سُلّم طلبك')).toBeInTheDocument();
  });

  it('keeps the three steps for an order with no delivery stage', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/orders/abc': { status: 200, body: { ...TRACK, deliveryStage: null } },
    });
    renderApp('/shop/nour/o/abc');
    const page = await screen.findByRole('region', { name: 'طلبك' });
    expect(page).toHaveTextContent('أكّد المحل طلبك');
    expect(
      within(within(page).getByRole('list', { name: 'مراحل الطلب' })).getAllByRole('listitem'),
    ).toHaveLength(3);
  });
});
