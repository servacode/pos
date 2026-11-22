import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SerialRow } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

/** An electronics store's owner of the screen: the numbers page asks for catalog.manage */
const electronicsMe = () => {
  const me = makeMe();
  return {
    ...me,
    user: { ...me.user, permissions: [...me.user.permissions, 'catalog.manage'] },
    tenant: { ...me.tenant, sectors: ['electronics'] },
  };
};

const row = (serial: string, status: SerialRow['status']): SerialRow => ({
  serial,
  variantId: 'v-1',
  name: 'كرسي متحرك',
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

describe('«الأرقام التسلسلية»: numbers ahead of the stock', () => {
  it('warns when more numbers are in the shop than pieces in stock', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: electronicsMe(),
      }),
      'GET /v1/serials?': () => ({
        status: 200,
        body: { items: [row('A1', 'in_stock'), row('A2', 'in_stock'), row('A3', 'in_stock')] },
      }),
      'GET /v1/serials/drift': () => ({
        status: 200,
        body: { items: [{ variantId: 'v-1', name: 'كرسي متحرك', stockPieces: 2, serialPieces: 3 }] },
      }),
      'GET /v1/serials/unassigned': () => ({
        status: 200,
        body: {
          items: [
            {
              saleId: 's-1',
              saleNumber: 'INV-1',
              soldOn: '2026-10-01',
              variantId: 'v-1',
              name: 'كرسي متحرك',
              missing: 1,
              candidates: ['A1'],
            },
          ],
        },
      }),
    });
    renderApp('/serials');
    const warning = await screen.findByTestId('serials-ahead');
    expect(warning).toHaveTextContent('كرسي متحرك');
    expect(warning).toHaveTextContent('المخزون 2');
    expect(warning).toHaveTextContent('بيعة بلا رقم');
  });

  it('does not point to the unassigned list when there is none', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: electronicsMe(),
      }),
      'GET /v1/serials?': () => ({
        status: 200,
        body: { items: [row('A1', 'in_stock'), row('A2', 'in_stock'), row('A3', 'in_stock')] },
      }),
      'GET /v1/serials/drift': () => ({
        status: 200,
        body: { items: [{ variantId: 'v-1', name: 'x', stockPieces: 2, serialPieces: 3 }] },
      }),
    });
    renderApp('/serials');
    const warning = await screen.findByTestId('serials-ahead');
    expect(warning).not.toHaveTextContent('اختر الرقم الذي خرج');
  });

  it('lets the owner pick which sale keeps a number two sales took, with a «لا» to cancel', async () => {
    const twice: SerialRow = {
      ...row('DUP-1', 'sold'),
      saleNumber: 'INV-1',
      flags: ['duplicate'],
      sales: [
        { saleId: 's-2', saleNumber: 'INV-2', soldOn: '2026-10-02', flag: 'duplicate', customerName: null },
        { saleId: 's-1', saleNumber: 'INV-1', soldOn: '2026-10-01', flag: null, customerName: 'سامر' },
      ],
    };
    let fixed: unknown = null;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: electronicsMe(),
      }),
      'GET /v1/serials?': () => ({ status: 200, body: { items: [twice] } }),
      'GET /v1/inventory': () => ({
        status: 200,
        body: { items: [], totalValueMinor: 0, baseCurrency: 'SYP' },
      }),
      'GET /v1/serials/unassigned': () => ({ status: 200, body: { items: [] } }),
      'POST /v1/serials/fix': (req) => {
        fixed = req.body;
        return { status: 200, body: { serial: 'DUP-1', status: 'sold' } };
      },
    });
    renderApp('/serials');
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'تصحيح' }))[0]!);
    expect((await screen.findAllByTestId('serial-keep')).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: /INV-2/ })[0]!);
    expect((await screen.findAllByText(/لا يغيّر المخزون ولا الحسابات/))[0]).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'نعم، يبقى معها' })[0]!);
    await waitFor(() => expect(fixed).toMatchObject({ serial: 'DUP-1', status: 'sold', keepSaleId: 's-2' }));
  });
});

describe('«الأرقام التسلسلية»: the phone cards fold (round 66)', () => {
  it('shows the first 15 cards and «اعرض الكل (N)» opens the rest', async () => {
    const many = Array.from({ length: 24 }, (_, i) => row(`S-${String(i + 1).padStart(2, '0')}`, 'in_stock'));
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: electronicsMe() }),
      'GET /v1/serials?': () => ({ status: 200, body: { items: many } }),
      'GET /v1/serials/drift': () => ({ status: 200, body: { items: [] } }),
      'GET /v1/serials/unassigned': () => ({ status: 200, body: { items: [] } }),
    });
    const { user } = renderApp('/serials');
    const cards = await screen.findByRole('list', { name: 'الأجهزة بأرقامها' });
    await waitFor(() => expect(within(cards).getAllByRole('listitem').length).toBe(16));
    await user.click(within(cards).getByRole('button', { name: 'اعرض الكل (24)' }));
    expect(within(cards).getAllByRole('listitem')).toHaveLength(24);
    expect(within(cards).queryByRole('button', { name: /اعرض الكل/ })).not.toBeInTheDocument();
  });
});
