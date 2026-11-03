import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformPayment } from '@serva/core';
import { mockFetch } from '../test/fetchMock';
import { renderApp } from '../test/renderApp';

afterEach(() => sessionStorage.clear());

const payment: PlatformPayment = {
  id: 'pay-1',
  tenantId: 't-1',
  storeName: 'سوبرماركت الفرات',
  number: 'SBP-2026-000001',
  invoiceNumber: 'SUB-2026-000001',
  planName: 'الأساسية',
  billingCycle: 'monthly',
  method: 'shamcash',
  transactionRef: 'SC-1',
  amountMinor: 13_000_000,
  currency: 'SYP',
  invoiceUsdMinor: 1000,
  invoiceSypMinor: 13_000_000,
  status: 'pending',
  submittedAt: '2026-10-30T09:00:00.000Z',
  reason: null,
};

describe('the platform panel', () => {
  it('signs in with email and password, and confirms a payment waiting for it', async () => {
    let confirmed = false;
    const { requestsTo } = mockFetch({
      'POST /v1/platform/login': () => ({
        status: 200,
        body: {
          token: 'pt',
          expiresAt: '2026-10-30T17:00:00.000Z',
          user: { id: 'a', fullName: 'مدير', role: 'super_admin' },
        },
      }),
      'GET /v1/platform/payments?status=pending': () => ({
        status: 200,
        body: { items: confirmed ? [] : [payment] },
      }),
      'POST /v1/platform/payments/pay-1/confirm': () => {
        confirmed = true;
        return { status: 204 };
      },
    });
    const { user } = renderApp('/platform');
    expect(await screen.findByRole('heading', { name: 'لوحة المنصة', level: 1 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'admin@serva.test');
    await user.type(screen.getByLabelText('كلمة السر'), 'platform-pass-1');
    await user.click(screen.getByRole('button', { name: 'ادخل' }));
    expect(await screen.findByText('سوبرماركت الفرات')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أكّد' }));
    expect(await screen.findByText('لا دفعات هنا.')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/platform/payments/pay-1/confirm')[0]?.headers.Authorization).toBe(
      'Bearer pt',
    );
  });
});
