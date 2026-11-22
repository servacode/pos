import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DamagedStock, MeResponse, SerialRow } from '@serva/core';
import { mockFetch, type MockRequest } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

/** Round 62 (inventory): a write-off of a tracked product asks its numbers, the picker searches and takes pasted numbers, and the serial page puts a drift right */

function keeper(): MeResponse {
  const base = makeMe();
  return {
    ...base,
    user: {
      ...base.user,
      permissions: [...base.user.permissions, 'inventory.adjust', 'purchases.manage', 'catalog.manage'],
    },
    tenant: { ...base.tenant, sectors: ['electronics'] },
  };
}

const damaged: DamagedStock = {
  baseCurrency: 'SYP',
  locations: [
    {
      branchId: 'd-1',
      ownerBranchId: 'branch-1',
      ownerName: 'الفرع الرئيسي',
      totalValueMinor: 3_000_000,
      items: [
        { variantId: 'v-1', name: 'سامسونج A15', qty: 2000, valueMinor: 3_000_000, tracksSerial: true },
      ],
    },
  ],
};

const base = {
  'POST /v1/auth/refresh': signedInRefresh,
  'GET /v1/me': { status: 200, body: keeper() },
  'GET /v1/damaged-stock': { status: 200, body: damaged },
  'GET /v1/inventory/serials?variantId=v-1&branchId=d-1': {
    status: 200,
    body: { items: ['IMEI-1', 'IMEI-2'], truncated: true },
  },
  'GET /v1/inventory/serials?variantId=v-1&branchId=d-1&q=99': {
    status: 200,
    body: { items: [], truncated: false },
  },
  'POST /v1/stocktakes': { status: 201, body: { id: 'st-1', number: 'STK-2026-000001' } },
};

describe('a damaged phone is written off with its number', () => {
  it('may leave the number for later: the write-off says so and the success tells the owner', async () => {
    const mock = mockFetch(base);
    const { user } = renderApp('/damaged-stock');
    await screen.findByText('سامسونج A15');
    await user.click(screen.getByRole('button', { name: 'اشطبها' }));
    const dialog = await screen.findByRole('dialog');
    const qty = within(dialog).getByLabelText('العدد');
    await user.clear(qty);
    await user.type(qty, '1');
    // The list was cut at 1000: the person is told, and can search
    expect(await within(dialog).findByTestId('serial-truncated')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'اشطب' }));
    await waitFor(() => expect(mock.requestsTo('POST', '/v1/stocktakes')).toHaveLength(1));
    expect(mock.requestsTo('POST', '/v1/stocktakes')[0]?.body).toMatchObject({
      serialsLater: true,
      lines: [{ variantId: 'v-1', countedQty: 1000 }],
    });
    expect(await screen.findByText(/صحّحها من صفحة «الأرقام التسلسلية»/)).toBeInTheDocument();
  });

  it('sends the number picked or pasted, and then does not say serials later', async () => {
    const mock = mockFetch(base);
    const { user } = renderApp('/damaged-stock');
    await screen.findByText('سامسونج A15');
    await user.click(screen.getByRole('button', { name: 'اشطبها' }));
    const dialog = await screen.findByRole('dialog');
    const qty = within(dialog).getByLabelText('العدد');
    await user.clear(qty);
    await user.type(qty, '1');
    await within(dialog).findByText('IMEI-2');
    // A scanned number plus Enter joins the picked ones (a wrong count is refused before anything is sent)
    await user.type(within(dialog).getByLabelText('الصق أو امسح الأرقام'), 'imei-2{Enter}');
    expect(within(dialog).getByRole('button', { name: 'أزل IMEI-2' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'اشطب' }));
    await waitFor(() => expect(mock.requestsTo('POST', '/v1/stocktakes')).toHaveLength(1));
    const body = mock.requestsTo('POST', '/v1/stocktakes')[0]?.body as Record<string, unknown>;
    expect(body.serialsLater).toBeUndefined();
    expect(body).toMatchObject({ lines: [{ variantId: 'v-1', countedQty: 1000, serials: ['IMEI-2'] }] });
  });

  it('searches the numbers on the server', async () => {
    const mock = mockFetch(base);
    const { user } = renderApp('/damaged-stock');
    await screen.findByText('سامسونج A15');
    await user.click(screen.getByRole('button', { name: 'اشطبها' }));
    const dialog = await screen.findByRole('dialog');
    const qty = within(dialog).getByLabelText('العدد');
    await user.clear(qty);
    await user.type(qty, '1');
    await user.type(await within(dialog).findByLabelText('ابحث في الأرقام'), '99');
    await waitFor(() =>
      expect(
        mock.requestsTo('GET', '/v1/inventory/serials?variantId=v-1&branchId=d-1&q=99').length,
      ).toBeGreaterThan(0),
    );
    expect(await within(dialog).findByText('لا رقم مطابق.')).toBeInTheDocument();
  });
});

