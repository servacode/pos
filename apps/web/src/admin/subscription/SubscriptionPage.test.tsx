import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, SubscriptionInvoice, SubscriptionPage } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

const owner = (): MeResponse => {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'subscription.manage'] } };
};

const invoice: SubscriptionInvoice = {
  id: 'inv-1',
  number: 'SUB-2026-000001',
  planCode: 'basic',
  planName: 'الأساسية',
  billingCycle: 'yearly',
  usdMinor: 10000,
  sypMinor: 130_000_000,
  status: 'open',
  createdAt: '2026-10-30T09:00:00.000Z',
};

function page(over: Partial<SubscriptionPage> = {}): SubscriptionPage {
  return {
    status: 'trialing',
    planCode: 'free',
    planName: 'الباقة المجانية',
    billingCycle: null,
    trialEndsAt: '2026-11-29T09:00:00.000Z',
    currentPeriodEnd: '2026-11-29T09:00:00.000Z',
    graceEndsAt: null,
    plans: [
      {
        code: 'basic',
        name: 'الأساسية',
        isFree: false,
        priceMonthlyMinor: 1000,
        priceYearlyMinor: 10000,
        trialDays: null,
        isActive: true,
        limits: {},
      },
    ],
    invoices: [],
    payments: [],
    paymentMethods: [
      {
        key: 'shamcash',
        label: 'شام كاش',
        account: '0991234567',
        beneficiary: 'شركة سيرفا',
        instructions: 'اكتب رقم الفاتورة في الملاحظة',
        enabled: true,
      },
    ],
    sypPerUsd: '13000',
    ...over,
  };
}

describe('«الاشتراك»', () => {
  it('chooses a yearly plan, shows the invoice and how to pay, and reports the payment', async () => {
    let current = page();
    const { user, requestsTo } = (() => {
      const mock = mockFetch({
        'POST /v1/auth/refresh': signedInRefresh,
        'GET /v1/me': () => ({ status: 200, body: owner() }),
        'GET /v1/subscription': () => ({ status: 200, body: current }),
        'POST /v1/subscription/invoices': () => {
          current = { ...current, invoices: [invoice] };
          return { status: 201, body: invoice };
        },
        'POST /v1/subscription/payments': (r: MockRequest) => {
          current = {
            ...current,
            graceEndsAt: '2026-11-02T09:00:00.000Z',
            payments: [
              {
                id: 'p-1',
                number: 'SBP-2026-000001',
                invoiceId: 'inv-1',
                method: 'shamcash',
                transactionRef: (r.body as { transactionRef: string }).transactionRef,
                amountMinor: 130_000_000,
                currency: 'SYP',
                status: 'pending',
                submittedAt: '2026-10-30T09:00:00.000Z',
                reason: null,
              },
            ],
          };
          return { status: 201, body: current.payments[0] };
        },
      });
      return { ...mock, ...renderApp('/subscription') };
    })();
    expect(await screen.findByRole('heading', { name: 'الاشتراك', level: 1 })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'سنوي (شهران مجاناً)' }));
    await user.click(screen.getByRole('button', { name: 'اختر هذه الباقة' }));
    const section = await screen.findByRole('region', { name: 'فاتورة الاشتراك' });
    expect(section).toHaveTextContent('SUB-2026-000001');
    expect(section).toHaveTextContent('0991234567');
    expect(requestsTo('POST', '/v1/subscription/invoices')[0]?.body).toEqual({
      planCode: 'basic',
      billingCycle: 'yearly',
    });
    await user.type(screen.getByLabelText('رقم العملية'), 'SC-123456');
    await user.click(screen.getByRole('button', { name: 'أرسلت المبلغ' }));
    expect(await screen.findByText(/وصلت دفعتك/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/subscription/payments')[0]?.body).toEqual({
      invoiceId: 'inv-1',
      method: 'shamcash',
      transactionRef: 'SC-123456',
      amountMinor: 130_000_000,
      currency: 'SYP',
    });
    expect(await screen.findByText('بانتظار التأكيد')).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });
});
