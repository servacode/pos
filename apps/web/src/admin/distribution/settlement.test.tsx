import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  DistributionReport,
  MeResponse,
  RepSettlementDetail,
  RepTargetRow,
  SettlementPreview,
  TodayBoard,
} from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';
import { orderLines } from './NewOrderPage';
import { plainCell } from './DistributionReportsPage';
import { minorOf } from './SettlementPage';
import { monthBounds, monthOf, targetFigure } from './TargetsPage';

function meOf(): MeResponse {
  const base = makeMe({ repsEnabled: true });
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [
        ...base.user.permissions,
        'routes.manage',
        'sales_orders.manage',
        'rep.settle',
        'rep.targets',
        'report.view',
        'customers.view',
        'catalog.manage',
      ],
    },
  };
}

const preview = (over: Partial<SettlementPreview> = {}): SettlementPreview => ({
  repId: 'rep-1',
  repName: 'سمير',
  businessDate: '2026-11-17',
  branchId: 'branch-1',
  vanBranchId: 'van-1',
  vanName: 'سيارة 1',
  unloadBranchId: 'branch-1',
  unloadBranchName: 'الفرع الرئيسي',
  baseCurrency: 'SYP',
  shifts: [{ id: 's-1', number: 'SFT-1', status: 'closed', closedAt: '2026-11-17T18:00:00.000Z' }],
  cash: [
    {
      currency: 'SYP',
      openingMinor: 100_000,
      cashSalesMinor: 200_000,
      changeGivenMinor: 0,
      refundsMinor: 0,
      receiptsMinor: 30_000,
      payInMinor: 0,
      payOutMinor: 0,
      dropsMinor: 150_000,
      closingCountedMinor: 180_000,
      expectedMinor: 330_000,
    },
  ],
  sales: {
    count: 3,
    totalMinor: 200_000,
    returnsCount: 0,
    returnsTotalMinor: 0,
    receiptsCount: 2,
    visits: 5,
  },
  cheques: [
    {
      sourceType: 'receipt',
      sourceId: 'rc-1',
      number: 'RCV-1',
      customerName: 'مطعم الشام',
      amountMinor: 40_000,
      currency: 'SYP',
      reference: null,
      dueDate: '2026-12-01',
    },
  ],
  items: [{ variantId: 'v-1', name: 'قميص', expectedQty: 8000, countedQty: 7000, diffQty: -1000 }],
  vanCountAt: '2026-11-17T17:00:00.000Z',
  pendingDocs: 0,
  keepStockInVan: false,
  existing: null,
  ...over,
});

const detail = (over: Partial<RepSettlementDetail> = {}): RepSettlementDetail => ({
  id: 'st-1',
  number: 'RST-2026-000001',
  repId: 'rep-1',
  repName: 'سمير',
  businessDate: '2026-11-17',
  status: 'draft',
  expectedCash: { SYP: 330_000 },
  countedCash: { SYP: 320_000 },
  cashDifference: { SYP: -10_000 },
  treatment: 'rep_debt',
  pendingDocs: 0,
  approvedAt: null,
  approvedByName: null,
  createdByName: 'المشرف',
  note: null,
  version: 1,
  preview: preview(),
  cheques: { received: ['rc-1'], unmatched: [] },
  goods: {
    counted: true,
    stocktakeId: null,
    stocktakeNumber: null,
    transferId: null,
    transferNumber: null,
    lines: preview().items,
  },
  ...over,
});

