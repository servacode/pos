import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopHome, ShopProduct } from '@serva/core';
import { mockFetch, type MockRequest } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';
import { addLine, canPick, variantFor } from './cart';
import { applyFilters, filterCount, NO_FILTERS, optionChoices, priceToMinor, sortProducts } from './filters';
import { openWhatsApp } from './open';

vi.mock('./open', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openWhatsApp: vi.fn(),
}));

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
    showPrices: true,
    deliveryFeeMinor: 0,
    deliveryAreas: [],
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
      wasPriceMinor: 600_000,
      offer: 'تنزيلات الصيف',
      available: true,
      createdAt: '2026-11-01T10:00:00.000Z',
      options: [
        { name: 'المقاس', values: ['M', 'L'] },
        { name: 'اللون', values: ['أبيض'] },
      ],
    },
    {
      id: 'p-pyjama',
      name: 'بيجاما',
      categoryId: 'c-kids',
      imageUrl: null,
      currency: 'SYP',
      priceMinor: 200_000,
      maxPriceMinor: 200_000,
      wasPriceMinor: null,
      offer: null,
      available: true,
      createdAt: '2026-11-05T10:00:00.000Z',
      options: [{ name: 'المقاس', values: ['4', '6'] }],
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
  showPrices: true,
  images: [
    { url: '/v1/images/t/u1', thumbUrl: '/v1/images/t/u1?size=thumb', optionValue: null },
    { url: '/v1/images/t/u2', thumbUrl: '/v1/images/t/u2?size=thumb', optionValue: 'أزرق' },
  ],
  options: [
    { name: 'المقاس', values: ['M', 'L'] },
    { name: 'اللون', values: ['أبيض', 'أزرق'] },
  ],
  variants: [
    {
      id: 'v-mw',
      label: 'M · أبيض',
      attributes: attrs('M', 'أبيض'),
      priceMinor: 450_000,
      wasPriceMinor: null,
      available: true,
      left: null,
    },
    {
      id: 'v-lw',
      label: 'L · أبيض',
      attributes: attrs('L', 'أبيض'),
      priceMinor: 460_000,
      wasPriceMinor: null,
      available: true,
      left: 2,
    },
    {
      id: 'v-mb',
      label: 'M · أزرق',
      attributes: attrs('M', 'أزرق'),
      priceMinor: 450_000,
      wasPriceMinor: null,
      available: false,
      left: null,
    },
  ],
  offer: null,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openWhatsApp).mockClear();
});

describe('the online shop', () => {
  it('links the terms and the privacy policy from its footer', async () => {
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME } });
    renderApp('/shop/nour');
    await screen.findByRole('list', { name: 'البضاعة' });
    expect(screen.getByRole('link', { name: 'الشروط' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'الخصوصية' })).toHaveAttribute('href', '/privacy');
  });

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
          area: null,
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
    // The offer and the price before it, struck through
    expect(grid).toHaveTextContent('تنزيلات الصيف');
    expect(within(grid).getByLabelText('السعر قبل التنزيل')).toHaveTextContent('6,000');
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
    // WhatsApp opens in its own tab with the order's page linked at the end of the message
    expect(openWhatsApp).toHaveBeenCalledTimes(1);
    const opened = vi.mocked(openWhatsApp).mock.calls[0]![0];
    expect(opened.startsWith('https://wa.me/963933123456?text=x')).toBe(true);
    expect(decodeURIComponent(opened)).toContain(`${window.location.origin}/shop/nour/o/t0`);
    expect(screen.getByRole('link', { name: 'أرسل الطلب على واتساب' })).toHaveAttribute('target', '_blank');
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

  it('asks the delivery area and adds its fee for the courier on top', async () => {
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
        body: {
          ...HOME,
          store: {
            ...HOME.store,
            deliveryAreas: [
              { name: 'المزة', feeMinor: 5_000 },
              { name: 'دمر', feeMinor: 10_000 },
            ],
          },
        },
      },
      'POST /v1/shop/nour/orders': {
        status: 201,
        body: {
          trackPath: '/shop/nour/o/t1',
          number: 'ONL-000009',
          currency: 'SYP',
          totalMinor: 460_000,
          deliveryFeeMinor: 10_000,
          message: 'طلب',
          whatsappUrl: 'https://wa.me/963933123456?text=x',
        },
      },
    });
    const { user } = renderApp('/shop/nour/cart');
    const cart = await screen.findByRole('region', { name: 'السلة' });
    await user.selectOptions(screen.getByLabelText('منطقة التوصيل'), 'دمر');
    expect(cart).toHaveTextContent('أجرة التوصيل (للمندوب)');
    expect(cart).toHaveTextContent('100');
    expect(cart).toHaveTextContent('4,700');
    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.type(screen.getByLabelText('العنوان'), 'دمر البلد');
    await user.click(screen.getByRole('button', { name: 'اطلب عبر واتساب' }));
    expect(await screen.findByRole('region', { name: 'وصل طلبك' })).toHaveTextContent('أجرة التوصيل');
    expect(requestsTo('POST', '/v1/shop/nour/orders')[0]!.body).toMatchObject({ area: 'دمر' });
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

