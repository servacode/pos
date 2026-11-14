import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodSummary, MeResponse, OnlineOrder, OnlineStoreSettings } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import type * as Images from '../../lib/images';
import { collectOf } from './DeliveryPanel';

vi.mock('../../lib/images', async (actual) => ({
  ...(await actual<typeof Images>()),
  resizeImage: vi.fn(async (file: File) => {
    if (file.name.startsWith('broken')) throw new Error('not an image');
    return { contentType: 'image/jpeg', data: btoa(file.name), thumb: btoa('t'), width: 1600, height: 900 };
  }),
}));

afterEach(() => vi.restoreAllMocks());

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'settings.manage', 'customers.view'] },
  };
}

const settings = (extra: Partial<OnlineStoreSettings> = {}): OnlineStoreSettings => ({
  version: 3,
  enabled: true,
  slug: 'nour',
  whatsapp: '+963933123456',
  delivery: true,
  pickup: true,
  note: null,
  showOutOfStock: false,
  orderMode: 'whatsapp',
  showPrices: true,
  deliveryFeeMinor: 10_000,
  deliveryAreas: [],
  tagline: null,
  accent: 'emerald',
  logoUrl: null,
  coverUrl: null,
  ...extra,
});

const order = (extra: Partial<OnlineOrder> = {}): OnlineOrder => ({
  id: 'o-1',
  number: 'ONL-000001',
  status: 'accepted',
  source: 'shop',
  depositCode: null,
  deliveryFeeMinor: 10_000,
  deliveryArea: 'المزة',
  customerName: 'ريم',
  phone: '+963944555666',
  fulfilment: 'delivery',
  address: 'المزة، شارع الجلاء',
  note: 'اتصل قبل الوصول',
  currency: 'SYP',
  totalMinor: 920_000,
  lines: [
    {
      variantId: 'v',
      productId: 'p',
      name: 'قميص كتان',
      label: 'L · أبيض',
      qty: 2,
      priceMinor: 460_000,
      totalMinor: 920_000,
    },
  ],
  deliveryStage: null,
  courierName: null,
  outAt: null,
  deliveredAt: null,
  couponCode: null,
  createdAt: '2026-11-03T10:00:00.000Z',
  decidedAt: '2026-11-03T10:05:00.000Z',
  version: 2,
  ...extra,
});

const NO_COD: CodSummary = { currency: 'SYP', couriers: [] };

