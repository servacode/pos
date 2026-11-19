import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addMonthsISO, daysBetweenISO } from '@serva/core';
import type {
  ExpiryResponse,
  ExpiryRow,
  MeResponse,
  ShortageRow,
  ShortagesResponse,
  SupplierReturnDetail,
} from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { today } from './api';
import { groupExpiring, prefillOfGroup } from './expiringBySupplier';
import { groupShortages } from './ShortagesPage';
import { buildCreate, emptyDraft } from '../products/form';

function buyer(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    tenant: { ...base.tenant, sectors: ['pharmacy'] },
    user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] },
  };
}

const row = (over: Partial<ExpiryRow>): ExpiryRow => ({
  variantId: 'v-1',
  name: 'بانادول 500',
  branchId: 'br-1',
  branchName: 'الفرع الرئيسي',
  batchNo: 'A-01',
  expiryDate: '2026-12-25',
  purchaseNumber: 'PUR-0001',
  supplierId: 'sup-1',
  supplierName: 'مستودع الشفاء',
  receivedOn: '2026-10-20',
  qty: 10_000,
  daysLeft: 40,
  blocked: false,
  blockReason: null,
  ...over,
});

describe('groupExpiring', () => {
  const items = [
    row({}),
    row({ variantId: 'v-2', name: 'أموكسيل', batchNo: 'B-1', daysLeft: -3, qty: 2000 }),
    row({
      variantId: 'v-3',
      name: 'فيتامين',
      supplierId: 'sup-2',
      supplierName: 'مستودع النور',
      daysLeft: 70,
    }),
    row({ variantId: 'v-4', name: 'بعيد', daysLeft: 400 }),
    row({ variantId: 'v-5', name: 'بلا دفعة', batchNo: null, expiryDate: null, daysLeft: null }),
    row({ variantId: 'v-6', name: 'بلا مورد', supplierId: null, supplierName: null, daysLeft: 10 }),
    row({ variantId: 'v-7', name: 'فرع آخر', branchId: 'br-2', branchName: 'فرع المزة', daysLeft: 20 }),
  ];

  it('groups by supplier and branch, the nearest expiry first, leaving out what ends later or has no date', () => {
    const groups = groupExpiring(items, 92);
    expect(groups.map((g) => [g.supplierName, g.branchName, g.rows.map((r) => r.name)])).toEqual([
      ['مستودع الشفاء', 'الفرع الرئيسي', ['أموكسيل', 'بانادول 500']],
      ['مورد غير معروف', 'الفرع الرئيسي', ['بلا مورد']],
      ['مستودع الشفاء', 'فرع المزة', ['فرع آخر']],
      ['مستودع النور', 'الفرع الرئيسي', ['فيتامين']],
    ]);
    expect(groups[0]).toMatchObject({ totalQty: 12_000, earliestDays: -3, expired: 1 });
  });

  it('fills the supplier return with every batch and what is left of it, and none for an unknown supplier', () => {
    const [first, unknown] = groupExpiring(items, 92);
    expect(prefillOfGroup(first!, 3)).toEqual({
      supplierId: 'sup-1',
      branchId: 'br-1',
      note: 'منتهية أو تنتهي خلال 3 أشهر',
      lines: [
        {
          variantId: 'v-2',
          name: 'أموكسيل',
          qty: 2000,
          batchNo: 'B-1',
          expiryDate: '2026-12-25',
          purchaseId: null,
        },
        {
          variantId: 'v-1',
          name: 'بانادول 500',
          qty: 10_000,
          batchNo: 'A-01',
          expiryDate: '2026-12-25',
          purchaseId: null,
        },
      ],
    });
    expect(prefillOfGroup(unknown!, 3)).toBeNull();
  });
});

