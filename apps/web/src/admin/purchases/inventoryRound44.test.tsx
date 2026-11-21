import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CountSheet,
  DamagedStock,
  InventoryResponse,
  MeResponse,
  Permission,
  StocktakeDetail,
  TransferFull,
} from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { isoDay } from '../../lib/dates';
import { productsPath } from '../catalog/api';

/** Round 44, inventory: the count of one branch, the stale write-off, the cancelled transfer, the phone's Enter and owner */

const withPermissions = (extra: Permission[], over: Partial<MeResponse> = {}): MeResponse => {
  const base = makeMe();
  return { ...base, ...over, user: { ...base.user, permissions: [...base.user.permissions, ...extra] } };
};
const two = [
  { id: 'b-main', code: '001', name: 'الفرع الرئيسي' },
  { id: 'b-mall', code: '002', name: 'فرع المول' },
];
const row = (over: Partial<InventoryResponse['items'][number]>): InventoryResponse['items'][number] => ({
  variantId: 'v-1',
  name: 'قميص',
  branchId: 'b-main',
  branchName: 'الفرع الرئيسي',
  branchKind: 'store',
  qty: 10_000,
  valueMinor: 400_000,
  unitCostMinor: 40,
  ...over,
});

describe('the shelf count of a store with two branches', () => {
  it('counts one branch: its rows only, its id on the post, one typed number is not copied into the other', async () => {
    const stock: InventoryResponse = {
      items: [
        row({ variantId: 'v-1', branchId: 'b-main', qty: 10_000 }),
        row({ variantId: 'v-1', branchId: 'b-mall', branchName: 'فرع المول', qty: 4000 }),
      ],
      totalValueMinor: 560_000,
      baseCurrency: 'SYP',
      asOf: '2026-11-20T10:00:00.000Z',
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: withPermissions(['cost.view', 'inventory.adjust'], { branches: two }),
      }),
      'GET /v1/inventory': { status: 200, body: stock },
      'POST /v1/stocktakes': {
        status: 201,
        body: {
          id: 's-1',
          number: 'STK-1',
          date: '2026-11-20',
          branchId: 'b-mall',
          lines: [],
          diffValueMinor: 0,
          baseCurrency: 'SYP',
        } satisfies StocktakeDetail,
      },
    });
    const { user } = renderApp('/inventory');
    await user.click(await screen.findByRole('button', { name: 'جرد الرفوف' }));
    // The branch is chosen first; the table shows that branch alone
    const pick = await screen.findByLabelText('الفرع الذي تعدّه');
    await user.selectOptions(pick, 'b-mall');
    expect(screen.getAllByLabelText('المعدود من قميص')).toHaveLength(1);
    await user.type(screen.getByLabelText('المعدود من قميص'), '4');
    await user.click(screen.getByRole('button', { name: 'راجع الجرد' }));
    const review = await screen.findByRole('table', { name: 'فروق الجرد' });
    // Against the mall's 4 it is a match, not a loss measured against the main branch's 10
    expect(within(review).getByText('مطابق')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل الجرد' }));
    expect(await screen.findByText(/سُجّل الجرد STK-1/)).toBeInTheDocument();
    const body = requestsTo('POST', '/v1/stocktakes')[0]!.body as { branchId: string; id: string };
    expect(body.branchId).toBe('b-mall');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('names a van and every branch the list has, from the answer', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['cost.view']) }),
      'GET /v1/inventory': {
        status: 200,
        body: {
          items: [
            row({ variantId: 'v-1' }),
            row({
              variantId: 'v-1',
              branchId: 'b-van',
              branchName: 'سيارة أحمد',
              branchKind: 'van',
              qty: 2000,
            }),
          ],
          totalValueMinor: 480_000,
          baseCurrency: 'SYP',
        } satisfies InventoryResponse,
      },
    });
    renderApp('/inventory');
    expect((await screen.findAllByText('سيارة أحمد (مندوب)')).length).toBeGreaterThan(0);
  });

  it('says an item with no cost is a gap, and does not print a margin of 100%', async () => {
    const today = isoDay(Date.now(), makeMe().tenant.timezone);
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['cost.view', 'reports.financial']) }),
      'GET /v1/inventory': {
        status: 200,
        body: {
          items: [row({ unitCostMinor: null, valueMinor: 0 })],
          totalValueMinor: 0,
          baseCurrency: 'SYP',
        } satisfies InventoryResponse,
      },
      [`GET /v1/reports/profit?from=${today.slice(0, 8)}01&to=${today}`]: {
        status: 200,
        body: {
          from: '2026-11-01',
          to: '2026-11-20',
          netSalesMinor: 1_000_000,
          costOfSalesMinor: 0,
          grossProfitMinor: 1_000_000,
          stockLossMinor: 0,
          baseCurrency: 'SYP',
        },
      },
    });
    renderApp('/inventory');
    expect(await screen.findByText(/لا كلفة مسجّلة لها/)).toBeInTheDocument();
    expect(await screen.findByText(/الكلفة غير مسجلة لهذه المبيعات/)).toBeInTheDocument();
    expect(screen.queryByText(/100/)).not.toBeInTheDocument();
  });

  it('shows the stock page as a closed door to a user who cannot see costs', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['inventory.adjust']) }),
    });
    renderApp('/inventory');
    expect(
      await screen.findByText(
        (text) => text === 'هذه الشاشة ليست ضمن صلاحياتك.' || text === 'ليس لديك صلاحية لهذه الصفحة',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('لا مخزون بعد.')).not.toBeInTheDocument();
  });

  it('counts a write-off from the moment the list was read, with its own id', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['cost.view', 'inventory.adjust']) }),
      'GET /v1/inventory': {
        status: 200,
        body: {
          items: [row({ branchId: 'b-1' })],
          totalValueMinor: 400_000,
          baseCurrency: 'SYP',
          asOf: '2026-11-20T10:00:00.000Z',
        } satisfies InventoryResponse,
      },
      'POST /v1/stocktakes': {
        status: 201,
        body: {
          id: 's-2',
          number: 'STK-2',
          date: '2026-11-20',
          branchId: 'b-1',
          lines: [],
          diffValueMinor: -120_000,
          baseCurrency: 'SYP',
        } satisfies StocktakeDetail,
      },
    });
    const { user } = renderApp('/inventory');
    await user.click(await screen.findByRole('button', { name: 'سجّل هدراً' }));
    const form = await screen.findByRole('form', { name: 'سجّل هدراً' });
    await user.selectOptions(within(form).getByLabelText('الصنف التالف'), 'b-1:v-1');
    await user.type(within(form).getByLabelText('كمية الهدر'), '3');
    await user.click(within(form).getByRole('button', { name: 'سجّل الهدر' }));
    await user.click(within(form).getByRole('button', { name: 'أكّد الهدر' }));
    await screen.findByText(/سُجّل الجرد STK-2/);
    expect(requestsTo('POST', '/v1/stocktakes')[0]!.body).toMatchObject({
      countedAt: '2026-11-20T10:00:00.000Z',
      lines: [{ countedQty: 7000 }],
    });
  });
});