describe('the delivery stage on the dashboard', () => {
  it('sends an order out with a courier, lists the cash he owes, and marks it delivered', async () => {
    let current = order();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings() },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders?status=accepted': () => ({ status: 200, body: { items: [current] } }),
      'GET /v1/online-orders/cod': () => ({
        status: 200,
        body:
          current.deliveryStage === 'out'
            ? ({
                currency: 'SYP',
                couriers: [
                  {
                    courier: 'أبو علي',
                    expectedMinor: 930_000,
                    orders: [
                      {
                        id: 'o-1',
                        number: 'ONL-000001',
                        customerName: 'ريم',
                        phone: '+963944555666',
                        address: 'المزة',
                        deliveryArea: 'المزة',
                        collectMinor: 930_000,
                        outAt: current.outAt ?? null,
                      },
                    ],
                  },
                ],
              } satisfies CodSummary)
            : NO_COD,
      }),
      'POST /v1/online-orders/o-1/delivery': (r: MockRequest) => {
        const body = r.body as { stage: 'out' | 'delivered'; courier?: string };
        current =
          body.stage === 'out'
            ? {
                ...current,
                deliveryStage: 'out',
                courierName: body.courier!,
                outAt: '2026-11-03T12:00:00Z',
                version: 3,
              }
            : { ...current, deliveryStage: 'delivered', deliveredAt: '2026-11-03T13:00:00Z', version: 4 };
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'مقبولة' }));
    const card = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    const group = within(card).getByRole('group', { name: 'التوصيل ONL-000001' });
    const out = within(group).getByRole('button', { name: 'خرج للتوصيل' });
    // No courier named yet: nothing to send
    expect(out).toBeDisabled();
    expect(await screen.findByText('لا طلبات عند المندوبين الآن.')).toBeInTheDocument();
    await user.type(within(group).getByLabelText('اسم المندوب'), 'أبو علي');
    await user.click(out);
    expect(requestsTo('POST', '/v1/online-orders/o-1/delivery')[0]!.body).toEqual({
      stage: 'out',
      courier: 'أبو علي',
      version: 2,
    });
    // The cash the courier owes: the pieces and his fee
    const cod = await screen.findByRole('listitem', { name: 'المندوب أبو علي' });
    expect(cod).toHaveTextContent('9,300');
    expect(cod).toHaveTextContent('ONL-000001');
    expect(await within(card).findByRole('button', { name: 'سُلّم' })).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'سُلّم' }));
    expect(requestsTo('POST', '/v1/online-orders/o-1/delivery')[1]!.body).toEqual({
      stage: 'delivered',
      version: 3,
    });
    expect(await screen.findByText('لا طلبات عند المندوبين الآن.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'سُلّم' })).not.toBeInTheDocument();
    expect(card).toHaveTextContent('بيد أبو علي');
  });

  it('prints the courier’s slip with the address, the pieces and the amount to collect; none for a pickup', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings() },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders?status=accepted': {
        status: 200,
        body: {
          items: [
            order({ deliveryStage: 'out', courierName: 'أبو علي', outAt: '2026-11-03T12:00:00Z' }),
            order({
              id: 'o-2',
              number: 'ONL-000002',
              fulfilment: 'pickup',
              address: null,
              deliveryFeeMinor: 0,
            }),
          ],
        },
      },
      'GET /v1/online-orders/cod': { status: 200, body: NO_COD },
    });
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'مقبولة' }));
    const card = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    await user.click(within(card).getByRole('button', { name: 'اطبع ورقة التوصيل' }));
    const slip = document.querySelector('[data-print-sheet]') as HTMLElement;
    expect(slip).not.toBeNull();
    expect(slip).toHaveTextContent('ورقة توصيل');
    expect(slip).toHaveTextContent('ريم');
    expect(slip).toHaveTextContent('المزة، شارع الجلاء');
    expect(slip).toHaveTextContent('قميص كتان (L · أبيض)');
    expect(slip).toHaveTextContent('اتصل قبل الوصول');
    expect(slip).toHaveTextContent('المبلغ المطلوب تحصيله');
    expect(slip).toHaveTextContent('9,300');
    expect(slip).toHaveTextContent('أبو علي');
    expect(print).toHaveBeenCalled();
    // A pickup order has no delivery to send
    const pickup = screen.getByRole('listitem', { name: 'الطلب ONL-000002' });
    expect(within(pickup).queryByRole('group', { name: /التوصيل/ })).not.toBeInTheDocument();
  });

  it('adds the pieces and the courier’s fee for the cash to collect', () => {
    expect(collectOf({ totalMinor: 920_000, deliveryFeeMinor: 10_000 })).toBe(930_000);
  });

  it('shows the coupon an order carries, and says why a stage is refused', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings() },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders?status=accepted': {
        status: 200,
        body: { items: [order({ couponCode: 'SUMMER10' })] },
      },
      'GET /v1/online-orders/cod': { status: 200, body: NO_COD },
      'POST /v1/online-orders/o-1/delivery': apiError(
        409,
        'stale_version',
        'تغيّر هذا الطلب للتو. حدّث الصفحة وراجعه.',
      ),
    });
    const { user } = renderApp('/online-store');
    await user.click(await screen.findByRole('radio', { name: 'مقبولة' }));
    const card = await screen.findByRole('listitem', { name: 'الطلب ONL-000001' });
    expect(card).toHaveTextContent('SUMMER10');
    await user.type(within(card).getByLabelText('اسم المندوب'), 'س');
    await user.click(within(card).getByRole('button', { name: 'خرج للتوصيل' }));
    expect(await within(card).findByText('تغيّر هذا الطلب للتو. حدّث الصفحة وراجعه.')).toBeInTheDocument();
  });
});