describe('the online shop with prices hidden', () => {
  const HIDDEN_HOME: ShopHome = {
    store: { ...HOME.store, showPrices: false },
    categories: HOME.categories,
    products: HOME.products.map((p) => ({
      ...p,
      priceMinor: null,
      maxPriceMinor: null,
      wasPriceMinor: null,
      offer: null,
    })),
  };
  const HIDDEN_SHIRT: ShopProduct = {
    ...SHIRT,
    showPrices: false,
    variants: SHIRT.variants.map((v) => ({ ...v, priceMinor: null, wasPriceMinor: null })),
  };

  it('shows the goods without a price and says the price comes on request', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HIDDEN_HOME },
      'GET /v1/shop/nour/products/p-shirt': { status: 200, body: HIDDEN_SHIRT },
    });
    const { user } = renderApp('/shop/nour');
    const grid = await screen.findByRole('list', { name: 'البضاعة' });
    expect(within(grid).getAllByText('السعر عند الطلب')).toHaveLength(2);
    expect(grid).not.toHaveTextContent(/\d/);
    expect(within(grid).queryByLabelText('السعر قبل التنزيل')).not.toBeInTheDocument();
    await user.click(within(grid).getByRole('link', { name: /قميص كتان/ }));
    const page = await screen.findByRole('article', { name: 'قميص كتان' });
    expect(within(page).getByText('السعر عند الطلب')).toBeInTheDocument();
    expect(page).not.toHaveTextContent('ل.س');
    await user.click(within(page).getByRole('button', { name: 'L' }));
    await user.click(within(page).getByRole('button', { name: 'أبيض' }));
    await user.click(within(page).getByRole('button', { name: 'أضف إلى السلة' }));
    expect(await screen.findByText('أُضيفت إلى السلة.')).toBeInTheDocument();
  });

  it('orders as an inquiry: no line total, no sum, and the placed order shows no amount', async () => {
    localStorage.setItem(
      'serva-shop-cart:nour',
      JSON.stringify([
        {
          variantId: 'v-lw',
          productId: 'p-shirt',
          name: 'قميص كتان',
          label: 'L · أبيض',
          imageUrl: null,
          priceMinor: 0,
          qty: 2,
        },
      ]),
    );
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HIDDEN_HOME },
      'POST /v1/shop/nour/orders': {
        status: 201,
        body: {
          trackPath: '/shop/nour/o/t0',
          number: 'ONL-000009',
          currency: 'SYP',
          showPrices: false,
          totalMinor: null,
          deliveryFeeMinor: null,
          message: 'طلب',
          whatsappUrl: 'https://wa.me/963933123456?text=x',
        },
      },
    });
    const { user } = renderApp('/shop/nour/cart');
    const cart = await screen.findByRole('region', { name: 'السلة' });
    expect(cart).toHaveTextContent('السعر عند الطلب');
    expect(cart).not.toHaveTextContent('ل.س');
    await user.type(screen.getByLabelText('الاسم'), 'ريم');
    await user.type(screen.getByLabelText('رقم الجوال'), '0944555666');
    await user.type(screen.getByLabelText('العنوان'), 'المزة');
    await user.click(screen.getByRole('button', { name: 'اطلب عبر واتساب' }));
    const done = await screen.findByRole('region', { name: 'وصل طلبك' });
    expect(done).toHaveTextContent('ONL-000009');
    expect(done).toHaveTextContent('السعر عند الطلب');
    expect(done).not.toHaveTextContent('ل.س');
  });

  it('tracks the order without amounts', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HIDDEN_HOME },
      'GET /v1/shop/nour/orders/abc123': {
        status: 200,
        body: {
          number: 'ONL-000010',
          status: 'accepted',
          fulfilment: 'pickup',
          currency: 'SYP',
          showPrices: false,
          totalMinor: null,
          deliveryFeeMinor: null,
          lines: [{ name: 'قميص كتان', label: 'L · أبيض', qty: 1, totalMinor: null }],
          createdAt: '2026-11-03T10:00:00Z',
        },
      },
    });
    renderApp('/shop/nour/o/abc123');
    expect(await screen.findByText('ONL-000010')).toBeInTheDocument();
    expect(screen.getAllByText('السعر عند الطلب').length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent('ل.س');
  });
});

