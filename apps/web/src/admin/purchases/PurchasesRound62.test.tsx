import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierListResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';
import { termsDaysOf } from './PurchasesPage';

/** Round 62 (purchases): due dates, the paper's discount and charges, «مستحق هذا الأسبوع», the returns search, order counts. */

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
  termsDays: 30,
  balanceMinor: 0,
  archived: false,
};
const suppliers: SupplierListResponse = { items: [supplier], totalOwedMinor: 0, baseCurrency: 'SYP' };

describe('the new invoice: due date, discount, charges', () => {
  it('starts the due date from the supplier payment days and sends it, with the discount and the charges', async () => {
    const { user, requestsTo } = (() => {
      const mock = mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: owner() },
        'GET /v1/suppliers': { status: 200, body: suppliers },
        'GET /v1/suppliers/due?days=7': {
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
    // On credit the due date shows, with where it came from
    expect(await screen.findByText(/من أيام سداد المورد \(30\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '10');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '1000');
    await user.type(screen.getByLabelText(/خصم المورد/), '100');
    await user.type(screen.getByLabelText(/رسوم إضافية/), '50');
    // The summary shows the paper's total, the discount, the charges and what the books take
    const summary = screen.getByText('ملخص الفاتورة').closest('div')!;
    expect(within(summary).getByText('مجموع الورقة')).toBeInTheDocument();
    expect(within(summary).getByText('خصم المورد')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل الفاتورة' }));
    expect(await screen.findByText(/سُجّلت الفاتورة PUR-2026-000001/)).toBeInTheDocument();
    const sent = requestsTo('POST', '/v1/purchases')[0]!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ discountMinor: 10_000, chargesMinor: 5000, payment: 'credit' });
    expect(sent.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses a discount above the paper before sending anything', async () => {
    const { user, requestsTo } = (() => {
      const mock = mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: owner() },
        'GET /v1/suppliers': { status: 200, body: suppliers },
        'GET /v1/suppliers/due?days=7': {
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
      });
      return { ...mock, ...renderApp('/purchases') };
    })();
    await user.click(await screen.findByRole('button', { name: 'فاتورة شراء' }));
    await user.selectOptions(screen.getByLabelText('المورد'), 's-1');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'حليب');
    await user.click(await screen.findByRole('button', { name: 'حليب طازج' }));
    await user.type(await screen.findByLabelText('كمية حليب طازج'), '10');
    await user.type(screen.getByLabelText('كلفة حليب طازج'), '1000');
    await user.type(screen.getByLabelText(/خصم المورد/), '1500');
    expect(await screen.findByText('أكبر من مجموع الفاتورة')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'سجّل الفاتورة' })).toBeDisabled();
    expect(requestsTo('POST', '/v1/purchases')).toHaveLength(0);
  });
});

describe('payment days', () => {
  it('reads whole days in either digits, and nothing else', () => {
    expect(termsDaysOf('30')).toBe(30);
    expect(termsDaysOf('٤٥')).toBe(45);
    expect(termsDaysOf('')).toBeNull();
    expect(termsDaysOf('366')).toBeNull();
    expect(termsDaysOf('1.5')).toBeNull();
    expect(termsDaysOf('-3')).toBeNull();
  });
});

describe('«مستحق هذا الأسبوع»', () => {
  it('lists the invoices that fall due, the late one marked, on the suppliers page', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/suppliers': { status: 200, body: { ...suppliers, totalOwedMinor: 500_000 } },
      'GET /v1/suppliers/due?days=7': {
        status: 200,
        body: {
          items: [
            {
              purchaseId: 'pu-1',
              number: 'PUR-2026-000001',
              reference: null,
              supplierId: 's-1',
              supplierName: 'مؤسسة الفرات',
              dueDate: '2026-11-18',
              openMinor: 300_000,
              overdueDays: 4,
            },
            {
              purchaseId: 'pu-2',
              number: 'PUR-2026-000002',
              reference: null,
              supplierId: 's-1',
              supplierName: 'مؤسسة الفرات',
              dueDate: '2026-11-25',
              openMinor: 200_000,
              overdueDays: 0,
            },
          ],
          totalMinor: 500_000,
          overdueMinor: 300_000,
          baseCurrency: 'SYP',
        },
      },
    });
    renderApp('/suppliers');
    const list = await screen.findByRole('list', { name: 'فواتير الموردين المستحقة' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).getByText('متأخرة')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'مستحق هذا الأسبوع' })).toBeInTheDocument();
  });

  it('shows nothing when no invoice falls due', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/suppliers': { status: 200, body: suppliers },
      'GET /v1/suppliers/due?days=7': {
        status: 200,
        body: { items: [], totalMinor: 0, overdueMinor: 0, baseCurrency: 'SYP' },
      },
    });
    renderApp('/suppliers');
    await screen.findByRole('heading', { name: 'الموردون' });
    expect(screen.queryByRole('heading', { name: 'مستحق هذا الأسبوع' })).not.toBeInTheDocument();
  });
});

