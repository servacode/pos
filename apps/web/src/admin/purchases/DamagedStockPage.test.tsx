import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DamagedStock, MeResponse, Permission } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function keeper(extra: Permission[] = ['inventory.adjust', 'purchases.manage']): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, ...extra] } };
}

const damaged: DamagedStock = {
  baseCurrency: 'SYP',
  locations: [
    {
      branchId: 'd-1',
      ownerBranchId: 'branch-1',
      ownerName: 'الفرع الرئيسي',
      totalValueMinor: 80_000,
      items: [{ variantId: 'v-1', name: 'زيت ١ لتر', qty: 2000, valueMinor: 80_000 }],
    },
  ],
};

const suppliers = {
  items: [
    { id: 's-1', name: 'معمل الأمل', phone: null, notes: null, balanceMinor: 400_000, archived: false },
  ],
  baseCurrency: 'SYP',
};

describe('«البضاعة التالفة»', () => {
  it('lists what each store holds as damaged, with its cost, and says so when there is none', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper() },
      'GET /v1/damaged-stock': { status: 200, body: damaged },
    });
    renderApp('/damaged-stock');
    expect(await screen.findByText('الفرع الرئيسي')).toBeInTheDocument();
    expect(screen.getByText('زيت ١ لتر')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'رجّعها للمورد' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اشطبها' })).toBeInTheDocument();
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
  });

  it('shows an empty state when nothing is damaged', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper() },
      'GET /v1/damaged-stock': { status: 200, body: { baseCurrency: 'SYP', locations: [] } },
    });
    renderApp('/damaged-stock');
    expect(await screen.findByText('لا بضاعة تالفة الآن.')).toBeInTheDocument();
  });

  it('sends some of it back to a supplier through the supplier return, naming the damaged place', async () => {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper() },
      'GET /v1/damaged-stock': { status: 200, body: damaged },
      'GET /v1/suppliers': { status: 200, body: suppliers },
      'POST /v1/supplier-returns': (r: MockRequest) => ({
        status: 201,
        body: { id: 'r-1', number: 'PRT-2026-000001', ...(r.body as object) },
      }),
    });
    const { user } = renderApp('/damaged-stock');
    const { requestsTo } = mock;
    await screen.findByText('زيت ١ لتر');
    await user.click(screen.getByRole('button', { name: 'رجّعها للمورد' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'معمل الأمل' });
    await user.selectOptions(within(dialog).getByLabelText('المورد'), 's-1');
    const qty = within(dialog).getByLabelText('العدد');
    await user.clear(qty);
    await user.type(qty, '1');
    await user.click(within(dialog).getByRole('button', { name: 'سجّل المرتجع' }));
    await waitFor(() => expect(requestsTo('POST', '/v1/supplier-returns')).toHaveLength(1));
    expect(requestsTo('POST', '/v1/supplier-returns')[0]?.body).toMatchObject({
      supplierId: 's-1',
      branchId: 'd-1',
      refund: 'credit',
      lines: [{ variantId: 'v-1', qty: 1000 }],
    });
    expect(await screen.findByText(/سُجّل المرتجع PRT-2026-000001/)).toBeInTheDocument();
  });

  it('writes the damaged goods off with a count of the damaged place that leaves what stays', async () => {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper() },
      'GET /v1/damaged-stock': { status: 200, body: damaged },
      'POST /v1/stocktakes': { status: 201, body: { id: 'st-1', number: 'STK-2026-000001' } },
    });
    const { user } = renderApp('/damaged-stock');
    await screen.findByText('زيت ١ لتر');
    await user.click(screen.getByRole('button', { name: 'اشطبها' }));
    const dialog = await screen.findByRole('dialog');
    // Every piece is the start; the cost it becomes as a loss is said before it is confirmed
    expect(within(dialog).getByText(/تصير خسارة/)).toBeInTheDocument();
    const qty = within(dialog).getByLabelText('العدد');
    await user.clear(qty);
    await user.type(qty, '1');
    await user.click(within(dialog).getByRole('button', { name: 'اشطب' }));
    await waitFor(() => expect(mock.requestsTo('POST', '/v1/stocktakes')).toHaveLength(1));
    expect(mock.requestsTo('POST', '/v1/stocktakes')[0]?.body).toMatchObject({
      branchId: 'd-1',
      lines: [{ variantId: 'v-1', countedQty: 1000 }],
    });
    expect(await screen.findByText(/شُطبت «زيت ١ لتر»/)).toBeInTheDocument();
  });

  it('shows no action the user cannot take', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper(['inventory.adjust']) },
      'GET /v1/damaged-stock': { status: 200, body: damaged },
    });
    renderApp('/damaged-stock');
    await screen.findByText('زيت ١ لتر');
    expect(screen.queryByRole('button', { name: 'رجّعها للمورد' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اشطبها' })).toBeInTheDocument();
  });
});
