import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  DistributionSettings,
  MeResponse,
  RegionRow,
  RouteDetail,
  SalesOrderRow,
  VanRow,
} from '@serva/core';
import { DISTRIBUTION_DEFAULTS } from '@serva/core';
import { navFor } from '../../layout/nav';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { move } from './RoutePage';

function meOf(repsEnabled = true, extra: MeResponse['user']['permissions'] = []): MeResponse {
  const base = makeMe({ repsEnabled });
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'routes.manage', 'sales_orders.manage', ...extra],
    },
  };
}

const region = (over: Partial<RegionRow>): RegionRow => ({
  id: 'r-1',
  name: 'دمشق',
  parentId: null,
  sortOrder: 0,
  isActive: true,
  customerCount: 3,
  version: 1,
  ...over,
});

const van = (over: Partial<VanRow> = {}): VanRow => ({
  id: 'v-1',
  code: '002',
  name: 'سيارة 1',
  parentBranchId: 'branch-1',
  parentBranchName: 'الفرع الرئيسي',
  vehiclePlate: null,
  isActive: true,
  repId: null,
  repName: null,
  ...over,
});

const order = (over: Partial<SalesOrderRow> = {}): SalesOrderRow => ({
  id: 'o-1',
  number: 'SO-2026-000001',
  status: 'open',
  customerId: 'c-1',
  customerName: 'مطعم الشام',
  customerPhone: null,
  branchId: 'branch-1',
  warehouseBranchId: 'branch-1',
  warehouseName: 'الفرع الرئيسي',
  repId: null,
  repName: 'سمير',
  businessDate: '2026-11-17',
  currency: 'SYP',
  totalMinor: 1_000_000,
  depositMinor: 0,
  deliveryDate: null,
  holdUntil: '2026-11-24T10:00:00.000Z',
  note: null,
  cancelReason: null,
  lines: [
    { variantId: 'x-1', qty: 12_500, deliveredQty: 2_500, unitPriceMinor: 80_000, name: 'قميص', sku: null },
  ],
  version: 1,
  ...over,
});

const route = (over: Partial<RouteDetail> = {}): RouteDetail => ({
  id: 'rt-1',
  name: 'خط المزة',
  regionId: 'r-1',
  regionName: 'دمشق',
  weekdays: [6, 1],
  repId: null,
  repName: null,
  sortOrder: 0,
  isActive: true,
  customerCount: 2,
  version: 3,
  customers: [
    { customerId: 'c-1', name: 'بقالية الأمل', phone: null, regionId: 'r-1', visitOrder: 0 },
    { customerId: 'c-2', name: 'ميني ماركت النور', phone: null, regionId: 'r-1', visitOrder: 1 },
  ],
  ...over,
});

describe('the menu of التوزيع', () => {
  it('is shown to whoever holds routes.manage on a plan with the module, and hidden otherwise', () => {
    const to = (me: MeResponse) => navFor(me).some((e) => e.to === '/distribution');
    expect(to(meOf(true))).toBe(true);
    expect(to(meOf(false))).toBe(false);
    expect(to({ ...meOf(true), user: { ...meOf(true).user, permissions: ['sale.create'] } })).toBe(false);
  });
});

describe('«التوزيع» on a plan without the module', () => {
  it('says so and offers the subscription page', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf(false) },
    });
    renderApp('/distribution/regions');
    expect(await screen.findByText('التوزيع غير متاح في باقتك')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'انتقل إلى باقة أعلى' })).toHaveAttribute(
      'href',
      '/subscription',
    );
    expect(screen.queryByRole('table', { name: 'المناطق' })).not.toBeInTheDocument();
  });
});

describe('«المناطق»', () => {
  function open() {
    let rows = [region({}), region({ id: 'r-2', name: 'المزة', parentId: 'r-1', customerCount: 1 })];
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/regions': () => ({ status: 200, body: rows }),
      'POST /v1/regions': (r: MockRequest) => {
        const body = r.body as { name: string; parentId: string | null };
        if (body.name.length < 2)
          return apiError(400, 'validation_failed', 'x', { name: 'اكتب اسم المنطقة' });
        rows = [...rows, region({ id: 'r-3', name: body.name, parentId: body.parentId, customerCount: 0 })];
        return { status: 201, body: rows[2] };
      },
    });
    return { ...mock, ...renderApp('/distribution/regions') };
  }

  it('lists regions under their parents, with the customers in each', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'المناطق' });
    await within(table).findByText('دمشق');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]!.textContent).toMatch(/3.*زبائن|زبائن.*3/);
    // The child follows its parent
    expect(rows[1]!.textContent).toContain('دمشق');
    expect(rows[2]!.textContent).toContain('المزة');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('adds a region under a parent, and shows the message of a short name on the field', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'منطقة جديدة' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('اسم المنطقة'), 'ب');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await within(dialog).findByText('اكتب اسم المنطقة')).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('اسم المنطقة'));
    await user.type(within(dialog).getByLabelText('اسم المنطقة'), 'كفرسوسة');
    await user.selectOptions(within(dialog).getByLabelText('تتبع منطقة'), 'r-1');
    await user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('كفرسوسة')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/regions').at(-1)?.body).toMatchObject({
      name: 'كفرسوسة',
      parentId: 'r-1',
    });
  });
});