describe('«الجرد السابق»', () => {
  it('lists the counts already made with who counted and what the difference cost', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['cost.view', 'inventory.adjust']) }),
      'GET /v1/inventory': {
        status: 200,
        body: { items: [row({})], totalValueMinor: 400_000, baseCurrency: 'SYP' } satisfies InventoryResponse,
      },
      'GET /v1/stocktakes': {
        status: 200,
        body: {
          items: [
            {
              id: 's-1',
              number: 'STK-2026-000003',
              date: '2026-11-19',
              branchId: 'b-main',
              branchName: 'الفرع الرئيسي',
              by: 'سامر',
              kind: 'count',
              items: 12,
              diffValueMinor: -47_000,
              note: null,
            },
          ],
          nextCursor: null,
        },
      },
    });
    renderApp('/inventory');
    const table = await screen.findByRole('table', { name: 'الجرد السابق' });
    expect(within(table).getByText('STK-2026-000003')).toBeInTheDocument();
    expect(within(table).getByText('سامر')).toBeInTheDocument();
  });
});

describe('«البضاعة التالفة»: the write-off', () => {
  it('counts from the moment the list was read and carries its own id', async () => {
    const damaged: DamagedStock = {
      baseCurrency: 'SYP',
      asOf: '2026-11-20T09:00:00.000Z',
      locations: [
        {
          branchId: 'd-1',
          ownerBranchId: 'b-1',
          ownerName: 'الفرع الرئيسي',
          totalValueMinor: 80_000,
          items: [{ variantId: 'v-1', name: 'زيت', qty: 2000, valueMinor: 80_000 }],
        },
      ],
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['inventory.adjust', 'purchases.manage']) }),
      'GET /v1/damaged-stock': { status: 200, body: damaged },
      'POST /v1/stocktakes': { status: 201, body: { id: 's-3', number: 'STK-3' } },
    });
    const { user } = renderApp('/damaged-stock');
    await user.click(await screen.findByRole('button', { name: 'اشطبها' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'اشطب' }));
    await screen.findByText(/شُطبت «زيت»/);
    const body = requestsTo('POST', '/v1/stocktakes')[0]!.body as { id: string; countedAt: string };
    expect(body.countedAt).toBe('2026-11-20T09:00:00.000Z');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('«التحويل بين الفروع»: a slip and a cancel', () => {
  const onTheWay = {
    id: 't-9',
    number: 'TRF-2026-000009',
    date: '2026-11-03',
    fromBranch: 'الفرع الرئيسي',
    toBranch: 'فرع المول',
    pieces: 4000,
    valueMinor: 160_000,
    status: 'in_transit' as const,
    fromBranchId: 'b-main',
    toBranchId: 'b-mall',
    canReceive: true,
    canCancel: true,
  };

  it('shows what the sender holds on the line and refuses more unless the owner ticks that he means it', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: withPermissions(['cost.view', 'inventory.adjust'], { branches: two }),
      }),
      'GET /v1/transfers': { status: 200, body: { items: [], nextCursor: null, inTransit: 0 } },
      'GET /v1/inventory': {
        status: 200,
        body: {
          items: [row({ variantId: 'v-1', qty: 3000 })],
          totalValueMinor: 0,
          baseCurrency: 'SYP',
        } satisfies InventoryResponse,
      },
      [`GET ${productsPath({ q: 'قميص' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'قميص', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'قميص',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [], barcodes: [] }],
        },
      },
      'POST /v1/transfers': {
        status: 201,
        body: {
          id: 't-1',
          number: 'TRF-2026-000001',
          date: '2026-11-20',
          fromBranchId: 'b-main',
          toBranchId: 'b-mall',
          lines: [],
          valueMinor: 0,
          baseCurrency: 'SYP',
        },
      },
    });
    const { user } = renderApp('/transfers');
    await user.type(await screen.findByLabelText('أضف صنفاً بالاسم أو الباركود'), 'قميص');
    await user.click(await screen.findByRole('button', { name: 'قميص' }));
    await user.type(await screen.findByLabelText('كمية قميص'), '999');
    expect(await screen.findByText(/المتوفر عند المرسِل/)).toBeInTheDocument();
    expect(screen.getByText(/الكمية أكبر من المتوفر/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'سجّل التحويل' })).toBeDisabled();
    await user.click(screen.getByLabelText('أرسل رغم نقص المتوفر'));
    await user.click(screen.getByRole('button', { name: 'سجّل التحويل' }));
    await screen.findByText(/سُجّل التحويل TRF-2026-000001/);
    // Ticked: the server is told it need not refuse
    expect(
      (requestsTo('POST', '/v1/transfers')[0]!.body as { strictStock?: boolean }).strictStock,
    ).toBeUndefined();
  });

  it('cancels a transfer on the way after asking, and says the goods are back with the sender', async () => {
    let cancelled = false;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['inventory.adjust'], { branches: two }) }),
      'GET /v1/transfers': () => ({
        status: 200,
        body: {
          items: [
            cancelled ? { ...onTheWay, status: 'cancelled', canReceive: false, canCancel: false } : onTheWay,
          ],
          nextCursor: null,
          inTransit: cancelled ? 0 : 1,
        },
      }),
      'GET /v1/transfers/settings': { status: 200, body: { mode: 'auto', effective: 'transit' } },
      'POST /v1/transfers/t-9/cancel': () => {
        cancelled = true;
        return {
          status: 200,
          body: {
            id: 't-9',
            number: 'TRF-2026-000009',
            date: '2026-11-03',
            fromBranchId: 'b-main',
            toBranchId: 'b-mall',
            fromBranch: 'الفرع الرئيسي',
            toBranch: 'فرع المول',
            status: 'cancelled',
            note: null,
            lines: [],
            valueMinor: 160_000,
            baseCurrency: 'SYP',
            receipt: null,
          } satisfies TransferFull,
        };
      },
    });
    const { user } = renderApp('/transfers');
    const table = await screen.findByRole('table', { name: 'التحويلات' });
    await user.click(within(table).getByRole('button', { name: 'ألغِ التحويل' }));
    const dialog = await screen.findByRole('dialog');
    expect(requestsTo('POST', '/v1/transfers/t-9/cancel')).toHaveLength(0);
    await user.type(within(dialog).getByLabelText('السبب (اختياري)'), 'كمية خاطئة');
    await user.click(within(dialog).getByRole('button', { name: 'ألغِ التحويل' }));
    expect(await screen.findByText(/أُلغي التحويل TRF-2026-000009/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/transfers/t-9/cancel')[0]!.body).toMatchObject({ reason: 'كمية خاطئة' });
    expect(
      await within(await screen.findByRole('table', { name: 'التحويلات' })).findByText(/أُلغي وعاد/),
    ).toBeInTheDocument();
  });

  it('hides the buttons a user has no right to', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: withPermissions(['inventory.adjust'], { branches: two }) }),
      'GET /v1/transfers': {
        status: 200,
        body: {
          items: [{ ...onTheWay, canReceive: false, canCancel: false }],
          nextCursor: null,
          inTransit: 1,
        },
      },
      'GET /v1/transfers/settings': { status: 200, body: { mode: 'auto', effective: 'transit' } },
    });
    renderApp('/transfers');
    const table = await screen.findByRole('table', { name: 'التحويلات' });
    expect(within(table).queryByRole('button', { name: 'استلم' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'ألغِ التحويل' })).not.toBeInTheDocument();
  });
});

describe('«الجرد بالهاتف»: Enter and the owner of the draft', () => {
  const sheet: CountSheet = {
    branchId: 'b-1',
    categoryId: null,
    at: '2026-11-19T08:00:00.000Z',
    categories: [],
    items: [
      {
        variantId: 'v-1',
        name: 'حزام أسود',
        categoryId: null,
        allowsFraction: false,
        qty: 3000,
        barcodes: [],
      },
      {
        variantId: 'v-2',
        name: 'حزام بني',
        categoryId: null,
        allowsFraction: false,
        qty: 1000,
        barcodes: [],
      },
      { variantId: 'v-3', name: 'قبعة', categoryId: null, allowsFraction: false, qty: 1000, barcodes: [] },
    ],
  };
  const draft = (owner?: string) => ({
    id: '0192a000-0000-7000-8000-00000000d001',
    branchId: 'b-1',
    categoryId: null,
    sheetAt: sheet.at,
    counts: {},
    queued: false,
    restZero: false,
    ...(owner ? { owner } : {}),
  });
  const routes = {
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: withPermissions(['inventory.adjust']) }),
  };
  beforeEach(() => {
    localStorage.removeItem('serva.count.draft');
    localStorage.removeItem('serva.count.sheet');
  });

  it('does not count the first of several matches on Enter, and counts the only match by itself', async () => {
    mockFetch(routes);
    localStorage.setItem('serva.count.draft', JSON.stringify(draft()));
    localStorage.setItem('serva.count.sheet', JSON.stringify(sheet));
    const { user } = renderApp('/inventory/count');
    const box = await screen.findByLabelText('باركود أو اسم صنف');
    await user.type(box, 'حزام{Enter}');
    expect(await screen.findByText(/أكثر من صنف يطابق هذا الاسم/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('serva.count.draft')!).counts).toEqual({});
    await user.clear(box);
    await user.type(box, 'قبعة{Enter}');
    expect(JSON.parse(localStorage.getItem('serva.count.draft')!).counts).toEqual({ 'v-3': 1000 });
  });

  it('does not resume a count another person started on the same phone', async () => {
    mockFetch({ ...routes, 'GET /v1/categories': { status: 200, body: { items: [] } } });
    localStorage.setItem('serva.count.draft', JSON.stringify(draft('other-tenant:other-user')));
    localStorage.setItem('serva.count.sheet', JSON.stringify(sheet));
    renderApp('/inventory/count');
    expect(await screen.findByRole('button', { name: 'حمّل قائمة الجرد' })).toBeInTheDocument();
  });
});