describe('the shop’s filters and sort', () => {
  const [shirt, pyjama] = HOME.products;
  const wide = {
    ...pyjama!,
    id: 'p-coat',
    name: 'معطف',
    priceMinor: 900_000,
    maxPriceMinor: 900_000,
    available: false,
  };

  it('narrows by option, price range and stock, and sorts', () => {
    const all = [shirt!, pyjama!, wide];
    expect(optionChoices(all).map((c) => [c.name, c.values.map((v) => v.value)])).toEqual([
      ['المقاس', ['M', 'L', '4', '6']],
      ['اللون', ['أبيض']],
    ]);
    expect(applyFilters(all, { ...NO_FILTERS, options: { المقاس: ['L'] } }).map((p) => p.id)).toEqual([
      'p-shirt',
    ]);
    expect(applyFilters(all, { ...NO_FILTERS, options: { المقاس: [] } })).toHaveLength(3);
    expect(applyFilters(all, { ...NO_FILTERS, inStockOnly: true }).map((p) => p.id)).toEqual([
      'p-shirt',
      'p-pyjama',
    ]);
    // 4,500 to 4,600 for the shirt: a range touching it keeps it, one above or below does not
    expect(
      applyFilters(all, { ...NO_FILTERS, minPrice: 455_000, maxPrice: 700_000 }).map((p) => p.id),
    ).toEqual(['p-shirt']);
    expect(applyFilters(all, { ...NO_FILTERS, minPrice: 1_000_000 })).toEqual([]);
    expect(applyFilters(all, { ...NO_FILTERS, maxPrice: 100_000 })).toEqual([]);
    expect(sortProducts(all, 'newest').map((p) => p.id)).toEqual(['p-pyjama', 'p-coat', 'p-shirt']);
    expect(sortProducts(all, 'price-asc').map((p) => p.id)).toEqual(['p-pyjama', 'p-shirt', 'p-coat']);
    expect(sortProducts(all, 'price-desc').map((p) => p.id)).toEqual(['p-coat', 'p-shirt', 'p-pyjama']);
    expect(sortProducts(all, 'name').map((p) => p.id)).toEqual(
      ['p-shirt', 'p-pyjama', 'p-coat'].sort((a, b) => {
        const name = (id: string) => all.find((p) => p.id === id)!.name;
        return name(a).localeCompare(name(b), 'ar');
      }),
    );
    expect(
      filterCount({ options: { المقاس: ['L'], اللون: [] }, minPrice: 1, maxPrice: null, inStockOnly: true }),
    ).toBe(3);
  });

  it('never uses a price a hidden-prices store did not send', () => {
    const hidden = [shirt!, pyjama!].map((p) => ({ ...p, priceMinor: null, maxPriceMinor: null }));
    expect(applyFilters(hidden, { ...NO_FILTERS, minPrice: 1, maxPrice: 2 })).toHaveLength(2);
  });

  it('reads a price typed in Arabic digits or with separators', () => {
    expect(priceToMinor('١٬٥٠٠', 2)).toBeNull();
    expect(priceToMinor('1,500', 2)).toBe(150_000);
    expect(priceToMinor('٤٥٫٥', 2)).toBe(4_550);
    expect(priceToMinor('', 2)).toBeNull();
    expect(priceToMinor('-3', 2)).toBeNull();
  });

  it('filters the page by size, then by price, and offers the sort', async () => {
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: HOME } });
    const { user } = renderApp('/shop/nour');
    const list = () => screen.getByRole('list', { name: 'البضاعة' });
    await screen.findByRole('list', { name: 'البضاعة' });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
    // Newest first: the pyjamas came after the shirt
    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('بيجاما');

    await user.click(screen.getByRole('button', { name: 'تصفية' }));
    const panel = screen.getByRole('region', { name: 'التصفية' });
    await user.click(within(panel).getByRole('checkbox', { name: 'L' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list()).toHaveTextContent('قميص كتان');
    expect(screen.getByRole('button', { name: /^تصفية/ })).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'امسح التصفية' }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
    await user.type(within(panel).getByLabelText('إلى'), '3000');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list()).toHaveTextContent('بيجاما');
    await user.clear(within(panel).getByLabelText('إلى'));
    await user.selectOptions(screen.getByLabelText('الترتيب'), 'price-asc');
    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('بيجاما');
    await user.selectOptions(screen.getByLabelText('الترتيب'), 'price-desc');
    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('قميص كتان');

    // A filter nothing satisfies says so
    await user.type(within(panel).getByLabelText('من'), '99999');
    expect(await screen.findByText('لا قطعة تناسب هذه التصفية. خفّف شروطها.')).toBeInTheDocument();
  });

  it('offers no price range and no price sort when the store hides its prices', async () => {
    mockFetch({
      'GET /v1/shop/nour': {
        status: 200,
        body: {
          store: { ...HOME.store, showPrices: false },
          categories: HOME.categories,
          products: HOME.products.map((p) => ({
            ...p,
            priceMinor: null,
            maxPriceMinor: null,
            wasPriceMinor: null,
            offer: null,
          })),
        },
      },
    });
    const { user } = renderApp('/shop/nour');
    await screen.findByRole('list', { name: 'البضاعة' });
    expect(screen.queryByRole('option', { name: /السعر/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تصفية' }));
    const panel = screen.getByRole('region', { name: 'التصفية' });
    expect(within(panel).queryByRole('group', { name: 'السعر' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'المقاس' })).toBeInTheDocument();
  });
});

describe('the product page’s warnings', () => {
  it('says how many are left when few, marks the values that ran out, and asks the product once', async () => {
    const { requestsTo } = mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/products/p-shirt': { status: 200, body: SHIRT },
    });
    const { user } = renderApp('/shop/nour/p/p-shirt');
    const page = await screen.findByRole('article', { name: 'قميص كتان' });
    expect(within(page).getByRole('heading', { level: 1, name: 'قميص كتان' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(page).getByRole('button', { name: 'L' }));
    expect(within(page).getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(page).getByRole('button', { name: 'أبيض' }));
    expect(within(page).getByText(/بقي/)).toHaveTextContent('بقي 2 فقط');
    // Blue is out with L: disabled, and says «نفد»
    const blue = within(page).getByRole('button', { name: 'أزرق' });
    expect(blue).toBeDisabled();
    expect(blue).toHaveTextContent('نفد');
    // M white has plenty: no warning
    await user.click(within(page).getByRole('button', { name: 'M' }));
    expect(within(page).queryByText(/بقي/)).not.toBeInTheDocument();
    expect(requestsTo('GET', '/v1/shop/nour/products/p-shirt')).toHaveLength(1);
  });
});

describe('the order’s own page', () => {
  const TRACK = {
    number: 'ONL-000011',
    status: 'pending',
    customerName: 'ريم',
    fulfilment: 'delivery',
    area: 'المزة',
    currency: 'SYP',
    showPrices: true,
    totalMinor: 460_000,
    deliveryFeeMinor: 0,
    lines: [{ name: 'قميص كتان', label: 'L · أبيض', qty: 1, totalMinor: 460_000 }],
    createdAt: '2026-11-03T10:00:00Z',
  };

  it('shows the name and area, a WhatsApp button to the store, and asks to cancel while pending', async () => {
    const { requestsTo } = mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/orders/abc': { status: 200, body: TRACK },
      'POST /v1/shop/nour/orders/abc/cancel-request': {
        status: 200,
        body: { ...TRACK, status: 'cancel_requested' },
      },
    });
    const { user } = renderApp('/shop/nour/o/abc');
    const page = await screen.findByRole('region', { name: 'طلبك' });
    expect(page).toHaveTextContent('ريم');
    expect(page).toHaveTextContent('توصيل · المزة');
    const talk = within(page).getByRole('link', { name: 'تواصل مع المحل' });
    expect(talk).toHaveAttribute('target', '_blank');
    expect(talk.getAttribute('href')).toContain('https://wa.me/963933123456?text=');
    expect(decodeURIComponent(talk.getAttribute('href')!)).toContain('ONL-000011');

    await user.click(within(page).getByRole('button', { name: 'اطلب إلغاء الطلب' }));
    expect(await within(page).findByText('طلبت إلغاء الطلب')).toBeInTheDocument();
    expect(within(page).queryByRole('button', { name: 'اطلب إلغاء الطلب' })).not.toBeInTheDocument();
    expect(requestsTo('POST', '/v1/shop/nour/orders/abc/cancel-request')).toHaveLength(1);
  });

  it('says why when the store already decided', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/orders/abc': { status: 200, body: TRACK },
      'POST /v1/shop/nour/orders/abc/cancel-request': {
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'قرّر المحل في طلبك، فلم يعد الإلغاء من هنا. تواصل مع المحل.',
          },
        },
      },
    });
    const { user } = renderApp('/shop/nour/o/abc');
    const page = await screen.findByRole('region', { name: 'طلبك' });
    await user.click(within(page).getByRole('button', { name: 'اطلب إلغاء الطلب' }));
    expect(await within(page).findByText(/قرّر المحل في طلبك/)).toBeInTheDocument();
  });

  it('shows a pickup order without an area, and no cancel once accepted', async () => {
    mockFetch({
      'GET /v1/shop/nour': { status: 200, body: HOME },
      'GET /v1/shop/nour/orders/abc': {
        status: 200,
        body: { ...TRACK, status: 'accepted', fulfilment: 'pickup', area: null },
      },
    });
    renderApp('/shop/nour/o/abc');
    const page = await screen.findByRole('region', { name: 'طلبك' });
    expect(page).toHaveTextContent('تستلمه من المحل');
    expect(within(page).queryByRole('button', { name: 'اطلب إلغاء الطلب' })).not.toBeInTheDocument();
  });
});

