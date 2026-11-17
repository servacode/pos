import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { InventoryResponse, SerialRow } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

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
    const stock: InventoryResponse = {
      items: [
        {
          variantId: 'v-1',
          name: 'كرسي متحرك',
          branchId: 'b-1',
          qty: 2_000,
          valueMinor: 0,
          unitCostMinor: 0,
        },
      ],
      totalValueMinor: 0,
      baseCurrency: 'SYP',
    };
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({
        status: 200,
        body: { ...makeMe(), tenant: { ...makeMe().tenant, sectors: ['electronics'] } },
      }),
      'GET /v1/serials?': () => ({
        status: 200,
        body: { items: [row('A1', 'in_stock'), row('A2', 'in_stock'), row('A3', 'in_stock')] },
      }),
      'GET /v1/inventory': () => ({ status: 200, body: stock }),
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
        body: { ...makeMe(), tenant: { ...makeMe().tenant, sectors: ['electronics'] } },
      }),
      'GET /v1/serials?': () => ({
        status: 200,
        body: { items: [row('A1', 'in_stock'), row('A2', 'in_stock'), row('A3', 'in_stock')] },
      }),
      'GET /v1/inventory': () => ({
        status: 200,
        body: {
          items: [
            { variantId: 'v-1', name: 'x', branchId: 'b-1', qty: 2_000, valueMinor: 0, unitCostMinor: 0 },
          ],
          totalValueMinor: 0,
          baseCurrency: 'SYP',
        },
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
        body: { ...makeMe(), tenant: { ...makeMe().tenant, sectors: ['electronics'] } },
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