describe('the returns list: search and supplier', () => {
  it('asks the server for one supplier, or a search, and keeps no row twice', async () => {
    const row = (n: number) => ({
      id: `r-${n}`,
      number: `PRT-2026-00000${n}`,
      date: '2026-11-03',
      supplierName: 'مؤسسة الفرات',
      refund: 'credit' as const,
      pieces: 1000,
      amountMinor: 50_000,
    });
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/suppliers': { status: 200, body: suppliers },
      'GET /v1/supplier-returns': { status: 200, body: { items: [row(1), row(2)], nextCursor: 'c1' } },
      // The next page repeats a row the first one had (a return made meanwhile): it is shown once
      'GET /v1/supplier-returns?cursor=c1': {
        status: 200,
        body: { items: [row(2), row(3)], nextCursor: null },
      },
      'GET /v1/supplier-returns?supplierId=s-1': { status: 200, body: { items: [row(1)], nextCursor: null } },
      'GET /v1/supplier-returns?q=PRT-2026-000003': {
        status: 200,
        body: { items: [row(3)], nextCursor: null },
      },
    });
    const { user } = renderApp('/supplier-returns');
    const table = await screen.findByRole('table', { name: 'المرتجعات إلى الموردين' });
    await within(table).findByText('PRT-2026-000001');
    await user.click(await screen.findByRole('button', { name: 'أظهر المزيد' }));
    await within(table).findByText('PRT-2026-000003');
    expect(within(table).getAllByText('PRT-2026-000002')).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('المورد'), 's-1');
    await within(table).findByText('PRT-2026-000001');
    expect(within(table).queryByText('PRT-2026-000003')).not.toBeInTheDocument();
    expect(requestsTo('GET', '/v1/supplier-returns?supplierId=s-1')).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('المورد'), '');
    await user.type(screen.getByLabelText('ابحث في المرتجعات'), 'PRT-2026-000003');
    await within(table).findByText('PRT-2026-000003');
    expect(requestsTo('GET', '/v1/supplier-returns?q=PRT-2026-000003')).toHaveLength(1);
  });
});

describe('one return in full', () => {
  it('names the branch and the serial numbers, and opens the invoice itself from its number', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: owner() },
      'GET /v1/suppliers': { status: 200, body: suppliers },
      'GET /v1/supplier-returns': {
        status: 200,
        body: {
          items: [
            {
              id: 'r-1',
              number: 'PRT-2026-000001',
              date: '2026-11-03',
              supplierName: 'مؤسسة الفرات',
              refund: 'credit',
              pieces: 1000,
              amountMinor: 50_000,
            },
          ],
          nextCursor: null,
        },
      },
      'GET /v1/supplier-returns/r-1': {
        status: 200,
        body: {
          id: 'r-1',
          number: 'PRT-2026-000001',
          date: '2026-11-03',
          supplierId: 's-1',
          supplierName: 'مؤسسة الفرات',
          branchId: 'b-1',
          branchName: 'فرع المزة',
          refund: 'credit',
          reference: null,
          purchaseId: 'pu-1',
          purchaseNumber: 'PUR-2026-000007',
          lines: [
            {
              variantId: 'v-1',
              name: 'هاتف',
              qty: 1000,
              amountMinor: 50_000,
              costMinor: 50_000,
              serials: ['IMEI-A1'],
            },
          ],
          amountMinor: 50_000,
          costMinor: 50_000,
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/store': { status: 200, body: { name: 'متجر', taxNumber: null, address: null, phone: null } },
      'GET /v1/purchases/pu-1': {
        status: 200,
        body: {
          id: 'pu-1',
          number: 'PUR-2026-000007',
          date: '2026-11-01',
          supplierId: 's-1',
          supplierName: 'مؤسسة الفرات',
          payment: 'credit',
          reference: null,
          totalMinor: 50_000,
          branchId: 'b-1',
          notes: null,
          dueDate: '2026-12-01',
          lines: [],
          baseCurrency: 'SYP',
        },
      },
    });
    const { user } = renderApp('/supplier-returns');
    const table = await screen.findByRole('table', { name: 'المرتجعات إلى الموردين' });
    await user.click(await within(table).findByText('PRT-2026-000001'));
    expect(await screen.findByText(/من فرع فرع المزة/)).toBeInTheDocument();
    expect(screen.getByText('IMEI-A1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'PUR-2026-000007' }));
    expect(await screen.findByText(/تستحق في/)).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/purchases/pu-1').length).toBeGreaterThan(0);
  });
});
