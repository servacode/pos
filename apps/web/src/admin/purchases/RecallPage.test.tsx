import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, RecallResponse } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

const found = (blocked: boolean): RecallResponse => ({
  batchNo: 'C-09',
  batches: [
    {
      variantId: 'v-1',
      name: 'بانادول 500',
      batchNo: 'C-09',
      expiryDate: '2027-03-01',
      blocked,
      blockReason: blocked ? 'سحب' : null,
      receipts: [
        { purchaseNumber: 'PUR-0003', supplierName: 'مستودع الشفاء', receivedOn: '2026-10-20', qty: 20_000 },
      ],
      branches: [{ branchId: 'br-1', branchName: 'الفرع الرئيسي', qty: 17_000 }],
      soldQty: 3_000,
    },
  ],
  sales: [
    {
      invoiceId: 'i-1',
      invoiceNumber: 'INV-0001',
      date: '2026-10-29',
      branchName: 'الفرع الرئيسي',
      variantId: 'v-1',
      name: 'بانادول 500',
      qty: 2_000,
      customerName: 'مستشفى الأمل',
      customerPhone: '0955123456',
    },
    {
      invoiceId: 'i-2',
      invoiceNumber: 'INV-0002',
      date: '2026-10-30',
      branchName: 'الفرع الرئيسي',
      variantId: 'v-1',
      name: 'بانادول 500',
      qty: 1_000,
      customerName: null,
      customerPhone: null,
    },
  ],
});

describe('«سحب دفعة»', () => {
  it('finds a batch by its number: its product, supplier, what is left and who bought it', async () => {
    let blocked = false;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/batches/recall?batchNo=C-09': () => ({ status: 200, body: found(blocked) }),
      'POST /v1/batches/block': () => {
        blocked = true;
        return { status: 200, body: { count: 1 } };
      },
    });
    const { user } = renderApp('/recall');
    await user.type(await screen.findByLabelText('رقم الدفعة'), 'C-09');
    await user.click(screen.getByRole('button', { name: 'ابحث' }));
    const batch = await screen.findByRole('table', { name: 'الدفعة وأصلها' });
    expect(batch).toHaveTextContent('بانادول 500');
    expect(batch).toHaveTextContent('مستودع الشفاء');
    expect(batch).toHaveTextContent('PUR-0003');
    expect(batch).toHaveTextContent('الفرع الرئيسي');
    const sales = await screen.findByRole('table', { name: 'فواتير الدفعة' });
    expect(sales).toHaveTextContent('INV-0001');
    expect(sales).toHaveTextContent('مستشفى الأمل');
    expect(sales).toHaveTextContent('0955123456');
    expect(sales).toHaveTextContent('INV-0002');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'أوقف بيعها في كل الفروع' }));
    // Blocking waits for a confirmation: nothing is sent before it
    const sure = await screen.findByRole('dialog');
    expect(requestsTo('POST', '/v1/batches/block')).toHaveLength(0);
    await user.click(within(sure).getByRole('button', { name: 'أوقف البيع' }));
    expect(await screen.findByText(/أُوقف بيع الدفعة C-09 في كل الفروع/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/batches/block').at(-1)?.body).toEqual({ batchNo: 'C-09' });
    expect(await screen.findByRole('button', { name: 'ارفع الإيقاف' })).toBeInTheDocument();
  });

  it('offers the batches the stores hold to pick from, and asks before lifting a stop without resetting the page', async () => {
    let blocked = true;
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory/expiry?days=730': () => ({
        status: 200,
        body: {
          today: '2026-11-14',
          items: [
            {
              variantId: 'v-1',
              name: 'بانادول 500',
              branchId: 'br-1',
              branchName: 'الفرع الرئيسي',
              batchNo: 'C-09',
              expiryDate: '2027-03-01',
              purchaseNumber: null,
              supplierId: null,
              supplierName: null,
              receivedOn: null,
              qty: 17_000,
              daysLeft: 107,
              blocked: true,
              blockReason: null,
            },
          ],
        },
      }),
      'GET /v1/batches/recall?batchNo=C-09': () => ({ status: 200, body: found(blocked) }),
      'POST /v1/batches/unblock': () => {
        blocked = false;
        return { status: 200, body: { count: 1 } };
      },
    });
    const { user } = renderApp('/recall');
    const list = await screen.findByRole('list', { name: 'دفعات مقترحة' });
    await user.click(within(list).getByRole('button', { name: /C-09/ }));
    await screen.findByRole('table', { name: 'الدفعة وأصلها' });
    expect(screen.getByLabelText('رقم الدفعة')).toHaveValue('C-09');

    await user.click(screen.getByRole('button', { name: 'ارفع الإيقاف' }));
    const sure = await screen.findByRole('dialog');
    expect(requestsTo('POST', '/v1/batches/unblock')).toHaveLength(0);
    await user.click(within(sure).getByRole('button', { name: 'ارفع الإيقاف' }));
    expect(await screen.findByText('رُفع الإيقاف عن الدفعة C-09.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/batches/unblock')).toHaveLength(1);
    // The page stays: the batch and its tables are still there
    expect(screen.getByRole('table', { name: 'الدفعة وأصلها' })).toBeInTheDocument();
    expect(screen.getByLabelText('رقم الدفعة')).toHaveValue('C-09');
  });

  it('prints and downloads the list of invoices', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/batches/recall?batchNo=C-09': () => ({ status: 200, body: found(false) }),
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const create = vi.fn(() => 'blob:x');
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = renderApp('/recall');
    await user.type(await screen.findByLabelText('رقم الدفعة'), 'C-09{Enter}');
    await screen.findByRole('table', { name: 'فواتير الدفعة' });
    await user.click(screen.getByRole('button', { name: 'اطبع' }));
    expect(print).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'حمّل CSV' }));
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    print.mockRestore();
    click.mockRestore();
  });

  it('says so when no batch has that number, or when the search fails', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/batches/recall?batchNo=ZZ-9': () => ({
        status: 200,
        body: { batchNo: 'ZZ-9', batches: [], sales: [] },
      }),
      'GET /v1/batches/recall?batchNo=ERR': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'تعذّر البحث.' } },
      }),
    });
    const { user } = renderApp('/recall');
    const field = await screen.findByLabelText('رقم الدفعة');
    await user.type(field, 'ZZ-9{Enter}');
    expect(await screen.findByText('لا دفعة بالرقم ZZ-9.')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'ERR{Enter}');
    expect(await within(document.body).findByText('تعذّر البحث.')).toBeInTheDocument();
  });
});
