import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CustomerDetail, CustomerListResponse, MeResponse } from '@serva/core';
import { apiError, mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'customers.view', 'customers.manage'] },
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
  taxNumber: null,
  address: null,
  notes: null,
  createdAt: '2026-10-30T09:00:00.000Z',
  baseCurrency: 'SYP',
  statement: [
    {
      date: '2026-10-30',
      sourceType: 'sale',
      sourceId: 's-1',
      number: 'INV-001-002-0000007',
      memo: 'فاتورة',
      debitMinor: 3_000_000,
      creditMinor: 0,
      balanceMinor: 3_000_000,
    },
    {
      date: '2026-10-31',
      sourceType: 'receipt',
      sourceId: 'r-1',
      number: 'RCV-001-002-0000001',
      memo: 'سند قبض',
      debitMinor: 0,
      creditMinor: 1_200_000,
      balanceMinor: 1_800_000,
    },
  ],
  ...over,
});

function open(path: string) {
  let current = detail();
  const list = (): CustomerListResponse => ({
    items: [current],
    totalOwedMinor: Math.max(0, current.balanceMinor),
    baseCurrency: 'SYP',
  });
  const mock = mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': () => ({ status: 200, body: owner() }),
    'GET /v1/customers': () => ({ status: 200, body: list() }),
    'GET /v1/customers/c-1': () => ({ status: 200, body: current }),
    'POST /v1/customers': (r: MockRequest) => {
      const body = r.body as { name: string };
      if (body.name === 'ا')
        return apiError(400, 'validation_failed', 'تحقّق من الحقول', { name: 'اكتب اسم الزبون' });
      current = detail({ name: body.name, balanceMinor: 0, statement: [] });
      return { status: 201, body: current };
    },
    'PUT /v1/customers/c-1': (r: MockRequest) => {
      current = { ...current, ...(r.body as Partial<CustomerDetail>) };
      return { status: 200, body: current };
    },
  });
  return { ...mock, ...renderApp(path) };
}

describe('«الزبائن»', () => {
  it('lists customers with what they owe, and opens one with its statement', async () => {
    const { user } = open('/customers');
    expect(await screen.findByRole('heading', { name: 'الزبائن', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('أبو خالد')).toBeInTheDocument();
    expect(document.body).toHaveTextContent('18,000');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);

    await user.click(screen.getByRole('link', { name: 'أبو خالد' }));
    expect(await screen.findByRole('table', { name: 'كشف الحساب' })).toBeInTheDocument();
    expect(screen.getByText('فاتورة آجل')).toBeInTheDocument();
    expect(screen.getByText('دفعة')).toBeInTheDocument();
  });

  it('adds a customer, showing the server’s message on the field', async () => {
    const { user, requestsTo } = open('/customers');
    await user.click(await screen.findByRole('button', { name: 'زبون جديد' }));
    await user.type(screen.getByLabelText('اسم الزبون'), 'ا');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByText('اكتب اسم الزبون')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('اسم الزبون'));
    await user.type(screen.getByLabelText('اسم الزبون'), 'مطعم الياسمين');
    await user.type(screen.getByLabelText('حد الدين بالليرة'), '50000');
    await user.click(screen.getByRole('button', { name: 'احفظ' }));
    expect(await screen.findByRole('heading', { name: 'مطعم الياسمين', level: 1 })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/customers').at(-1)?.body).toMatchObject({
      name: 'مطعم الياسمين',
      creditLimitMinor: 5_000_000,
    });
  });
});