describe('the helpers of the distribution office pages', () => {
  it('reads an amount typed in either digits into minor units, and refuses what is not an amount', () => {
    expect(minorOf('1,500', 2)).toBe(150_000);
    expect(minorOf('١٢٫٥', 2)).toBe(1250);
    expect(minorOf('3300', 0)).toBe(3300);
    expect(minorOf('', 2)).toBeNull();
    expect(minorOf('12abc', 2)).toBeNull();
  });

  it('gives the bounds of a month and a figure in the unit its metric keeps', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthBounds('2028-02').end).toBe('2028-02-29');
    expect(monthOf(1, new Date(2026, 0, 15))).toBe('2025-12');
    expect(targetFigure('net_sales', '5000', 2)).toBe(500_000);
    expect(targetFigure('qty', '12.5', 2)).toBe(12_500);
    expect(targetFigure('new_customers', '8', 2)).toBe(8);
    expect(targetFigure('new_customers', '0', 2)).toBeNull();
  });

  it('turns typed order lines into what the server takes, and names the line that is wrong', () => {
    const ok = orderLines([{ variantId: 'v', name: 'قميص', qty: '2', price: '10' }], 2);
    expect(ok).toEqual({
      error: null,
      lines: [{ variantId: 'v', qty: 2000, deliveredQty: 0, unitPriceMinor: 1000 }],
    });
    expect(orderLines([{ variantId: 'v', name: 'قميص', qty: 'x', price: '10' }], 2).error).toContain('قميص');
    expect(orderLines([{ variantId: 'v', name: 'بنطال', qty: '1', price: '' }], 2).error).toContain('بنطال');
  });

  it('writes a report cell as the number a file keeps: money in its currency’s units, quantity in pieces', () => {
    const money = { key: 'sales', label: 'المبيعات', kind: 'money' as const };
    expect(plainCell(money, { sales: 150_000 }, 'SYP')).toBe(1500);
    expect(plainCell(money, { sales: 2500, currency: 'USD' }, 'SYP')).toBe(25);
    expect(plainCell({ key: 'q', label: 'الكمية', kind: 'qty' }, { q: 2500 }, 'SYP')).toBe(2.5);
    expect(
      plainCell({ key: 'v', label: 'الهدف', kind: 'metric' }, { v: 500_000, metric: 'net_sales' }, 'SYP'),
    ).toBe(5000);
    expect(
      plainCell({ key: 'v', label: 'الهدف', kind: 'metric' }, { v: 8, metric: 'new_customers' }, 'SYP'),
    ).toBe(8);
    expect(plainCell({ key: 'n', label: 'اسم', kind: 'text' }, { n: null }, 'SYP')).toBe('');
  });
});