const row = (serial: string, status: SerialRow['status']): SerialRow => ({
  serial,
  variantId: 'v-1',
  name: 'سامسونج A15',
  status,
  purchaseNumber: 'PUR-1',
  receivedOn: '2026-10-01',
  saleNumber: null,
  soldOn: null,
  warrantyUntil: null,
  flags: [],
  sales: [],
  customerName: null,
  saleId: null,
});

describe('«الأرقام التسلسلية»: stock and numbers that disagree', () => {
  it('marks a number lost where the stock has fewer pieces than numbers', async () => {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper() },
      'GET /v1/serials/unassigned': { status: 200, body: { items: [] } },
      'GET /v1/serials/drift': {
        status: 200,
        body: { items: [{ variantId: 'v-1', name: 'سامسونج A15', stockPieces: 1, serialPieces: 2 }] },
      },
      'GET /v1/serials?': { status: 200, body: { items: [row('A1', 'in_stock'), row('A2', 'in_stock')] } },
      'GET /v1/serials?variantId=v-1': {
        status: 200,
        body: { items: [row('A1', 'in_stock'), row('A2', 'in_stock')] },
      },
      'POST /v1/serials/fix': (r: MockRequest) => ({ status: 200, body: r.body }),
    });
    const { user } = renderApp('/serials');
    await user.click(await screen.findByRole('button', { name: 'اعرض أرقامه وسجّل الضائع' }));
    await waitFor(() =>
      expect(mock.requestsTo('GET', '/v1/serials?variantId=v-1').length).toBeGreaterThan(0),
    );
    const [first] = await screen.findAllByRole('button', { name: 'ضائع؟' });
    await user.click(first!);
    const [yes] = await screen.findAllByRole('button', { name: 'نعم، ضاعت' });
    await user.click(yes!);
    await waitFor(() => expect(mock.requestsTo('POST', '/v1/serials/fix')).toHaveLength(1));
    expect(mock.requestsTo('POST', '/v1/serials/fix')[0]?.body).toMatchObject({ status: 'lost' });
  });

  it('adds the missing numbers of a product that has more pieces than numbers', async () => {
    const mock = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: keeper() },
      'GET /v1/serials/unassigned': { status: 200, body: { items: [] } },
      'GET /v1/serials/drift': {
        status: 200,
        body: { items: [{ variantId: 'v-1', name: 'سامسونج A15', stockPieces: 3, serialPieces: 1 }] },
      },
      'GET /v1/serials?': { status: 200, body: { items: [row('A1', 'in_stock')] } },
      'POST /v1/serials/fix': (r: MockRequest) => ({ status: 200, body: r.body }),
    });
    const { user } = renderApp('/serials');
    const warning = await screen.findByTestId('serials-behind');
    await user.type(within(warning).getByLabelText(/الأرقام \(افصل/), 'b2 b3');
    await user.click(within(warning).getByRole('button', { name: 'سجّل الأرقام' }));
    await waitFor(() => expect(mock.requestsTo('POST', '/v1/serials/fix')).toHaveLength(2));
    expect(mock.requestsTo('POST', '/v1/serials/fix').map((r) => r.body)).toEqual([
      { serial: 'B2', status: 'in_stock', variantId: 'v-1' },
      { serial: 'B3', status: 'in_stock', variantId: 'v-1' },
    ]);
  });
});