describe('«السيارات»', () => {
  it('lists the vans with their rep, and stops one', async () => {
    let rows = [van({ repName: 'سمير' }), van({ id: 'v-2', code: '003', name: 'سيارة 2' })];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/vans': () => ({ status: 200, body: rows }),
      'POST /v1/vans/v-2/active': () => {
        rows = [rows[0]!, van({ id: 'v-2', code: '003', name: 'سيارة 2', isActive: false })];
        return { status: 200, body: rows[1] };
      },
    });
    const { user } = renderApp('/distribution/vans');
    const table = await screen.findByRole('table', { name: 'السيارات' });
    expect(await within(table).findByText('سمير')).toBeInTheDocument();
    expect(within(table).getByText('بلا مندوب')).toBeInTheDocument();
    const second = within(table).getByText('سيارة 2').closest('tr')!;
    await user.click(within(second).getByRole('button', { name: 'أوقف' }));
    expect(await within(table).findByText('موقوفة')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/vans/v-2/active')[0]?.body).toEqual({ active: false });
  });
});

describe('«خط السير»', () => {
  it('moves a customer one step in a list and keeps the edges still', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  function open() {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf(true, ['customers.view']) },
      'GET /v1/routes/rt-1': () => ({ status: 200, body: route() }),
      'GET /v1/regions': () => ({ status: 200, body: [region({})] }),
      'GET /v1/reps': () => ({ status: 200, body: [] }),
      'GET /v1/customers': () => ({
        status: 200,
        body: {
          items: [
            {
              id: 'c-1',
              name: 'بقالية الأمل',
              phone: null,
              archived: false,
              regionId: 'r-1',
              approvalStatus: 'approved',
            },
            { id: 'c-2', name: 'ميني ماركت النور', phone: null, archived: false, regionId: 'r-1' },
            { id: 'c-3', name: 'مطعم الشام', phone: null, archived: false, regionId: 'r-1' },
          ],
          totalOwedMinor: 0,
          baseCurrency: 'SYP',
        },
      }),
      'GET /v1/online-orders?status=pending': () => ({ status: 200, body: { items: [] } }),
      'PUT /v1/routes/rt-1/customers': (r: MockRequest) => {
        const ids = (r.body as { customerIds: string[] }).customerIds;
        return {
          status: 200,
          body: route({
            version: 4,
            customers: ids.map((id, i) => ({
              customerId: id,
              name: id,
              phone: null,
              regionId: null,
              visitOrder: i,
            })),
          }),
        };
      },
    });
    return { ...mock, ...renderApp('/distribution/routes/rt-1') };
  }

  it('reorders the customers and saves the new order with the version it saw', async () => {
    const { user, requestsTo } = open();
    expect(await screen.findByRole('heading', { name: 'خط المزة', level: 1 })).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'احفظ الترتيب' });
    expect(save).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'أخّر بقالية الأمل' }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText('حُفظ ترتيب الزبائن.')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/routes/rt-1/customers')[0]?.body).toEqual({
      customerIds: ['c-2', 'c-1'],
      version: 3,
    });
  });

  it('adds a customer found by search, and lets one go', async () => {
    const { user, requestsTo } = open();
    await user.click(await screen.findByRole('button', { name: 'أضف' }));
    expect(screen.getByText('زبائن الخط (3)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أزل ميني ماركت النور من الخط' }));
    await user.click(screen.getByRole('button', { name: 'احفظ الترتيب' }));
    await screen.findByText('حُفظ ترتيب الزبائن.');
    expect(requestsTo('PUT', '/v1/routes/rt-1/customers')[0]?.body).toEqual({
      customerIds: ['c-1', 'c-3'],
      version: 3,
    });
  });
});

