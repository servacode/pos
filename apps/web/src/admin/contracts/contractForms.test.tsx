import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContractPrice, MaintenanceContract, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

function manager(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    tenant: { ...base.tenant, sectors: ['medical_supplies'] },
    user: { ...base.user, permissions: [...base.user.permissions, 'catalog.manage', 'customers.view'] },
  };
}

const made = { id: 'm-1', number: 'MC-000001' } as MaintenanceContract;

const customers = {
  items: [
    {
      id: 'c-1',
      name: 'مشفى الأمل',
      phone: '0944555666',
      creditLimitMinor: null,
      balanceMinor: 0,
      priceTier: 'retail',
      noMessages: false,
      archived: false,
      kind: 'hospital',
      contactName: null,
      contactPhone: null,
    },
  ],
  totalOwedMinor: 0,
  baseCurrency: 'SYP',
};

describe('a new maintenance contract', () => {
  it('needs a customer record, picks one, and sends its id; the days are day-first fields', async () => {
    let sent: unknown = null;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/maintenance?view=upcoming': () => ({ status: 200, body: { items: [] } }),
      'GET /v1/customers?q=%D9%85%D8%B4': () => ({ status: 200, body: customers }),
      'POST /v1/maintenance': (r: MockRequest) => {
        sent = r.body;
        return { status: 201, body: made };
      },
    });
    const { user } = renderApp('/maintenance');
    await user.click(await screen.findByRole('button', { name: 'عقد جديد' }));
    expect(await screen.findAllByPlaceholderText('يوم/شهر/سنة')).toHaveLength(2);
    await user.type(screen.getByLabelText(/الأجهزة/), 'OX-1');
    await user.click(screen.getByRole('button', { name: 'أضف العقد' }));
    expect(await screen.findByText(/اختر الزبون/)).toBeInTheDocument();
    expect(sent).toBeNull();

    await user.type(screen.getByLabelText(/ابحث بالاسم أو الجوال/), 'مش');
    await user.click(await screen.findByRole('button', { name: /مشفى الأمل/ }));
    await user.click(screen.getByRole('button', { name: 'أضف العقد' }));
    await vi.waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toMatchObject({
      customerId: 'c-1',
      customerName: 'مشفى الأمل',
      devices: [{ serial: 'OX-1' }],
    });
  });

  it('adds a new customer on the spot and ties the contract to it', async () => {
    let sent: unknown = null;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/maintenance?view=upcoming': () => ({ status: 200, body: { items: [] } }),
      'POST /v1/customers': () => ({
        status: 201,
        body: { id: 'c-9', name: 'عيادة الرحمة', phone: '0933111222' },
      }),
      'POST /v1/maintenance': (r: MockRequest) => {
        sent = r.body;
        return { status: 201, body: made };
      },
    });
    const { user } = renderApp('/maintenance');
    await user.click(await screen.findByRole('button', { name: 'عقد جديد' }));
    await user.click(await screen.findByRole('button', { name: 'زبون جديد' }));
    await user.type(screen.getByLabelText('اسم الزبون الجديد'), 'عيادة الرحمة');
    await user.type(screen.getByLabelText('الجوال (اختياري)'), '0933111222');
    await user.click(screen.getByRole('button', { name: 'أضف الزبون' }));
    expect(await screen.findByText('عيادة الرحمة')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/الأجهزة/), 'OX-2');
    await user.click(screen.getByRole('button', { name: 'أضف العقد' }));
    await vi.waitFor(() => expect(sent).not.toBeNull());
    expect(sent).toMatchObject({ customerId: 'c-9', customerPhone: '0933111222' });
  });

  it("shows the store's refusal of a serial it does not know", async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/maintenance?view=upcoming': () => ({ status: 200, body: { items: [] } }),
      'GET /v1/customers?q=%D9%85%D8%B4': () => ({ status: 200, body: customers }),
      'POST /v1/maintenance': () => ({
        status: 400,
        body: {
          error: {
            code: 'validation_failed',
            message: 'تحقّق من الحقول المظلّلة.',
            fields: { devices: 'الرقم التسلسلي XX-1 غير موجود في المحل. تأكد من الرقم أو من الفاتورة.' },
          },
        },
      }),
    });
    const { user } = renderApp('/maintenance');
    await user.click(await screen.findByRole('button', { name: 'عقد جديد' }));
    await user.type(screen.getByLabelText(/ابحث بالاسم أو الجوال/), 'مش');
    await user.click(await screen.findByRole('button', { name: /مشفى الأمل/ }));
    await user.type(screen.getByLabelText(/الأجهزة/), 'XX-1');
    await user.click(screen.getByRole('button', { name: 'أضف العقد' }));
    expect(await screen.findByText(/غير موجود في المحل/)).toBeInTheDocument();
  });
});

describe('the contract prices page', () => {
  it('prints a price list for a type of customer, and asks before deleting a price', async () => {
    const prices: ContractPrice[] = [
      {
        id: 'p-1',
        customerId: null,
        customerName: null,
        customerKind: 'hospital',
        variantId: 'v-1',
        item: 'كرسي متحرك',
        currency: 'SYP',
        priceMinor: 1_800_000,
        validFrom: '2026-01-01',
        validTo: null,
        note: null,
        version: 1,
      },
    ];
    let deleted = false;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: manager() }),
      'GET /v1/customers': () => ({
        status: 200,
        body: { items: [], totalOwedMinor: 0, baseCurrency: 'SYP' },
      }),
      'GET /v1/contract-prices': () => ({ status: 200, body: { items: prices } }),
      'DELETE /v1/contract-prices/p-1': () => {
        deleted = true;
        return { status: 204, body: null };
      },
      'GET /v1/contract-prices/price-list?kind=hospital&tier=wholesale': () => ({
        status: 200,
        body: {
          forName: 'مشفى',
          tier: 'wholesale',
          currency: 'SYP',
          asOf: '2026-11-14',
          rows: [
            { variantId: 'v-1', item: 'مكثف أكسجين', sku: 'OX', priceMinor: 1_800_000, source: 'contract' },
            { variantId: 'v-2', item: 'جهاز ضغط', sku: null, priceMinor: 450_000, source: 'wholesale' },
          ],
        },
      }),
    });
    const { user } = renderApp('/contract-prices');
    await screen.findAllByText('كرسي متحرك');
    await user.selectOptions(screen.getByLabelText('لمن القائمة'), 'k:hospital');
    await user.selectOptions(screen.getByLabelText('السعر الأساسي'), 'wholesale');
    await user.click(screen.getByRole('button', { name: 'اعرض القائمة' }));
    const sheet = await screen.findByRole('table', { name: 'قائمة الأسعار' });
    expect(within(sheet).getByText('جهاز ضغط')).toBeInTheDocument();
    expect(within(sheet).getByText('سعر عقد')).toBeInTheDocument();
    expect(within(sheet).getByText('سعر الجملة')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اطبع' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حمّل CSV' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'احذف سعر كرسي متحرك' }));
    const sure = await screen.findByRole('dialog');
    expect(deleted).toBe(false);
    await user.click(within(sure).getByRole('button', { name: 'احذف السعر' }));
    await vi.waitFor(() => expect(deleted).toBe(true));
  });
});
