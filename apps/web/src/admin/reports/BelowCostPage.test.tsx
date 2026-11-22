import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../../test/fetchMock';
import { signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { meWith, NOW, OWNER_KEYS } from '../../test/reports';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const DAY = new Date(NOW).toLocaleDateString('en-CA');

describe('«بيع تحت الكلفة»', () => {
  it('lists the items sold under their cost, with the quantity, price, cost and loss', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
      [`GET /v1/reports/profit?from=${DAY}&to=${DAY}`]: {
        status: 200,
        body: {
          from: DAY,
          to: DAY,
          netSalesMinor: 1_000_000,
          costOfSalesMinor: 1_200_000,
          grossProfitMinor: -200_000,
          stockLossMinor: 0,
          belowCostCount: 1,
          belowCost: [
            {
              productId: 'p1',
              name: 'علبة شاش',
              qty: 2000,
              soldMinor: 200_000,
              costMinor: 600_000,
              lossMinor: 400_000,
            },
          ],
          baseCurrency: 'SYP',
        },
      },
    });
    renderApp('/reports/below-cost');
    const table = await screen.findByRole('table', { name: 'الأصناف المبيعة تحت الكلفة' });
    const row = (await within(table).findByText('علبة شاش')).closest('tr')!;
    expect(row).toHaveTextContent('2');
    expect(row).toHaveTextContent('2,000');
    expect(row).toHaveTextContent('6,000');
    expect(row).toHaveTextContent('4,000');
  });

  it('says so when nothing sold under its cost', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: meWith(OWNER_KEYS) },
      [`GET /v1/reports/profit?from=${DAY}&to=${DAY}`]: {
        status: 200,
        body: {
          from: DAY,
          to: DAY,
          netSalesMinor: 0,
          costOfSalesMinor: 0,
          grossProfitMinor: 0,
          stockLossMinor: 0,
          belowCostCount: 0,
          belowCost: [],
          baseCurrency: 'SYP',
        },
      },
    });
    renderApp('/reports/below-cost');
    expect(await screen.findByText('لا أصناف بيعت تحت الكلفة في هذا اليوم.')).toBeInTheDocument();
  });
});