describe('«شكل المتجر»', () => {
  it('saves the tagline and the accent with the settings', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings() },
      'PUT /v1/online-store': (r: MockRequest) => ({
        status: 200,
        body: { ...(r.body as OnlineStoreSettings), version: 4 },
      }),
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders/cod': { status: 200, body: NO_COD },
    });
    const { user } = renderApp('/online-store');
    const tagline = await screen.findByLabelText('عبارة قصيرة تحت اسم المتجر (اختياري)');
    await user.type(tagline, 'أناقة كل يوم');
    await user.click(screen.getByRole('radio', { name: 'فيروزي' }));
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText(/حُفظ\./)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/online-store')[0]!.body).toMatchObject({
      tagline: 'أناقة كل يوم',
      accent: 'teal',
    });
  });

  it('keeps the logo and the cover as they are picked, and takes them away', async () => {
    let now = settings();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': () => ({ status: 200, body: now }),
      'PUT /v1/online-store/image/logo': () => {
        now = { ...now, version: 4, logoUrl: '/v1/images/t/logo?size=thumb' };
        return { status: 200, body: now };
      },
      'PUT /v1/online-store/image/cover': () => {
        now = { ...now, version: 5, coverUrl: '/v1/images/t/cover' };
        return { status: 200, body: now };
      },
      'DELETE /v1/online-store/image/logo': () => {
        now = { ...now, version: 6, logoUrl: null };
        return { status: 200, body: now };
      },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders/cod': { status: 200, body: NO_COD },
    });
    const { user } = renderApp('/online-store');
    const logo = await screen.findByLabelText('الشعار', { selector: 'input' });
    await user.upload(logo, new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(await screen.findByRole('img', { name: 'شعار المتجر' })).toHaveAttribute(
      'src',
      '/v1/images/t/logo?size=thumb',
    );
    expect(requestsTo('PUT', '/v1/online-store/image/logo')[0]!.body).toMatchObject({
      contentType: 'image/jpeg',
      width: 1600,
    });
    const cover = screen.getByLabelText('صورة الغلاف', { selector: 'input' });
    await user.upload(cover, new File(['x'], 'cover.png', { type: 'image/png' }));
    expect(await screen.findByRole('img', { name: 'غلاف المتجر' })).toBeInTheDocument();
    // The pictures are kept at once: nothing waits for «احفظ»
    expect(screen.queryByRole('button', { name: 'احفظ' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أزل الشعار' }));
    expect(screen.queryByRole('img', { name: 'شعار المتجر' })).not.toBeInTheDocument();
    expect(requestsTo('DELETE', '/v1/online-store/image/logo')).toHaveLength(1);
  });

  it('says so for a file that is not a picture, and waits for the first save', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings({ version: null }) },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders/cod': { status: 200, body: NO_COD },
    });
    renderApp('/online-store');
    expect(await screen.findByText(/احفظ إعدادات المتجر أولاً/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'أضف الشعار' })).toBeDisabled();
  });

  it('refuses a file that cannot be read', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/online-store': { status: 200, body: settings() },
      'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
      'GET /v1/online-orders/cod': { status: 200, body: NO_COD },
    });
    const { user } = renderApp('/online-store');
    const logo = await screen.findByLabelText('الشعار', { selector: 'input' });
    await user.upload(logo, new File(['x'], 'broken.png', { type: 'image/png' }));
    expect(await screen.findByText(/ليس صورة يمكن قراءتها/)).toBeInTheDocument();
  });
});
