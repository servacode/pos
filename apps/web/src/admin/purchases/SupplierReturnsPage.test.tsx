import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SupplierReturnDetail } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { productsPath } from '../catalog/api';

function buyer(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

describe('«مرتجع إلى المورد»', () => {
  it('sends pieces back to a supplier, at cost unless an amount is typed, and lists it', async () => {
    let listed = false;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': {
        status: 200,
        body: {
          items: [
            {
              id: 's-1',
              name: 'معمل الأمل',
              phone: null,
              notes: null,
              balanceMinor: 400_000,
              archived: false,
            },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/supplier-returns': () => ({
        status: 200,
        body: {
          items: listed
            ? [
                {
                  id: 'r-1',
                  number: 'PRT-2026-000001',
                  date: '2026-11-03',
                  supplierName: 'معمل الأمل',
                  refund: 'credit',
                  pieces: 3000,
                  amountMinor: 120_000,
                },
              ]
            : [],
        },
      }),
      [`GET ${productsPath({ q: 'فستان' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'فستان', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'فستان',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [], barcodes: [] }],
        },
      },
      'POST /v1/supplier-returns': (r: MockRequest) => {
        expect(r.body).toMatchObject({
          supplierId: 's-1',
          refund: 'credit',
          note: 'عيب في الصنع',
          lines: [{ variantId: 'v-1', qty: 3000, amountMinor: null }],
        });
        listed = true;
        return {
          status: 201,
          body: {
            id: 'r-1',
            number: 'PRT-2026-000001',
            date: '2026-11-03',
            supplierId: 's-1',
            supplierName: 'معمل الأمل',
            branchId: 'b-1',
            refund: 'credit',
            reference: null,
            lines: [],
            amountMinor: 120_000,
            costMinor: 120_000,
            baseCurrency: 'SYP',
          } satisfies SupplierReturnDetail,
        };
      },
    });
    const { user } = renderApp('/supplier-returns');
    await user.click(await screen.findByRole('button', { name: 'مرتجع جديد' }));
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.type(screen.getByLabelText('السبب (اختياري)'), 'عيب في الصنع');
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'فستان');
    await user.click(await screen.findByRole('button', { name: 'فستان' }));
    await user.type(await screen.findByLabelText('كمية فستان'), '3');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    expect(await screen.findByText(/سُجّل المرتجع PRT-2026-000001/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/supplier-returns')).toHaveLength(1);
    const table = await screen.findByRole('table', { name: 'المرتجعات إلى الموردين' });
    expect(await within(table).findByText('تنقص من دينك له')).toBeInTheDocument();
  });

  it('lets the line name the batch it sends back, and sends it with the number and expiry', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': {
        status: 200,
        body: {
          items: [
            { id: 's-1', name: 'معمل الأمل', phone: null, notes: null, balanceMinor: 0, archived: false },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/supplier-returns': { status: 200, body: { items: [] } },
      [`GET ${productsPath({ q: 'مصل' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'مصل', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'مصل',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [], barcodes: [] }],
        },
      },
      'GET /v1/inventory/expiry?days=3650&variantId=v-1&branchId=branch-1': {
        status: 200,
        body: {
          today: '2026-10-30',
          items: ['SY-117', 'SY-118'].map((batchNo, i) => ({
            variantId: 'v-1',
            name: 'مصل',
            branchId: 'branch-1',
            branchName: 'الفرع الرئيسي',
            batchNo,
            expiryDate: `2027-0${i + 1}-01`,
            purchaseNumber: 'PUR-1',
            supplierId: 's-1',
            supplierName: 'معمل الأمل',
            receivedOn: '2026-10-01',
            qty: 5000,
            daysLeft: 100,
            blocked: false,
            blockReason: null,
          })),
        },
      },
      'POST /v1/supplier-returns': {
        status: 201,
        body: { id: 'r-1', number: 'PRT-1', amountMinor: 0, refund: 'credit' },
      },
    });
    const { user } = renderApp('/supplier-returns');
    await user.click(await screen.findByRole('button', { name: 'مرتجع جديد' }));
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'مصل');
    await user.click(await screen.findByRole('button', { name: 'مصل' }));
    await user.type(await screen.findByLabelText('كمية مصل'), '5');
    await user.selectOptions(await screen.findByLabelText('الدفعة'), 'SY-118|2027-02-01');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByText(/سُجّل المرتجع PRT-1/);
    expect(requestsTo('POST', '/v1/supplier-returns')[0]?.body).toMatchObject({
      lines: [{ variantId: 'v-1', qty: 5000, batchNo: 'SY-118', expiryDate: '2027-02-01' }],
    });
  });

  it('starts the batch box on the batch of the latest purchase from this supplier', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': {
        status: 200,
        body: {
          items: [
            { id: 's-1', name: 'معمل الأمل', phone: null, notes: null, balanceMinor: 0, archived: false },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/supplier-returns': { status: 200, body: { items: [] } },
      'GET /v1/purchases?limit=100&supplierId=s-1': {
        status: 200,
        body: {
          items: [
            {
              id: 'pu-1',
              number: 'PUR-1',
              date: '2026-10-01',
              supplierId: 's-1',
              supplierName: 'معمل الأمل',
            },
            {
              id: 'pu-2',
              number: 'PUR-2',
              date: '2026-11-01',
              supplierId: 's-1',
              supplierName: 'معمل الأمل',
            },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/purchases/pu-2': {
        status: 200,
        body: {
          id: 'pu-2',
          lines: [{ variantId: 'v-1', batchNo: 'SY-118', expiryDate: '2027-02-01', qty: 5000 }],
        },
      },
      'GET /v1/purchases/pu-1': {
        status: 200,
        body: {
          id: 'pu-1',
          lines: [{ variantId: 'v-1', batchNo: 'SY-117', expiryDate: '2027-01-01', qty: 5000 }],
        },
      },
      [`GET ${productsPath({ q: 'مصل' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'مصل', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'مصل',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [], barcodes: [] }],
        },
      },
      'GET /v1/inventory/expiry?days=3650&variantId=v-1&branchId=branch-1': {
        status: 200,
        body: {
          today: '2026-10-30',
          items: ['SY-117', 'SY-118'].map((batchNo, i) => ({
            variantId: 'v-1',
            name: 'مصل',
            branchId: 'branch-1',
            branchName: 'الفرع الرئيسي',
            batchNo,
            expiryDate: `2027-0${i + 1}-01`,
            purchaseNumber: 'PUR-1',
            supplierId: 's-1',
            supplierName: 'معمل الأمل',
            receivedOn: '2026-10-01',
            qty: 5000,
            daysLeft: 100,
            blocked: false,
            blockReason: null,
          })),
        },
      },
      'POST /v1/supplier-returns': {
        status: 201,
        body: { id: 'r-1', number: 'PRT-1', amountMinor: 0, refund: 'credit' },
      },
    });
    const { user } = renderApp('/supplier-returns');
    await user.click(await screen.findByRole('button', { name: 'مرتجع جديد' }));
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'مصل');
    await user.click(await screen.findByRole('button', { name: 'مصل' }));
    await user.type(await screen.findByLabelText('كمية مصل'), '5');
    await waitFor(() => expect(screen.getByLabelText('الدفعة')).toHaveValue('SY-118|2027-02-01'));
    expect(screen.getByText('من آخر شراء PUR-2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    await screen.findByText(/سُجّل المرتجع PRT-1/);
    expect(requestsTo('POST', '/v1/supplier-returns')[0]?.body).toMatchObject({
      lines: [{ variantId: 'v-1', batchNo: 'SY-118', expiryDate: '2027-02-01' }],
    });
  });

  it('shows the real reason in the banner, and groups the amount while it is typed', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': {
        status: 200,
        body: {
          items: [
            { id: 's-1', name: 'معمل الأمل', phone: null, notes: null, balanceMinor: 0, archived: false },
          ],
          baseCurrency: 'SYP',
        },
      },
      'GET /v1/supplier-returns': { status: 200, body: { items: [] } },
      [`GET ${productsPath({ q: 'مصل' })}`]: {
        status: 200,
        body: { items: [{ id: 'p-1', nameAr: 'مصل', type: 'stock' }], nextCursor: null },
      },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'مصل',
          variants: [{ id: 'v-1', label: null, archivedAt: null, attributes: [], barcodes: [] }],
        },
      },
      'POST /v1/supplier-returns': {
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'تحقّق من الحقول المظلّلة.',
            fields: { 'lines.0.serials': 'الرقم ABC-1 ليس عندنا في المخزون.' },
          },
        },
      },
    });
    const { user } = renderApp('/supplier-returns');
    await user.click(await screen.findByRole('button', { name: 'مرتجع جديد' }));
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'مصل');
    await user.click(await screen.findByRole('button', { name: 'مصل' }));
    await user.type(await screen.findByLabelText('كمية مصل'), '5');
    const amount = screen.getByLabelText('مبلغ مصل');
    await user.type(amount, '100000');
    expect(amount).toHaveValue('100,000');
    await user.click(screen.getByRole('button', { name: 'سجّل المرتجع' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('الرقم ABC-1 ليس عندنا في المخزون.');
    expect(alert).not.toHaveTextContent('تحقّق من الحقول المظلّلة');
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    'shows the serial field at once, and only for a product that tracks them (%s)',
    async (tracks, count) => {
      mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': { status: 200, body: buyer() },
        'GET /v1/suppliers': {
          status: 200,
          body: {
            items: [
              { id: 's-1', name: 'معمل الأمل', phone: null, notes: null, balanceMinor: 0, archived: false },
            ],
            baseCurrency: 'SYP',
          },
        },
        'GET /v1/supplier-returns': { status: 200, body: { items: [] } },
        [`GET ${productsPath({ q: 'جهاز' })}`]: {
          status: 200,
          body: { items: [{ id: 'p-9', nameAr: 'جهاز ضغط', type: 'stock' }], nextCursor: null },
        },
        'GET /v1/products/p-9': {
          status: 200,
          body: {
            id: 'p-9',
            nameAr: 'جهاز ضغط',
            tracksSerial: tracks,
            variants: [{ id: 'v-9', label: null, archivedAt: null, attributes: [], barcodes: [] }],
          },
        },
      });
      const { user } = renderApp('/supplier-returns');
      await user.click(await screen.findByRole('button', { name: 'مرتجع جديد' }));
      await screen.findByRole('option', { name: 'معمل الأمل' });
      await user.type(screen.getByLabelText('أضف صنفاً بالاسم أو الباركود'), 'جهاز');
      await user.click(await screen.findByRole('button', { name: 'جهاز ضغط' }));
      await screen.findByLabelText('كمية جهاز ضغط');
      expect(screen.queryAllByLabelText('أرقام جهاز ضغط')).toHaveLength(count);
    },
  );
});