describe('the size filter on a big shop', () => {
  const card = (id: string, categoryId: string, sizes: string[], colours: string[]) => ({
    ...HOME.products[1]!,
    id,
    name: `قطعة ${id}`,
    categoryId,
    options: [
      { name: 'المقاس', values: sizes },
      { name: 'اللون', values: colours },
    ],
  });
  const BIG: ShopHome = {
    ...HOME,
    products: [
      card('a', 'c-men', ['XL', 'S', 'XXL', 'M', 'L'], ['أزرق', 'أسود']),
      card('b', 'c-men', ['42', '40', '38', '44', '46'], ['أسود']),
      card('c', 'c-kids', ['6 سنوات', '2 سنة', '8 سنوات', '12 شهراً', '3XL'], ['وردي']),
    ],
  };

  it('orders sizes naturally in groups: letters, numbers, ages', () => {
    const [size, colour] = optionChoices(BIG.products);
    expect(size!.values.map((v) => v.value)).toEqual([
      'S',
      'M',
      'L',
      'XL',
      'XXL',
      '3XL',
      '38',
      '40',
      '42',
      '44',
      '46',
      '12 شهراً',
      '2 سنة',
      '6 سنوات',
      '8 سنوات',
    ]);
    expect(size!.values.map((v) => v.group)).toEqual([
      ...Array(6).fill('letters'),
      ...Array(5).fill('numbers'),
      ...Array(4).fill('ages'),
    ]);
    // Colours: the commonest first
    expect(colour!.values.map((v) => v.value)).toEqual(['أسود', 'أزرق', 'وردي']);
  });

  it('shows the first eight, the rest behind «اعرض كل المقاسات», and only the department’s own values', async () => {
    mockFetch({ 'GET /v1/shop/nour': { status: 200, body: BIG } });
    const { user } = renderApp('/shop/nour');
    await screen.findByRole('list', { name: 'البضاعة' });
    await user.click(screen.getByRole('button', { name: 'تصفية' }));
    const panel = screen.getByRole('region', { name: 'التصفية' });
    const sizes = () => within(within(panel).getByRole('group', { name: 'المقاس' }));
    expect(sizes().getAllByRole('checkbox')).toHaveLength(8);
    expect(sizes().queryByRole('checkbox', { name: '8 سنوات' })).not.toBeInTheDocument();
    await user.click(sizes().getByRole('button', { name: 'اعرض كل المقاسات' }));
    expect(sizes().getAllByRole('checkbox')).toHaveLength(15);
    expect(sizes().getByText('حروف')).toBeInTheDocument();
    expect(sizes().getByText('أعمار')).toBeInTheDocument();

    // A department offers only what it has, and a pick from another one is dropped
    await user.click(sizes().getByRole('checkbox', { name: 'S' }));
    await user.click(screen.getByRole('button', { name: 'ولادي' }));
    const kids = within(
      within(screen.getByRole('region', { name: 'التصفية' })).getByRole('group', { name: 'المقاس' }),
    );
    expect(kids.getAllByRole('checkbox')).toHaveLength(5);
    expect(kids.queryByRole('checkbox', { name: 'S' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'البضاعة' })).getAllByRole('listitem')).toHaveLength(1);
  });
});
