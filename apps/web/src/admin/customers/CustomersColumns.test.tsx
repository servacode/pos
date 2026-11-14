import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const row = (id: string, name: string, over: object) => ({
  id,
  name,
  phone: null,
  creditLimitMinor: null,
  balanceMinor: 0,
  priceTier: 'retail',
  noMessages: false,
  archived: false,
  kind: null,
  contactName: null,
  contactPhone: null,
  ...over,
});

describe('the customers list: what they bought and who went quiet', () => {
  it('shows the last purchase, the spend and the favourite size, and filters those away for 90 days', async () => {
    const me = makeMe();
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': {
        status: 200,
        body: {
          ...me,
          tenant: { ...me.tenant, sectors: ['clothing'] },
          user: { ...me.user, permissions: ['customers.view'] },
        },
      },
      'GET /v1/customers': {
        status: 200,
        body: {
          baseCurrency: 'SYP',
          totalOwedMinor: 0,
          items: [
            row('c-1', 'ريم القديمة', {
              lastPurchaseDate: daysAgo(120),
              spentMinor: 900_000,
              favouriteSize: 'M',
            }),
            row('c-2', 'نور الجديدة', {
              lastPurchaseDate: daysAgo(3),
              spentMinor: 100_000,
              favouriteSize: 'L',
            }),
            row('c-3', 'بلا مشتريات', { lastPurchaseDate: null, spentMinor: 0, favouriteSize: null }),
          ],
        },
      },
    });
    const { user } = renderApp('/customers');
    expect(await screen.findByText('نور الجديدة')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'آخر شراء' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'المقاس المفضّل' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'لم يزر منذ 90 يوماً' }));
    expect(screen.getByText('ريم القديمة')).toBeInTheDocument();
    expect(screen.queryByText('نور الجديدة')).not.toBeInTheDocument();
    expect(screen.queryByText('بلا مشتريات')).not.toBeInTheDocument();
  });
});
