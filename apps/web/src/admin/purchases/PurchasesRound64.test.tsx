import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierDueResponse, SupplierListResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

/**
 * Round 64 (purchases): the due list in full with a pay button, the due date in the invoice table, a percent discount,
 * several photos picked on the new invoice, and a due date corrected from the invoice.
 */

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage', 'cost.view'] },
  };
}

const supplier = {
  id: 's-1',
  name: 'مؤسسة الفرات',
  phone: null,
  notes: null,
  termsDays: null,
  balanceMinor: 500_000,
  archived: false,
};
const suppliers: SupplierListResponse = { items: [supplier], totalOwedMinor: 500_000, baseCurrency: 'SYP' };

/** A day relative to now, the way the page reads «today» (the test store's own zone is close enough for a week) */
const day = (plus: number) => new Date(Date.now() + plus * 86_400_000).toISOString().slice(0, 10);

const row = (id: string, dueDate: string, openMinor: number, overdueDays: number) => ({
  purchaseId: id,
  number: `PUR-2026-${id}`,
  reference: null,
  supplierId: 's-1',
  supplierName: 'مؤسسة الفرات',
  dueDate,
  openMinor,
  overdueDays,
});
const dues = (): SupplierDueResponse => ({
  items: [
    row('000001', day(-5), 300_000, 5),
    row('000002', day(3), 200_000, 0),
    row('000003', day(40), 100_000, 0),
  ],
  totalMinor: 600_000,
  overdueMinor: 300_000,
  baseCurrency: 'SYP',
});

const base = {
  'POST /v1/auth/refresh': signedInRefresh,
  'GET /v1/me': { status: 200, body: owner() },
  'GET /v1/suppliers': { status: 200, body: suppliers },
};

describe('«مستحق هذا الأسبوع»: all dues and paying', () => {
  it('shows the week, opens every due invoice on «كل المستحقات», and each row pays with its amount', async () => {
    mockFetch({ ...base, 'GET /v1/suppliers/due?all=1': { status: 200, body: dues() } });
    const { user } = renderApp('/suppliers');
    const week = await screen.findByRole('list', { name: 'فواتير الموردين المستحقة' });
    // The late one and the one in three days: not the one in forty
    expect(within(week).getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /كل المستحقات \(3\)/ }));
    const all = screen.getByRole('list', { name: 'فواتير الموردين المستحقة' });
    expect(within(all).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'كل المستحقات' })).toBeInTheDocument();
    const pay = within(all).getByRole('link', { name: /ادفع .* PUR-2026-000002/ });
    expect(pay).toHaveAttribute('href', '/purchases?pay=s-1&amount=200000');
  });

  it('opens the payment window on that supplier with the amount typed', async () => {
    mockFetch({ ...base, 'GET /v1/suppliers/due?all=1': { status: 200, body: dues() } });
    renderApp('/purchases?pay=s-1&amount=200000');
    const amount = await screen.findByLabelText('المبلغ بالليرة');
    expect(amount).toHaveValue('2000');
  });
});

describe('the invoice table: the due column', () => {
  it('marks an open late invoice, and shows a paid one as a quiet date', async () => {
    const late = day(-5);
    const paid = day(-30);
    const invoice = (id: string, dueDate: string) => ({
      id,
      number: `PUR-2026-${id}`,
      date: '2026-10-01',
      supplierId: 's-1',
      supplierName: 'مؤسسة الفرات',
      payment: 'credit',
      reference: null,
      totalMinor: 300_000,
      dueDate,
    });
    mockFetch({
      ...base,
      'GET /v1/suppliers/due?all=1': { status: 200, body: dues() },
      'GET /v1/purchases?limit=50': {
        status: 200,
        body: { items: [invoice('000001', late), invoice('000009', paid)], baseCurrency: 'SYP' },
      },
    });
    renderApp('/purchases');
    const table = await screen.findByRole('table', { name: 'فواتير الشراء' });
    expect(within(table).getByRole('columnheader', { name: 'الاستحقاق' })).toBeInTheDocument();
    // Only the open one (listed by the due read) carries the red pill; the table shows one «متأخرة»
    await within(table).findByText('متأخرة');
    expect(within(table).getAllByText('متأخرة')).toHaveLength(1);
  });
});

