import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CustomerDetail, CustomerListItem, MeResponse } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const meOf = (repsEnabled: boolean): MeResponse => {
  const base = makeMe({ repsEnabled });
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'customers.view', 'customers.manage', 'routes.manage'],
    },
  };
};

const customer = (over: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c-1',
  name: 'بقالية الأمل',
  phone: null,
  creditLimitMinor: null,
  balanceMinor: 0,
  priceTier: 'retail',
  noMessages: false,
  archived: false,
  kind: null,
  contactName: null,
  contactPhone: null,
  regionId: null,
  regionName: null,
  approvalStatus: 'approved',
  lat: null,
  lng: null,
  ...over,
});

function open(repsEnabled: boolean, items: CustomerListItem[] = []) {
  return mockFetch({
    'POST /v1/auth/refresh': signedInRefresh,
    'GET /v1/me': { status: 200, body: meOf(repsEnabled) },
    'GET /v1/online-orders?status=pending': { status: 200, body: { items: [] } },
    'GET /v1/customers': { status: 200, body: { items, totalOwedMinor: 0, baseCurrency: 'SYP' } },
    'GET /v1/regions': {
      status: 200,
      body: [
        {
          id: 'r-1',
          name: 'المزة',
          parentId: null,
          sortOrder: 0,
          isActive: true,
          customerCount: 0,
          version: 1,
        },
      ],
    },
    'POST /v1/customers': (r: MockRequest) => ({
      status: 201,
      body: { ...customer(), ...(r.body as object), statement: [], createdAt: '2026-11-17T00:00:00Z' },
    }),
    'POST /v1/customers/c-1/approval': (r: MockRequest) => ({
      status: 200,
      body: {
        ...customer({ approvalStatus: (r.body as { status: 'approved' }).status }),
        statement: [],
        createdAt: '2026-11-17T00:00:00Z',
        taxNumber: null,
        address: null,
        notes: null,
        baseCurrency: 'SYP',
      } satisfies CustomerDetail,
    }),
  });
}

describe('the customer’s place in the distribution', () => {
  it('asks for the region and the shop’s location on a plan with reps, and sends them', async () => {
    const { requestsTo } = open(true);
    const { user } = renderApp('/customers');
    await user.click(await screen.findByRole('button', { name: 'زبون جديد' }));
    const form = await screen.findByRole('form', { name: 'زبون جديد' });
    await user.type(within(form).getByLabelText('اسم الزبون'), 'بقالية الأمل');
    await user.selectOptions(await within(form).findByLabelText('المنطقة'), 'r-1');
    await user.type(within(form).getByLabelText('خط العرض'), '33.51');
    await user.type(within(form).getByLabelText('خط الطول'), '36.29');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/customers')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/customers').at(-1)?.body).toMatchObject({
      regionId: 'r-1',
      lat: 33.51,
      lng: 36.29,
    });
  });

  it('says a location must be numbers', async () => {
    const { requestsTo } = open(true);
    const { user } = renderApp('/customers');
    await user.click(await screen.findByRole('button', { name: 'زبون جديد' }));
    const form = await screen.findByRole('form', { name: 'زبون جديد' });
    await user.type(within(form).getByLabelText('اسم الزبون'), 'بقالية الأمل');
    await user.type(within(form).getByLabelText('خط العرض'), 'شمال');
    await user.click(within(form).getByRole('button', { name: 'احفظ' }));
    expect(await within(form).findByText('اكتب الموقع أرقاماً، مثل 33.51 و 36.29')).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/customers')).toHaveLength(0);
  });

  it('leaves the distribution fields out for a store whose plan has no reps', async () => {
    open(false);
    const { user } = renderApp('/customers');
    await user.click(await screen.findByRole('button', { name: 'زبون جديد' }));
    const form = await screen.findByRole('form', { name: 'زبون جديد' });
    expect(within(form).queryByLabelText('المنطقة')).not.toBeInTheDocument();
    expect(within(form).queryByLabelText('خط العرض')).not.toBeInTheDocument();
  });

  it('marks a customer a rep added, and lists them under «بانتظار الموافقة»', async () => {
    open(true, [customer({ approvalStatus: 'pending' }), customer({ id: 'c-2', name: 'مطعم الشام' })]);
    const { user } = renderApp('/customers');
    const table = await screen.findByRole('table', { name: 'الزبائن وأرصدتهم' });
    expect(await within(table).findByText('مطعم الشام')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'بانتظار الموافقة (1)' }));
    expect(within(table).queryByText('مطعم الشام')).not.toBeInTheDocument();
    expect(within(table).getByText('بقالية الأمل')).toBeInTheDocument();
  });
});
