import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CustomerDetail, MeResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { coordinate, limitOf } from './CustomerForm';
import { debtReminderLink } from './debtReminder';

/** Round 44: the customers section's fixes: overpayment asked, archive confirmed, vouchers, points, reminders. */

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [
        ...base.user.permissions,
        'customers.view',
        'customers.manage',
        'receipt.create',
        'accounting.post',
        'installments.view',
      ],
    },
  };
}

const detail = (over: Partial<CustomerDetail> = {}): CustomerDetail => ({
  id: 'c-1',
  name: 'أبو خالد',
  phone: '+963933111222',
  creditLimitMinor: 5_000_000,
  balanceMinor: 1_800_000,
  priceTier: 'retail',
  noMessages: false,
  archived: false,
  kind: null,
  contactName: null,
  contactPhone: null,
  taxNumber: null,
  address: null,
  notes: null,
  createdAt: '2026-10-30T09:00:00.000Z',
  loyaltyPoints: 120,
  baseCurrency: 'SYP',
  statement: [],
  ...over,
});

function openCustomer(current: CustomerDetail = detail()) {
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/customers/c-1': () => ({ status: 200, body: current }),
    [`GET /v1/customers?${new URLSearchParams({ q: current.name })}`]: () => ({
      status: 200,
      body: { items: [current], totalOwedMinor: 0, baseCurrency: 'SYP' },
    }),
    'GET /v1/customers/c-1/purchases': () => ({
      status: 200,
      body: { customerId: 'c-1', sizes: [], invoices: [], pieces: 0, spentMinor: 0 },
    }),
    'GET /v1/installment-plans?customerId=c-1': () => ({
      status: 200,
      body: { items: [], baseCurrency: 'SYP', today: '2026-11-20' },
    }),
    'POST /v1/customers/c-1/payments': (r: MockRequest) => {
      const body = r.body as { amountMinor: number };
      return {
        status: 201,
        body: {
          kind: 'payment',
          number: 'RCA-2026-000001',
          date: '2026-11-20',
          customerId: 'c-1',
          customerName: current.name,
          amountMinor: body.amountMinor,
          method: 'cash',
          reference: null,
          note: null,
          balanceBeforeMinor: current.balanceMinor,
          balanceAfterMinor: current.balanceMinor - body.amountMinor,
          baseCurrency: 'SYP',
        },
      };
    },
    'PUT /v1/customers/c-1': () =>
      apiError(409, 'conflict', 'عليه دين غير مسدّد. سدّد حسابه أو حوّله قبل الأرشفة.'),
  });
  return { ...mock, ...renderApp('/customers/c-1') };
}

describe('a payment bigger than what is owed', () => {
  it('asks once, says what follows, and posts only after the yes', async () => {
    const { user, requestsTo } = openCustomer();
    await user.click(await screen.findByRole('button', { name: 'استلم دفعة' }));
    const dialog = await screen.findByRole('dialog');
    // 25,000 against 18,000 owed
    await user.type(within(dialog).getByLabelText(/المبلغ/), '25000');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل الدفعة' }));
    expect(await within(dialog).findByText(/المبلغ أكبر من المستحق على الزبون/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/customers/c-1/payments')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'نعم، سجّل والباقي رصيد له' }));
    expect(await screen.findByText('سُجّلت الدفعة')).toBeInTheDocument();
    expect(screen.getByText(/صار له عند المتجر/)).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/customers/c-1/payments')).toHaveLength(1);
  });

  it('does not ask for a payment within what is owed', async () => {
    const { user, requestsTo } = openCustomer();
    await user.click(await screen.findByRole('button', { name: 'استلم دفعة' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/المبلغ/), '5000');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل الدفعة' }));
    await screen.findByText('سُجّلت الدفعة');
    expect(requestsTo('POST', '/v1/customers/c-1/payments')).toHaveLength(1);
  });
});

describe('archiving from the customer page', () => {
  it('confirms first, warns about an open balance, and shows the server’s refusal', async () => {
    const { user, requestsTo } = openCustomer();
    await user.click(await screen.findByRole('button', { name: 'أرشفه' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/لا يُؤرشف زبون/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/customers/c-1')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'نعم، أرشفه' }));
    expect(await within(dialog).findByText(/عليه دين غير مسدّد/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/customers/c-1')).toHaveLength(1);
  });
});

describe('the customer page', () => {
  it('shows the loyalty points and a WhatsApp debt reminder that names the amount', async () => {
    openCustomer();
    expect(await screen.findByText('نقاط الولاء')).toBeInTheDocument();
    expect(screen.getByText('نقطة', { exact: false })).toBeInTheDocument();
    const reminders = await screen.findAllByRole('link', { name: /ذكّره بالدين/ });
    const href = reminders[0]!.getAttribute('href') ?? '';
    expect(href).toContain('https://wa.me/963933111222?text=');
    expect(decodeURIComponent(href)).toContain('18,000');
  });
});

describe('the pieces behind the form and the reminder', () => {
  it('reads coordinates and limits in any digits, and says «bad» for what is not a number', () => {
    expect(coordinate('٣٣٫٥١')).toBe(33.51);
    expect(coordinate(' 36.29 ')).toBe(36.29);
    expect(coordinate('')).toBeNull();
    expect(Number.isNaN(coordinate('abc'))).toBe(true);
    expect(limitOf('', 'SYP')).toBeNull();
    expect(limitOf('٥٠٠٠٠', 'SYP')).toBe(5_000_000);
    expect(limitOf('0.5', 'SYP')).toBe(50);
    expect(limitOf('-5', 'SYP')).toBe('bad');
    expect(limitOf('خمسة', 'SYP')).toBe('bad');
  });

  it('writes no reminder for a customer who owes nothing or has no phone', () => {
    const v = { name: 'ريم', balanceMinor: 0, currency: 'SYP' as const, store: 'نور' };
    expect(debtReminderLink('+963933111222', v)).toBeNull();
    expect(debtReminderLink(null, { ...v, balanceMinor: 100 })).toBeNull();
    expect(debtReminderLink('+963933111222', { ...v, balanceMinor: 1_000_000 })).toContain(
      'wa.me/963933111222',
    );
  });
});

describe('the vouchers tab', () => {
  it('lists what is left on each voucher and what the store owes in all', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/customers?limit=50': () => ({
        status: 200,
        body: { items: [], totalOwedMinor: 0, baseCurrency: 'SYP', nextCursor: null },
      }),
      'GET /v1/vouchers?status=open&limit=50': () => ({
        status: 200,
        body: {
          nextCursor: null,
          outstanding: [{ currency: 'SYP', amountMinor: 4_500_000, count: 1 }],
          items: [
            {
              code: 'GFT-001-0000012',
              kind: 'gift',
              currency: 'SYP',
              amountMinor: 5_000_000,
              redeemedMinor: 500_000,
              remainingMinor: 4_500_000,
              createdAt: '2026-11-18T10:00:00.000Z',
            },
          ],
        },
      }),
    });
    const { user } = renderApp('/customers');
    await user.click(await screen.findByRole('tab', { name: 'القسائم' }));
    expect(await screen.findByText('GFT-001-0000012')).toBeInTheDocument();
    expect(screen.getByText('قسيمة هدية')).toBeInTheDocument();
    await waitFor(() => expect(document.body).toHaveTextContent('45,000'));
    expect(screen.getByText(/قسيمة مفتوحة/)).toBeInTheDocument();
  });
});
