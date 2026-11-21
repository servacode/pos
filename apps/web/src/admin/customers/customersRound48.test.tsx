import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CustomerDetail, CustomerListItem, MeResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

/** Round 48: sortable headers, the bulk reminder, one statement on its own tab, the opening-debt id, a duplicate phone. */

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

const item = (over: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c-1',
  name: 'أبو خالد',
  phone: '+963933111222',
  creditLimitMinor: null,
  balanceMinor: 1_800_000,
  priceTier: 'retail',
  noMessages: false,
  archived: false,
  kind: null,
  contactName: null,
  contactPhone: null,
  ...over,
});

const page = (items: CustomerListItem[]) => ({
  status: 200,
  body: {
    items,
    totalOwedMinor: 1_800_000,
    totalCount: items.length,
    allCount: items.length,
    owingCount: items.length,
    baseCurrency: 'SYP',
    nextCursor: null,
  },
});

describe('the customers list', () => {
  it('sorts by a column title, asks the server, and says the direction in words', async () => {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/customers?limit=50': () => page([item()]),
      'GET /v1/customers?sort=name&dir=asc&limit=50': () => page([item()]),
      'GET /v1/customers?sort=name&dir=desc&limit=50': () => page([item()]),
      'GET /v1/customer-groups': () => ({ status: 200, body: [] }),
    });
    const { user } = renderApp('/customers');
    await screen.findByText('أبو خالد');
    await user.click(screen.getByRole('button', { name: /^الزبون/ }));
    await waitFor(() =>
      expect(mock.requestsTo('GET', '/v1/customers?sort=name&dir=asc&limit=50')).toHaveLength(1),
    );
    expect(await screen.findByText('مرتّب تصاعدياً')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^الزبون/ }));
    await waitFor(() =>
      expect(mock.requestsTo('GET', '/v1/customers?sort=name&dir=desc&limit=50')).toHaveLength(1),
    );
  });

  it('opens the bulk reminder with every debtor who can be written to', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/customers?limit=50': () => page([item(), item({ id: 'c-2', name: 'ريم', phone: null })]),
      'GET /v1/customers?owing=true&limit=200': () =>
        page([
          item(),
          item({ id: 'c-2', name: 'ريم', phone: null }),
          item({ id: 'c-3', name: 'سامر', phone: '+963944555666', noMessages: true }),
        ]),
      'GET /v1/customer-groups': () => ({ status: 200, body: [] }),
    });
    const { user } = renderApp('/customers');
    await screen.findByText('أبو خالد');
    await user.click(screen.getByRole('button', { name: 'تذكير جماعي للمدينين' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/افتح التالي: أبو خالد/)).toBeInTheDocument();
    const links = within(dialog).getAllByRole('link', { name: 'واتساب' });
    expect(links).toHaveLength(1);
    expect(decodeURIComponent(links[0]!.getAttribute('href') ?? '')).toContain('18,000');
    expect(within(dialog).getByText(/بلا رقم أو لا يريدون رسائل/)).toBeInTheDocument();
  });
});

const detail = (over: Partial<CustomerDetail> = {}): CustomerDetail => ({
  ...item(),
  taxNumber: null,
  address: null,
  notes: null,
  createdAt: '2026-10-30T09:00:00.000Z',
  loyaltyPoints: 0,
  baseCurrency: 'SYP',
  statement: [
    {
      date: '2026-10-30',
      sourceType: 'sale',
      sourceId: 's-1',
      number: 'INV-001-002-0000007',
      memo: 'فاتورة',
      debitMinor: 1_800_000,
      creditMinor: 0,
      balanceMinor: 1_800_000,
    },
  ],
  ...over,
});

function openCustomer(over: Partial<CustomerDetail> = {}) {
  const current = detail(over);
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
    'GET /v1/customer-groups': () => ({ status: 200, body: [] }),
    'POST /v1/customers/c-1/opening-debt': (r: MockRequest) => {
      const body = r.body as { amountMinor: number };
      return {
        status: 201,
        body: {
          kind: 'opening_debt',
          number: 'JV-2026-000001',
          date: '2026-11-20',
          customerId: 'c-1',
          customerName: current.name,
          amountMinor: body.amountMinor,
          method: null,
          reference: null,
          note: null,
          balanceBeforeMinor: current.balanceMinor,
          balanceAfterMinor: current.balanceMinor + body.amountMinor,
          baseCurrency: 'SYP',
        },
      };
    },
    'PUT /v1/customers/c-1': (r: MockRequest) => {
      const body = r.body as { confirmDuplicate?: boolean };
      return body.confirmDuplicate
        ? { status: 200, body: current }
        : apiError(409, 'conflict', 'هذا الرقم مسجّل للزبون «سامر». افتح حسابه أو أكّد الحفظ.', {
            phone: 'الرقم مسجّل لزبون آخر',
            duplicateOf: 'c-9',
          });
    },
  });
  return { ...mock, ...renderApp('/customers/c-1') };
}

describe('the customer page', () => {
  it('keeps the statement on its own tab, with the payment as the first action of the header', async () => {
    const { user } = openCustomer();
    // The overview has the facts, not the statement
    await screen.findByRole('tab', { name: 'الكشف' });
    expect(screen.queryByRole('list', { name: 'كشف الحساب' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'كشف الحساب' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'استلم دفعة' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'الكشف' }));
    expect(await screen.findByRole('table', { name: 'كشف الحساب' })).toBeInTheDocument();
  });

  it('sends one id with an opening debt, so a second click is the same debt', async () => {
    const { user, requestsTo } = openCustomer();
    await user.click(await screen.findByRole('tab', { name: 'الكشف' }));
    await user.click(await screen.findByRole('button', { name: 'سجّل دين افتتاحي' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/المبلغ/), '10000');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل الدين' }));
    await screen.findByText('سُجّل الدين الافتتاحي');
    const sent = requestsTo('POST', '/v1/customers/c-1/opening-debt');
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as { id?: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says another customer has the phone, and saves only after «احفظ رغم ذلك»', async () => {
    const { user, requestsTo } = openCustomer();
    await user.click(await screen.findByRole('button', { name: 'عدّل' }));
    const form = await screen.findByRole('form', { name: 'عدّل الزبون' });
    await user.click(within(form).getByRole('button', { name: /احفظ/ }));
    expect(await screen.findByText(/هذا الرقم مسجّل للزبون «سامر»/)).toBeInTheDocument();
    expect(requestsTo('PUT', '/v1/customers/c-1')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'احفظ رغم ذلك' }));
    await waitFor(() => expect(requestsTo('PUT', '/v1/customers/c-1')).toHaveLength(2));
    expect(
      (requestsTo('PUT', '/v1/customers/c-1')[1]!.body as { confirmDuplicate?: boolean }).confirmDuplicate,
    ).toBe(true);
  });
});