describe('the new invoice: a percent discount and several photos', () => {
  it('sends the amount a percent comes to, and lists every picked picture', async () => {
    const { user, requestsTo } = (() => {
      const mock = mockFetch({
        ...base,
        'GET /v1/suppliers/due?all=1': {
          status: 200,
          body: { items: [], totalMinor: 0, overdueMinor: 0, baseCurrency: 'SYP' },
        },
        'GET /v1/purchases?limit=50': { status: 200, body: { items: [], baseCurrency: 'SYP' } },
        [`GET ${productsPath({ q: 'حليب' })}`]: {
          status: 200,
          body: { items: [{ id: 'p-1', nameAr: 'حليب طازج', type: 'stock' }], nextCursor: null },
        },
        'GET /v1/products/p-1': {
          status: 200,
          body: {
            id: 'p-1',
            nameAr: 'حليب طازج',
            variants: [{ id: 'v-1', label: null, archivedAt: null, barcodes: [] }],
          },
        },
        'POST /v1/purchases': (r: MockRequest) => ({
          status: 201,
          body: { id: 'pu-1', number: 'PUR-2026-000001', ...(r.body as object) },
        }),
      });
      return { ...mock, ...renderApp('/purchases') };
    })();
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.selectOptions(screen.getByLabelText('المورد'), 's-1');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '10');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '1000');
    await user.click(screen.getByRole('radio', { name: 'نسبة %' }));
    await user.type(screen.getByLabelText(/خصم المورد/), '5');
    // 5% of 1,000.00 is 50.00
    expect(screen.getByText(/يساوي/)).toBeInTheDocument();
    const files = [
      new File(['a'], 'paper-1.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'paper-2.jpg', { type: 'image/jpeg' }),
    ];
    await user.upload(screen.getByLabelText('صورة فاتورة المورد الورقية'), files);
    const picked = screen.getByRole('list', { name: 'الصور المرفقة' });
    expect(within(picked).getAllByRole('listitem')).toHaveLength(2);
    await user.click(within(picked).getByRole('button', { name: 'أزل الصورة paper-1.jpg' }));
    expect(within(picked).getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: 'مبلغ' }));
    await user.click(screen.getByRole('radio', { name: 'نسبة %' }));
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    expect(await screen.findByText(/سُجّلت الفاتورة PUR-2026-000001/)).toBeInTheDocument();
    const sent = requestsTo('POST', '/v1/purchases')[0]!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ discountMinor: 5000, payment: 'credit' });
  });
});

describe('the invoice detail: correcting the due date', () => {
  it('sends the new date with its reason and shows it', async () => {
    const invoice = {
      id: 'pu-7',
      number: 'PUR-2026-000007',
      date: '2026-11-02',
      supplierId: 's-1',
      supplierName: 'مؤسسة الفرات',
      payment: 'credit',
      reference: null,
      totalMinor: 1_200_000,
      dueDate: '2026-11-20',
    };
    const { requestsTo } = mockFetch({
      ...base,
      'GET /v1/suppliers/due?all=1': {
        status: 200,
        body: { items: [], totalMinor: 0, overdueMinor: 0, baseCurrency: 'SYP' },
      },
      'GET /v1/purchases?limit=50': { status: 200, body: { items: [invoice], baseCurrency: 'SYP' } },
      'GET /v1/purchases/pu-7': {
        status: 200,
        body: { ...invoice, branchId: 'b-1', notes: null, baseCurrency: 'SYP', lines: [], attachments: [] },
      },
      'PATCH /v1/purchases/pu-7/due': (r: MockRequest) => ({
        status: 200,
        body: {
          purchaseId: 'pu-7',
          dueDate: (r.body as { dueDate: string }).dueDate,
          previousDueDate: '2026-11-20',
        },
      }),
    });
    const { user } = renderApp('/purchases');
    await user.click(await screen.findByRole('button', { name: 'تفاصيل PUR-2026-000007' }));
    await user.click(await screen.findByRole('button', { name: 'عدّل الاستحقاق' }));
    const group = screen.getByRole('group', { name: 'تعديل الاستحقاق' });
    const field = within(group).getByLabelText('تاريخ الاستحقاق الجديد');
    await user.clear(field);
    await user.type(field, '15/12/2026');
    await user.type(within(group).getByLabelText('السبب'), 'اتفاق جديد');
    await user.click(within(group).getByRole('button', { name: 'احفظ' }));
    await screen.findByRole('button', { name: 'عدّل الاستحقاق' });
    expect(requestsTo('PATCH', '/v1/purchases/pu-7/due')[0]!.body).toEqual({
      dueDate: '2026-12-15',
      reason: 'اتفاق جديد',
    });
  });
});