describe('«الطلبيات»', () => {
  it('lists the open orders, and sends one to a van from its page', async () => {
    let current = order();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/sales-orders?status=active': () => ({ status: 200, body: [current] }),
      'GET /v1/sales-orders/o-1': () => ({ status: 200, body: current }),
      'GET /v1/vans': () => ({ status: 200, body: [van()] }),
      'POST /v1/sales-orders/o-1/assign': (r: MockRequest) => {
        const body = r.body as { warehouseBranchId: string };
        current = order({ warehouseBranchId: body.warehouseBranchId, warehouseName: 'سيارة 1', version: 2 });
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/distribution/orders');
    const table = await screen.findByRole('table', { name: 'الطلبيات' });
    expect(await within(table).findByText('مطعم الشام')).toBeInTheDocument();
    expect(within(table).getByText('مفتوحة')).toBeInTheDocument();
    await user.click(within(table).getByRole('link', { name: 'SO-2026-000001' }));
    // 12.5 ordered, 2.5 delivered, 10 left
    expect(
      await screen.findByRole('heading', { name: 'الطلبية SO-2026-000001', level: 1 }),
    ).toBeInTheDocument();
    const lines = await screen.findByRole('table', { name: 'بنود الطلبية' });
    expect(within(lines).getByText('12.5')).toBeInTheDocument();
    expect(within(lines).getByText('10')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أرسلها إلى سيارة' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('تُجهَّز من'), 'v-1');
    await user.click(within(dialog).getByRole('button', { name: 'أرسل' }));
    expect(await screen.findByText('سيارة 1')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/sales-orders/o-1/assign')[0]?.body).toEqual({
      warehouseBranchId: 'v-1',
      version: 1,
    });
  });

  it('asks for a reason before cancelling, and shows the order cancelled', async () => {
    let current = order();
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/sales-orders/o-1': () => ({ status: 200, body: current }),
      'POST /v1/sales-orders/o-1/cancel': (r: MockRequest) => {
        const body = r.body as { reason: string };
        if (body.reason.length < 2)
          return apiError(400, 'validation_failed', 'x', { reason: 'اكتب سبب الإلغاء' });
        current = order({ status: 'cancelled', cancelReason: body.reason, version: 2 });
        return { status: 200, body: current };
      },
    });
    const { user } = renderApp('/distribution/orders/o-1');
    await user.click(await screen.findByRole('button', { name: 'ألغِ الطلبية' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'ألغِ الطلبية' }));
    expect(await within(dialog).findByText('اكتب سبب الإلغاء')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('سبب الإلغاء'), 'الزبون سافر');
    await user.click(within(dialog).getByRole('button', { name: 'ألغِ الطلبية' }));
    expect(await screen.findByText('سبب الإلغاء: الزبون سافر')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/sales-orders/o-1/cancel').at(-1)?.body).toEqual({
      reason: 'الزبون سافر',
      version: 1,
    });
    // A cancelled order offers no more moves
    expect(screen.queryByRole('button', { name: 'أرسلها إلى سيارة' })).not.toBeInTheDocument();
  });
});

describe('«إعدادات التوزيع»', () => {
  it('loads the rules, saves a changed one with the hold days, and lists the reasons and plans', async () => {
    let saved: DistributionSettings = DISTRIBUTION_DEFAULTS;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/distribution/settings': () => ({ status: 200, body: saved }),
      'PUT /v1/distribution/settings': (r: MockRequest) => {
        saved = r.body as DistributionSettings;
        return { status: 200, body: saved };
      },
      'GET /v1/no-sale-reasons': {
        status: 200,
        body: [{ id: 'n-1', key: 'closed', name: 'المحل مغلق', sortOrder: 1, isActive: true, version: 1 }],
      },
      'GET /v1/commission-plans': { status: 200, body: [] },
    });
    const { user } = renderApp('/distribution/settings');
    expect(await screen.findByText('المحل مغلق')).toBeInTheDocument();
    expect(screen.getByText('لا خطط بعد.')).toBeInTheDocument();
    await user.click(await screen.findByRole('switch', { name: /سجّل موقع الزيارة/ }));
    const days = screen.getByLabelText('أيام حجز البضاعة للطلبية');
    await user.clear(days);
    await user.type(days, '14');
    await user.click(screen.getByRole('button', { name: 'احفظ القواعد' }));
    expect(await screen.findByText('حُفظت القواعد.')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/distribution/settings')[0]?.body).toMatchObject({
      gps: true,
      orderHoldDays: 14,
      requireCustomerApproval: true,
    });
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('refuses hold days outside 1 to 90 on the field, without asking the server', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/distribution/settings': { status: 200, body: DISTRIBUTION_DEFAULTS },
      'GET /v1/no-sale-reasons': { status: 200, body: [] },
      'GET /v1/commission-plans': { status: 200, body: [] },
    });
    const { user } = renderApp('/distribution/settings');
    const days = await screen.findByLabelText('أيام حجز البضاعة للطلبية');
    await user.clear(days);
    await user.type(days, '120');
    await user.click(screen.getByRole('button', { name: 'احفظ القواعد' }));
    expect(await screen.findByText('اكتب عدد أيام من 1 إلى 90')).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/distribution/settings')).toHaveLength(0);
  });
});