describe('«التسوية»', () => {
  function open(path: string, extra: Parameters<typeof mockFetch>[0] = {}) {
    let current = detail();
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/rep-settlements/preview?repId=rep-1&date=2026-11-17': () => ({ status: 200, body: preview() }),
      [`GET /v1/rep-settlements/preview?repId=rep-1&date=${new Date().toLocaleDateString('en-CA')}`]: () => ({
        status: 200,
        body: preview(),
      }),
      'POST /v1/rep-settlements': () => ({ status: 201, body: current }),
      'GET /v1/rep-settlements/st-1': () => ({ status: 200, body: current }),
      'GET /v1/rep-settlements?status=draft': () => ({
        status: 200,
        body: [{ ...current, preview: undefined }],
      }),
      'POST /v1/rep-settlements/st-1/approve': () => {
        current = detail({
          status: 'approved',
          version: 4,
          goods: {
            ...current.goods,
            stocktakeNumber: 'STK-2026-000001',
            transferNumber: 'TRF-2026-000002',
          },
        });
        return { status: 200, body: current };
      },
      ...extra,
    });
    return { ...mock, ...renderApp(path) };
  }

  it('shows the drawer, the cheques and the van, takes what the supervisor counted and saves a draft', async () => {
    const { user, requestsTo } = open('/distribution/settlements/new?repId=rep-1&date=2026-11-17');
    expect(await screen.findByText('الصندوق بـ SYP')).toBeInTheDocument();
    expect(screen.getByText('المطلوب أن يسلّمه')).toBeInTheDocument();
    const counted = screen.getByLabelText('ما عددته منه بـ SYP');
    // The settlement starts from what he already handed in and left in the drawer
    expect(counted).toHaveValue('3300');
    await user.clear(counted);
    await user.type(counted, '3200');
    expect((await screen.findAllByText(/ناقص/)).length).toBeGreaterThan(0);
    // A shortage asks what it becomes
    await user.selectOptions(screen.getByLabelText('النقص يصير'), 'rep_debt');
    expect(screen.getByRole('table', { name: 'جرد السيارة' })).toBeInTheDocument();
    expect(screen.getByLabelText('استلمت الشيك RCV-1')).toBeChecked();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'احفظ التسوية مسودة' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/rep-settlements')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/rep-settlements')[0]?.body).toMatchObject({
      repId: 'rep-1',
      businessDate: '2026-11-17',
      countedCash: { SYP: 320_000 },
      treatment: 'rep_debt',
      receivedCheques: ['rc-1'],
    });
    expect(await screen.findByText('التسوية RST-2026-000001')).toBeInTheDocument();
  });

  it('warns about documents still on the phone and a shift not closed, and sends the supervisor’s own van count', async () => {
    const { user, requestsTo } = open('/distribution/settlements/new?repId=rep-1&date=2026-11-17', {
      'GET /v1/rep-settlements/preview?repId=rep-1&date=2026-11-17': () => ({
        status: 200,
        body: preview({
          pendingDocs: 3,
          vanCountAt: null,
          shifts: [{ id: 's-1', number: 'SFT-1', status: 'open', closedAt: null }],
          items: [{ variantId: 'v-1', name: 'قميص', expectedQty: 8000, countedQty: null, diffQty: null }],
        }),
      }),
    });
    expect(await screen.findByText(/لم يصل بعد/)).toBeInTheDocument();
    expect(screen.getByText(/لم يُغلق المندوب ورديته/)).toBeInTheDocument();
    expect(screen.getByText(/لم يرسل المندوب جرد سيارته/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('عدّ قميص'), '7');
    await user.click(screen.getByRole('button', { name: 'احفظ التسوية مسودة' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/rep-settlements')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/rep-settlements')[0]?.body).toMatchObject({
      vanCount: [{ variantId: 'v-1', countedQty: 7000 }],
    });
  });

  it('shows a saved draft, and approving it shows the van count and the transfer it made', async () => {
    const { user, requestsTo } = open('/distribution/settlements/st-1');
    expect(await screen.findByText('التسوية RST-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('مسودة')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'اعتمد التسوية' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/يُجرد مخزون السيارة/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'اعتمد' }));
    expect(await screen.findByText('STK-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('TRF-2026-000002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'اعتمد التسوية' })).not.toBeInTheDocument();
    expect(requestsTo('POST', '/v1/rep-settlements/st-1/approve')[0]?.body).toEqual({ version: 1 });
  });

  it('lists the drafts and starts a new one for a rep and a day', async () => {
    const { user } = open('/distribution/settlements', {
      'GET /v1/reps': () => ({
        status: 200,
        body: [{ id: 'rep-1', userName: 'سمير', isActive: true }],
      }),
    });
    expect(await screen.findByText('RST-2026-000001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تسوية جديدة' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'سمير' });
    await user.click(within(dialog).getByRole('button', { name: 'تابع' }));
    expect(await screen.findByText('الصندوق بـ SYP')).toBeInTheDocument();
  });
});

describe('«لوحة اليوم»', () => {
  it('shows each rep’s progress, who he is with, and what he sold and collected', async () => {
    const board: TodayBoard = {
      date: '2026-11-17',
      baseCurrency: 'SYP',
      reps: [
        {
          repId: 'rep-1',
          name: 'سمير',
          vanName: 'سيارة 1',
          day: 'open',
          routeNames: ['خط المزة'],
          stops: [
            {
              customerId: 'c-1',
              name: 'بقالية الأمل',
              status: 'sale',
              arrivedAt: '2026-11-17T08:00:00.000Z',
            },
            { customerId: 'c-2', name: 'مطعم الشام', status: 'here', arrivedAt: '2026-11-17T09:00:00.000Z' },
            { customerId: 'c-3', name: 'ميني ماركت النور', status: 'todo', arrivedAt: null },
          ],
          planned: 3,
          visited: 2,
          extraVisited: 0,
          currentCustomer: 'مطعم الشام',
          lastVisitAt: '2026-11-17T09:00:00.000Z',
          sales: 1,
          orders: 0,
          collections: 1,
          returns: 0,
          noSales: 0,
          salesTotalMinor: 200_000,
          collectedMinor: 30_000,
        },
      ],
    };
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      [`GET /v1/distribution/today?date=${new Date().toLocaleDateString('en-CA')}`]: () => ({
        status: 200,
        body: board,
      }),
    });
    renderApp('/distribution/today');
    expect(await screen.findByText('سمير')).toBeInTheDocument();
    expect(screen.getByText('في الميدان')).toBeInTheDocument();
    expect(screen.getByText('مطعم الشام', { selector: 'span.font-semibold' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'زيارات سمير' })).toBeInTheDocument();
    expect(screen.getByText('عنده الآن')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});

describe('«الأهداف»', () => {
  it('lists the month’s targets with what was reached, and adds one for a rep', async () => {
    const month = monthOf();
    const row: RepTargetRow = {
      id: 't-1',
      repId: 'rep-1',
      repName: 'سمير',
      periodStart: `${month}-01`,
      periodEnd: `${month}-28`,
      metric: 'net_sales',
      scope: 'all',
      productId: null,
      categoryId: null,
      scopeName: null,
      targetValue: 500_000,
      actualValue: 250_000,
      percent: 50,
      version: 1,
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      [`GET /v1/rep-targets?month=${month}`]: () => ({ status: 200, body: [row] }),
      'GET /v1/reps': () => ({ status: 200, body: [{ id: 'rep-1', userName: 'سمير', isActive: true }] }),
      'GET /v1/categories': () => ({ status: 200, body: { items: [] } }),
      'POST /v1/rep-targets': () => ({ status: 201, body: row }),
    });
    const rendered = renderApp('/distribution/targets');
    const table = await screen.findByRole('table', { name: 'الأهداف' });
    expect(await within(table).findByText('سمير')).toBeInTheDocument();
    expect(within(table).getByText('50٪')).toBeInTheDocument();
    await rendered.user.click(screen.getByRole('button', { name: 'هدف جديد' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'سمير' });
    await rendered.user.type(within(dialog).getByLabelText('الهدف بـ SYP'), '8000');
    await rendered.user.click(within(dialog).getByRole('button', { name: 'احفظ' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/rep-targets')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/rep-targets')[0]?.body).toMatchObject({
      repId: 'rep-1',
      metric: 'net_sales',
      scope: 'all',
      targetValue: 800_000,
      periodStart: `${month}-01`,
    });
  });
});

describe('«تقارير التوزيع»', () => {
  const report = (kind: string): DistributionReport => ({
    kind: kind as DistributionReport['kind'],
    from: '2026-11-01',
    to: '2026-11-17',
    baseCurrency: 'SYP',
    columns: [
      { key: 'rep', label: 'المندوب', kind: 'text' },
      { key: 'invoices', label: 'الفواتير', kind: 'int' },
      { key: 'sales', label: 'المبيعات', kind: 'money' },
    ],
    rows: [
      { rep: 'سمير', invoices: 3, sales: 600_000 },
      { rep: 'ليلى', invoices: 1, sales: 150_000 },
    ],
    totals: { rep: 'المجموع', invoices: 4, sales: 750_000 },
    note: 'مبيعات المندوب لزبائن الخط وحدهم.',
  });

  it('reads the chosen report for the period, shows its rows and totals, and asks again for another report', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const period = `from=${today.slice(0, 8)}01&to=${today}`;
    const collectionsUrl = `/v1/distribution/reports/collections?${period}`;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/reps': () => ({ status: 200, body: [{ id: 'rep-1', userName: 'سمير', isActive: true }] }),
      [`GET /v1/distribution/reports/sales_by_rep?${period}`]: () => ({
        status: 200,
        body: report('sales_by_rep'),
      }),
      [`GET ${collectionsUrl}`]: () => ({ status: 200, body: report('collections') }),
    });
    const { user } = renderApp('/reports/distribution');
    const table = await screen.findByRole('table', { name: 'المبيعات حسب المندوب' });
    expect(await within(table).findByText('ليلى')).toBeInTheDocument();
    expect(within(table).getByText('المجموع')).toBeInTheDocument();
    expect(screen.getByText('مبيعات المندوب لزبائن الخط وحدهم.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('التقرير'), 'collections');
    expect(await screen.findByRole('table', { name: 'التحصيل' })).toBeInTheDocument();
    await waitFor(() => expect(requestsTo('GET', collectionsUrl).length).toBeGreaterThan(0));
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});

describe('«طلبية جديدة»', () => {
  it('finds a customer and an item, prices the line, and saves the order for the place it is filled from', async () => {
    const q = (text: string) => encodeURIComponent(text);
    const product = {
      id: 'p-1',
      nameAr: 'قميص قطن',
      variants: [
        {
          id: 'var-1',
          label: null,
          archivedAt: null,
          price: { currency: 'SYP', priceMinor: 150_000 },
        },
      ],
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/vans': () => ({ status: 200, body: [] }),
      'GET /v1/reps': () => ({ status: 200, body: [] }),
      [`GET /v1/customers?q=${q('مطعم')}`]: () => ({
        status: 200,
        body: {
          items: [{ id: 'c-1', name: 'مطعم الشام', phone: '0933', archived: false }],
          totalOwedMinor: 0,
          baseCurrency: 'SYP',
        },
      }),
      [`GET /v1/products?q=${q('قميص')}&limit=8`]: () => ({
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'قميص قطن', price: null }], nextCursor: null },
      }),
      'GET /v1/products/p-1': () => ({ status: 200, body: product }),
      'POST /v1/sales-orders': () => ({ status: 201, body: { id: 'o-9' } }),
      'GET /v1/sales-orders/o-9': () => ({
        status: 404,
        body: { error: { code: 'not_found', message: 'x' } },
      }),
    });
    const { user } = renderApp('/distribution/orders/new');
    await user.type(await screen.findByLabelText('ابحث عن الزبون'), 'مطعم');
    await user.click(await screen.findByRole('button', { name: /مطعم الشام/ }));
    await user.type(screen.getByLabelText('ابحث عن صنف'), 'قميص');
    await user.click(await screen.findByRole('button', { name: /قميص قطن/ }));
    const qty = await screen.findByLabelText('الكمية');
    await user.clear(qty);
    await user.type(qty, '3');
    await user.click(screen.getByRole('button', { name: 'احفظ الطلبية' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/sales-orders')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/sales-orders')[0]?.body).toMatchObject({
      customerId: 'c-1',
      warehouseBranchId: 'branch-1',
      repId: null,
      currency: 'SYP',
      lines: [{ variantId: 'var-1', qty: 3000, deliveredQty: 0, unitPriceMinor: 150_000 }],
    });
  });

  it('refuses an order with no customer or no item before asking the server', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meOf() },
      'GET /v1/vans': () => ({ status: 200, body: [] }),
      'GET /v1/reps': () => ({ status: 200, body: [] }),
    });
    const { user } = renderApp('/distribution/orders/new');
    await user.click(await screen.findByRole('button', { name: 'احفظ الطلبية' }));
    expect(await screen.findByText('اختر الزبون.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/sales-orders')).toHaveLength(0);
  });
});
