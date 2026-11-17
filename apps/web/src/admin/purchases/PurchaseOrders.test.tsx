import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, PurchaseOrderDetail, PurchaseOrderSuggestion } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function buyer(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

const SUPPLIER = {
  id: 's-1',
  name: 'معمل الأمل',
  phone: '0944111222',
  notes: null,
  balanceMinor: 0,
  archived: false,
};
const SUPPLIERS = { status: 200, body: { items: [SUPPLIER], totalOwedMinor: 0, baseCurrency: 'SYP' } };

const ORDER: PurchaseOrderDetail = {
  id: 'o-1',
  number: 'PO-2026-000001',
  status: 'sent',
  date: '2026-11-10',
  supplierId: 's-1',
  supplierName: 'معمل الأمل',
  supplierPhone: '0944111222',
  expectedDate: '2026-11-20',
  totalMinor: 140_000,
  orderedQty: 14_000,
  receivedQty: 6_000,
  version: 2,
  branchId: 'b-1',
  notes: null,
  baseCurrency: 'SYP',
  createdAt: '2026-11-10T08:00:00.000Z',
  receipts: [{ purchaseId: 'p-9', number: 'PUR-2026-000009', date: '2026-11-12' }],
  lines: [
    {
      lineNo: 1,
      variantId: 'v-1',
      productId: 'p-1',
      name: 'قفازات',
      qty: 10_000,
      costMinor: 100_000,
      unitCostMinor: 10_000,
      receivedQty: 6_000,
    },
    {
      lineNo: 2,
      variantId: 'v-2',
      productId: 'p-2',
      name: 'كمامات',
      qty: 4_000,
      costMinor: 40_000,
      unitCostMinor: 10_000,
      receivedQty: 0,
    },
  ],
};

describe('«طلبيات الشراء»', () => {
  it('lists the orders with their status and how much arrived', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/purchase-orders': { status: 200, body: { items: [ORDER] } },
    });
    renderApp('/purchase-orders');
    const table = await screen.findByRole('table', { name: 'طلبيات الشراء' });
    expect(within(table).getAllByText('PO-2026-000001').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('مُرسلة').length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/6/).length).toBeGreaterThan(0);
  });

  it('suggests what is short for the supplier, lets the owner change it, and saves a draft', async () => {
    const suggestion: PurchaseOrderSuggestion = {
      periodDays: 30,
      coverDays: 14,
      baseCurrency: 'SYP',
      alreadyOrdered: [],
      items: [
        {
          variantId: 'v-1',
          productId: 'p-1',
          name: 'قفازات',
          stockQty: 2000,
          minStockQty: 5000,
          soldQty: 8000,
          onOrderQty: 0,
          suggestedQty: 3000,
          costMinor: 30_000,
          unitCostMinor: 10_000,
          costDoubtful: false,
          priceMinor: null,
          productName: 'قفازات',
          attributes: [],
          reason: 'below_min',
          lastSupplierId: 's-1',
        },
      ],
    };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': SUPPLIERS,
      'GET /v1/purchase-orders/suggest?supplierId=s-1': { status: 200, body: suggestion },
      'POST /v1/purchase-orders': (r: MockRequest) => {
        expect(r.body).toMatchObject({
          supplierId: 's-1',
          lines: [{ variantId: 'v-1', qty: 5000, costMinor: 50_000, unitCostMinor: 10_000 }],
        });
        return { status: 201, body: ORDER };
      },
      'GET /v1/purchase-orders/o-1': { status: 200, body: ORDER },
      'GET /v1/store': { status: 200, body: { name: 'متجري', taxNumber: null, address: null, phone: null } },
    });
    const { user } = renderApp('/purchase-orders/new');
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.click(screen.getByRole('button', { name: 'اقترح طلبية' }));
    expect(await screen.findByText('تحت الحد الأدنى')).toBeInTheDocument();
    const qty = screen.getByLabelText('كمية قفازات');
    expect(qty).toHaveValue('3');
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: 'احفظ كمسودة' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/purchase-orders')).toHaveLength(1));
    expect(await screen.findByText('الاستلام')).toBeInTheDocument();
  });

  it("sends on WhatsApp to the supplier's 963 number, marking a draft sent", async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const draft = { ...ORDER, status: 'draft' as const, receivedQty: 0, receipts: [] };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/purchase-orders/o-1': { status: 200, body: draft },
      'GET /v1/store': { status: 200, body: { name: 'متجري', taxNumber: null, address: null, phone: null } },
      'POST /v1/purchase-orders/o-1/status': (r: MockRequest) => {
        expect(r.body).toEqual({ status: 'sent', version: 2 });
        return { status: 200, body: { ...draft, status: 'sent', version: 3 } };
      },
    });
    const { user } = renderApp('/purchase-orders/o-1');
    await user.click(await screen.findByRole('button', { name: 'أرسلها على واتساب' }));
    expect(open).toHaveBeenCalledTimes(1);
    // Marked sent only after the owner says the message went
    expect(await screen.findByText('هل أُرسلت الطلبية؟')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchase-orders/o-1/status')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'نعم، أُرسلت' }));
    const link = String(open.mock.calls[0]![0]);
    expect(link).toMatch(/^https:\/\/wa\.me\/963944111222\?text=/);
    expect(decodeURIComponent(link)).toContain('PO-2026-000001');
    await waitFor(() => expect(requestsTo('POST', '/v1/purchase-orders/o-1/status')).toHaveLength(1));
    expect(await screen.findByText('عُلّمت الطلبية مُرسلة.')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("receives from an order: a purchase filled with what is still owed, sent with the order's id", async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/purchase-orders/o-1': { status: 200, body: ORDER },
      'GET /v1/store': { status: 200, body: { name: 'متجري', taxNumber: null, address: null, phone: null } },
      'GET /v1/suppliers': SUPPLIERS,
      'GET /v1/purchases': { status: 200, body: { items: [] } },
      'GET /v1/inventory': { status: 200, body: { items: [], totals: [] } },
      'GET /v1/products/p-1': {
        status: 200,
        body: {
          id: 'p-1',
          nameAr: 'قفازات',
          variants: [
            { id: 'v-1', label: null, barcodes: [], price: { currency: 'SYP', priceMinor: 12_000 } },
          ],
        },
      },
      'GET /v1/products/p-2': {
        status: 200,
        body: {
          id: 'p-2',
          nameAr: 'كمامات',
          variants: [
            { id: 'v-2', label: null, barcodes: [], price: { currency: 'SYP', priceMinor: 12_000 } },
          ],
        },
      },
      'POST /v1/purchases': (r: MockRequest) => {
        expect(r.body).toMatchObject({
          supplierId: 's-1',
          purchaseOrderId: 'o-1',
          lines: [
            { variantId: 'v-1', qty: 4000, costMinor: 40_000 },
            { variantId: 'v-2', qty: 4000, costMinor: 40_000 },
          ],
        });
        return {
          status: 201,
          body: {
            id: 'p-10',
            number: 'PUR-2026-000010',
            date: '2026-11-16',
            supplierId: 's-1',
            supplierName: 'معمل الأمل',
            payment: 'credit',
            reference: null,
            totalMinor: 80_000,
            branchId: 'b-1',
            notes: null,
            lines: [],
            baseCurrency: 'SYP',
          },
        };
      },
    });
    const { user } = renderApp('/purchase-orders/o-1');
    await user.click(await screen.findByRole('button', { name: 'استلم البضاعة' }));
    expect(await screen.findByText(/استلام من الطلبية/)).toBeInTheDocument();
    // What is left: 4 of the gloves (10 - 6) and all 4 masks, at the order's price per piece
    expect(await screen.findByLabelText('كمية قفازات')).toHaveValue('4');
    expect(screen.getByLabelText('كمية كمامات')).toHaveValue('4');
    await user.click(screen.getByRole('button', { name: /سجّل الفاتورة/ }));
    expect(await screen.findByText(/سُجّلت الفاتورة PUR-2026-000010/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases')).toHaveLength(1);
  });

  it('does not mark a draft sent when the owner says the message did not go', async () => {
    vi.stubGlobal('open', vi.fn());
    const draft = { ...ORDER, status: 'draft' as const, receivedQty: 0, receipts: [] };
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/purchase-orders/o-1': { status: 200, body: draft },
      'GET /v1/store': { status: 200, body: { name: 'متجري', taxNumber: null, address: null, phone: null } },
    });
    const { user } = renderApp('/purchase-orders/o-1');
    await user.click(await screen.findByRole('button', { name: 'أرسلها على واتساب' }));
    await user.click(await screen.findByRole('button', { name: 'لا' }));
    expect(requestsTo('POST', '/v1/purchase-orders/o-1/status')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('asks before closing an order with what arrived, and counts the lines received', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/purchase-orders/o-1': { status: 200, body: { ...ORDER, status: 'partial' } },
      'GET /v1/store': { status: 200, body: { name: 'متجري', taxNumber: null, address: null, phone: null } },
      'POST /v1/purchase-orders/o-1/status': {
        status: 200,
        body: { ...ORDER, status: 'received', version: 3 },
      },
    });
    const { user } = renderApp('/purchase-orders/o-1');
    expect(await screen.findByText(/أسطر/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'أغلقها بما وصل' }));
    expect(requestsTo('POST', '/v1/purchase-orders/o-1/status')).toHaveLength(0);
    await user.click(await screen.findByRole('button', { name: 'نعم، أغلقها' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/purchase-orders/o-1/status')).toHaveLength(1));
    expect(await screen.findByText('أُغلقت الطلبية ناقصة بما وصل.')).toBeInTheDocument();
  });

  it('tells which waiting order already owes the short items', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/suppliers': SUPPLIERS,
      'GET /v1/purchase-orders/suggest?supplierId=s-1': {
        status: 200,
        body: {
          periodDays: 30,
          coverDays: 14,
          baseCurrency: 'SYP',
          items: [],
          alreadyOrdered: [
            { variantId: 'v-1', name: 'قفازات', onOrderQty: 5000, orderNumbers: ['PO-2026-000001'] },
            { variantId: 'v-2', name: 'كمامات', onOrderQty: 2000, orderNumbers: ['PO-2026-000001'] },
          ],
        },
      },
    });
    const { user } = renderApp('/purchase-orders/new');
    await screen.findByRole('option', { name: 'معمل الأمل' });
    await user.click(screen.getByRole('button', { name: 'اقترح طلبية' }));
    expect(await screen.findByText(/أصناف مطلوبة أصلاً في PO-2026-000001/)).toBeInTheDocument();
  });

  it('keeps the order unit cost when receiving: a changed quantity moves the total, a zero line is dropped', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: buyer() },
      'GET /v1/purchase-orders/o-1': { status: 200, body: ORDER },
      'GET /v1/store': { status: 200, body: { name: 'متجري', taxNumber: null, address: null, phone: null } },
      'GET /v1/suppliers': SUPPLIERS,
      'GET /v1/purchases': { status: 200, body: { items: [] } },
      'GET /v1/inventory': { status: 200, body: { items: [], totals: [] } },
      'POST /v1/purchases': (r: MockRequest) => {
        expect(r.body).toMatchObject({ lines: [{ variantId: 'v-1', qty: 2500, costMinor: 25_000 }] });
        expect((r.body as { lines: unknown[] }).lines).toHaveLength(1);
        return {
          status: 201,
          body: {
            id: 'p-11',
            number: 'PUR-2026-000011',
            date: '2026-11-16',
            supplierId: 's-1',
            supplierName: 'معمل الأمل',
            payment: 'credit',
            reference: null,
            totalMinor: 25_000,
            branchId: 'b-1',
            notes: null,
            lines: [],
            baseCurrency: 'SYP',
          },
        };
      },
    });
    const { user } = renderApp('/purchase-orders/o-1');
    await user.click(await screen.findByRole('button', { name: 'استلم البضاعة' }));
    const qty = await screen.findByLabelText('كمية قفازات');
    await user.clear(qty);
    await user.type(qty, '2.5');
    expect(screen.getByLabelText('كلفة قفازات')).toHaveValue('250');
    const masks = screen.getByLabelText('كمية كمامات');
    await user.clear(masks);
    await user.type(masks, '0');
    await user.click(screen.getByRole('button', { name: /سجّل الفاتورة/ }));
    expect(await screen.findByText(/سُجّلت الفاتورة PUR-2026-000011/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/purchases')).toHaveLength(1);
  });
});
