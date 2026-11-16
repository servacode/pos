import { screen } from '@testing-library/react';
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
});