describe('«بينتهي قريباً»', () => {
  const t = today();
  const days = (months: number) => daysBetweenISO(t, addMonthsISO(t, months));

  function server(report: ExpiryRow[]) {
    const returns: unknown[] = [];
    const mocks = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: buyer() }),
      [`GET /v1/inventory/expiry?days=${days(3)}`]: () => ({
        status: 200,
        body: { today: t, items: report } satisfies ExpiryResponse,
      }),
      [`GET /v1/inventory/expiry?days=${days(1)}`]: () => ({
        status: 200,
        body: { today: t, items: report.filter((r) => (r.daysLeft ?? 0) <= 30) } satisfies ExpiryResponse,
      }),
      'GET /v1/suppliers': {
        status: 200,
        body: {
          items: [
            {
              id: 'sup-1',
              name: 'مستودع الشفاء',
              phone: null,
              notes: null,
              balanceMinor: 0,
              archived: false,
            },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/supplier-returns': { status: 200, body: { items: [] } },
      'GET /v1/purchases': { status: 200, body: { items: [] } },
      'GET /v1/inventory/expiry?days=3650&variantId=v-1&branchId=br-1': {
        status: 200,
        body: { today: t, items: [row({})] },
      },
      'GET /v1/inventory/expiry?days=3650&variantId=v-2&branchId=br-1': {
        status: 200,
        body: { today: t, items: [row({ variantId: 'v-2', batchNo: 'B-1' })] },
      },
      'POST /v1/supplier-returns': (r: MockRequest) => {
        returns.push(r.body);
        return {
          status: 201,
          body: {
            id: 'r-1',
            number: 'PRT-2026-000001',
            date: t,
            supplierName: 'مستودع الشفاء',
            refund: 'credit',
            pieces: 12_000,
            amountMinor: 0,
            lines: [],
          } as unknown as SupplierReturnDetail,
        };
      },
    });
    return { ...mocks, returns };
  }

  const report = [
    row({}),
    row({ variantId: 'v-2', name: 'أموكسيل 250', batchNo: 'B-1', daysLeft: -3, qty: 2000 }),
    row({
      variantId: 'v-3',
      name: 'فيتامين د',
      supplierId: 'sup-2',
      supplierName: 'مستودع النور',
      daysLeft: 70,
    }),
  ];

  it('groups the batches by supplier, with the expired ones marked', async () => {
    server(report);
    renderApp('/expiring-soon');
    const shifa = await screen.findByRole('list', { name: 'دفعات مستودع الشفاء' });
    expect(within(shifa).getByText('بانادول 500')).toBeInTheDocument();
    expect(within(shifa).getByText(/منتهية منذ 3 أيام/)).toBeInTheDocument();
    expect(within(shifa).getByText(/باقٍ 40 يوماً/)).toBeInTheDocument();
    const nour = screen.getByRole('list', { name: 'دفعات مستودع النور' });
    expect(within(nour).getByText('فيتامين د')).toBeInTheDocument();
  });

  it('«رجّعو للمورد» opens the supplier return already filled, and saving sends those batches', async () => {
    const { returns } = server(report);
    const { user } = renderApp('/expiring-soon');
    await screen.findByRole('list', { name: 'دفعات مستودع الشفاء' });
    await user.click(screen.getByRole('button', { name: 'رجّعو للمورد مستودع الشفاء' }));
    // The return page opens with the supplier chosen and both batches as lines
    const lines = await screen.findByRole('list', { name: 'أصناف المرتجع' });
    expect(within(lines).getByText('أموكسيل 250')).toBeInTheDocument();
    expect(within(lines).getByText('بانادول 500')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await waitFor(() => expect(returns).toHaveLength(1));
    expect(returns[0]).toMatchObject({
      supplierId: 'sup-1',
      branchId: 'br-1',
      lines: [
        { variantId: 'v-2', qty: 2000, batchNo: 'B-1', expiryDate: '2026-12-25' },
        { variantId: 'v-1', qty: 10_000, batchNo: 'A-01', expiryDate: '2026-12-25' },
      ],
    });
  });

  const lateRow = (purchaseId: string) =>
    row({ variantId: 'v-2', name: 'أموكسيل 250', batchNo: 'B-1', daysLeft: -3, qty: 2000, purchaseId });

  it('names the invoice the batches came on: all on one invoice go back against it, at its cost (round 39)', async () => {
    const { returns } = server([row({ purchaseId: 'pu-1' }), lateRow('pu-1')]);
    const { user } = renderApp('/expiring-soon');
    await user.click(await screen.findByRole('button', { name: 'رجّعو للمورد مستودع الشفاء' }));
    await screen.findByRole('list', { name: 'أصناف المرتجع' });
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await waitFor(() => expect(returns).toHaveLength(1));
    expect(returns[0]).toMatchObject({ purchaseId: 'pu-1' });
  });

  it('batches from several invoices make one return each, every one against its own invoice (round 39)', async () => {
    const { returns } = server([row({ purchaseId: 'pu-1' }), lateRow('pu-2')]);
    const { user } = renderApp('/expiring-soon');
    await user.click(await screen.findByRole('button', { name: 'رجّعو للمورد مستودع الشفاء' }));
    await screen.findByRole('list', { name: 'أصناف المرتجع' });
    expect(screen.getByText(/يُسجَّل مرتجع لكل فاتورة/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await waitFor(() => expect(returns).toHaveLength(2));
    expect(returns.map((r) => (r as { purchaseId?: string }).purchaseId).sort()).toEqual(['pu-1', 'pu-2']);
    // Each return carries only its own invoice's batch
    expect((returns[0] as { lines: unknown[] }).lines).toHaveLength(1);
  });

  it('a batch with no purchase link is returned as before, at the average (no invoice)', async () => {
    const { returns } = server(report);
    const { user } = renderApp('/expiring-soon');
    await user.click(await screen.findByRole('button', { name: 'رجّعو للمورد مستودع الشفاء' }));
    await screen.findByRole('list', { name: 'أصناف المرتجع' });
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await waitFor(() => expect(returns).toHaveLength(1));
    expect(returns[0]).not.toHaveProperty('purchaseId');
  });

  it('narrows to a month, and says so when nothing ends in the window', async () => {
    server([row({ daysLeft: 200 })]);
    const { user } = renderApp('/expiring-soon');
    expect(await screen.findByText('لا شيء ينتهي في هذه المدة.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'شهر' }));
    expect(await screen.findByText('لا شيء ينتهي في هذه المدة.')).toBeInTheDocument();
  });
});

describe('«النواقص»', () => {
  const shortage = (over: Partial<ShortageRow>): ShortageRow => ({
    variantId: 'v-1',
    name: 'بانادول 500',
    genericName: 'باراسيتامول',
    stockQty: 0,
    minStockQty: 5000,
    requestCount: 0,
    requestedQty: 0,
    lastRequestedAt: null,
    requestIds: [],
    reason: 'below_min',
    lastSupplierId: 'sup-1',
    lastSupplierName: 'مستودع الشفاء',
    ...over,
  });

  it('groups by the supplier an item was last bought from, unknown ones last', () => {
    const groups = groupShortages([
      shortage({ variantId: null, name: 'سيروم', lastSupplierId: null, lastSupplierName: null }),
      shortage({}),
      shortage({
        variantId: 'v-2',
        name: 'أموكسيل',
        lastSupplierId: 'sup-2',
        lastSupplierName: 'مستودع النور',
      }),
    ]);
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([
      ['مستودع الشفاء', 1],
      ['مستودع النور', 1],
      ['بلا مورد معروف', 1],
    ]);
  });

  it('lists what is short with why, closes a customer request, and starts the supplier’s order', async () => {
    let items: ShortageRow[] = [
      shortage({}),
      shortage({
        variantId: 'v-2',
        name: 'أموكسيل 250',
        genericName: 'أموكسيسيلين',
        stockQty: 1000,
        minStockQty: null,
        requestCount: 2,
        requestedQty: 3000,
        lastRequestedAt: '2026-11-17T09:30:00.000Z',
        requestIds: ['q-1', 'q-2'],
        reason: 'requested',
      }),
    ];
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: buyer() }),
      'GET /v1/pharmacy/shortages': () => ({ status: 200, body: { items } satisfies ShortagesResponse }),
      'POST /v1/pharmacy/shortages/resolve': (r: MockRequest) => {
        expect((r.body as { ids: string[] }).ids).toEqual(['q-1', 'q-2']);
        items = items.filter((i) => i.requestIds.length === 0);
        return { status: 200, body: { items } satisfies ShortagesResponse };
      },
    });
    const { user } = renderApp('/shortages');
    const list = await screen.findByRole('list', { name: 'نواقص مستودع الشفاء' });
    expect(within(list).getByText('تحت الحد الأدنى')).toBeInTheDocument();
    expect(within(list).getByText('طلبه زبون')).toBeInTheDocument();
    expect(list).toHaveTextContent(/طُلب\s*2\s*مرة/);
    expect(within(list).getAllByRole('button', { name: /تم توفيره/ })).toHaveLength(1);
    await user.click(within(list).getByRole('button', { name: 'تم توفيره: أموكسيل 250' }));
    await waitFor(() => expect(within(list).queryByText('أموكسيل 250')).toBeNull());
    expect(requestsTo('POST', '/v1/pharmacy/shortages/resolve')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'اطلب من المورد' })).toBeInTheDocument();
  });

  it('says an order was sent for an item, and offers a second one only quietly (round 39)', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: buyer() }),
      'GET /v1/pharmacy/shortages': () => ({
        status: 200,
        body: {
          items: [
            shortage({
              stockQty: 0,
              expiredQty: 20_000,
              onOrderQty: 10_000,
              orderNumbers: ['PO-2026-000001'],
            }),
          ],
        } satisfies ShortagesResponse,
      }),
    });
    renderApp('/shortages');
    const list = await screen.findByRole('list', { name: 'نواقص مستودع الشفاء' });
    expect(within(list).getByText('انطلبت بPO-2026-000001')).toBeInTheDocument();
    expect(list).toHaveTextContent(/منتهي أو موقوف\s*20/);
    // The primary «اطلب من المورد» is gone: only «اطلب مرة تانية» is left
    expect(screen.queryByRole('button', { name: 'اطلب من المورد' })).toBeNull();
    expect(screen.getByRole('button', { name: 'اطلب مرة تانية' })).toBeInTheDocument();
  });

  it('is empty with a clear sentence', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: buyer() }),
      'GET /v1/pharmacy/shortages': () => ({ status: 200, body: { items: [] } }),
    });
    renderApp('/shortages');
    expect(await screen.findByText('لا نواقص الآن.')).toBeInTheDocument();
  });
});

describe('strength and dosage form on the product form', () => {
  it('are sent on create, and an update carries only what changed', () => {
    const draft = {
      ...emptyDraft({ currency: 'SYP', unitId: 'u-1' }),
      nameAr: 'بانادول',
      genericName: 'باراسيتامول',
    };
    const none = buildCreate(draft);
    expect(none.body).not.toHaveProperty('strength');
    const built = buildCreate({ ...draft, strength: ' 500 ملغ ', dosageForm: 'أقراص' });
    expect(built.body).toMatchObject({ strength: '500 ملغ', dosageForm: 'أقراص' });
  });
});
