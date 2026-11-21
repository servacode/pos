import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CustomerListItem, MeResponse } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { isoDay } from '../../lib/dates';
import { mergeByPhone } from './BulkReminder';
import { customersCsv } from './csv';

/** Round 50: the tools menu, one export request, the empty text of each chip, the debt kept for archived customers, one reminder per phone. */

function owner(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: { ...base.user, permissions: [...base.user.permissions, 'customers.view', 'customers.manage'] },
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

const body = (items: CustomerListItem[], extra: Record<string, unknown> = {}) => ({
  items,
  totalOwedMinor: 1_800_000,
  totalCount: items.length,
  allCount: 3,
  owingCount: 1,
  baseCurrency: 'SYP',
  nextCursor: null,
  ...extra,
});

describe('customers round 50', () => {
  it('puts groups, bulk reminder and export in one «أدوات» menu, and exports with one request', async () => {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/customers?limit=50': () => ({ status: 200, body: body([item()]) }),
      'GET /v1/customers?export=true': () => ({ status: 200, body: body([item()]) }),
      'GET /v1/customer-groups': () => ({ status: 200, body: [] }),
    });
    const { user } = renderApp('/customers');
    await screen.findByText('أبو خالد');
    expect(screen.queryByRole('button', { name: 'صدّر إلى إكسل' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أدوات' }));
    expect(await screen.findByRole('menuitem', { name: 'المجموعات' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'تذكير جماعي للمدينين' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'صدّر إلى إكسل' }));
    await screen.findByText('أبو خالد');
    expect(mock.requests.filter((r) => r.path.includes('export=true'))).toHaveLength(1);
    expect(mock.requests.filter((r) => r.path.includes('limit=200'))).toHaveLength(0);
  });

  it('says what the archived customers owe under the debts tile', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/customers?limit=50': () => ({
        status: 200,
        body: body([item()], { archivedOwedMinor: 700_000 }),
      }),
      'GET /v1/customer-groups': () => ({ status: 200, body: [] }),
    });
    renderApp('/customers');
    await screen.findByText('أبو خالد');
    expect(await screen.findByText(/على زبائن مؤرشفين/)).toBeInTheDocument();
  });

  it('an empty birthday month says so, not «لا زبائن بعد»', async () => {
    const month = Number(isoDay(Date.now(), makeMe().tenant.timezone).slice(5, 7));
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      [`GET /v1/customers?birthMonth=${month}&limit=50`]: () => ({
        status: 200,
        body: body([], { allCount: 3 }),
      }),
      'GET /v1/customers?limit=50': () => ({ status: 200, body: body([item()]) }),
      'GET /v1/customer-groups': () => ({ status: 200, body: [] }),
    });
    renderApp('/customers?birthdays=1');
    expect(await screen.findByText(/لا عيد ميلاد لأحد/)).toBeInTheDocument();
    expect(screen.queryByText('لا زبائن بعد.')).not.toBeInTheDocument();
  });
});

describe('one reminder per phone', () => {
  it('joins the names and adds the debts of customers who share a phone', () => {
    const merged = mergeByPhone([
      item({ id: 'a', name: 'أ', phone: '0933770026', balanceMinor: 100 }),
      item({ id: 'b', name: 'ب', phone: '٠٩٣٣٧٧٠٠٢٦', balanceMinor: 250 }),
      item({ id: 'c', name: 'ج', phone: '0944000000', balanceMinor: 5 }),
    ]);
    expect(merged.map((c) => [c.name, c.balanceMinor])).toEqual([
      ['أ / ب', 350],
      ['ج', 5],
    ]);
  });
});

describe('the Excel file', () => {
  it('still starts with the byte-order mark', () => {
    expect(customersCsv([item()], 'SYP').charCodeAt(0)).toBe(0xfeff);
  });
});
