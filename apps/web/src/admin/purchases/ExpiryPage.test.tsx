import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExpiryResponse, MeResponse } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { bannedWordsIn, userFacingText } from '../../test/glossary';
import { renderApp } from '../../test/renderApp';

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'purchases.manage'] } };
}

const report = (days: number): ExpiryResponse => ({
  today: '2026-10-30',
  items:
    days >= 90
      ? [
          {
            variantId: 'v-1',
            name: 'بانادول 500',
            batchNo: 'A-01',
            expiryDate: '2026-10-25',
            purchaseNumber: 'PUR-0001',
            receivedOn: '2026-10-20',
            qty: 10_000,
            daysLeft: -5,
          },
          {
            variantId: 'v-2',
            name: 'أموكسيل 250',
            batchNo: null,
            expiryDate: '2026-11-15',
            purchaseNumber: 'PUR-0002',
            receivedOn: '2026-10-28',
            qty: 3_000,
            daysLeft: 16,
          },
        ]
      : [],
});

describe('«الصلاحية»', () => {
  it('lists the batches by expiry with what is left, and narrows the window', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      'GET /v1/inventory/expiry?days=90': () => ({ status: 200, body: report(90) }),
      'GET /v1/inventory/expiry?days=30': () => ({ status: 200, body: report(30) }),
    });
    const { user } = renderApp('/expiry');
    const table = await screen.findByRole('table', { name: 'الدفعات حسب الصلاحية' });
    expect(await within(table).findByText('بانادول 500')).toBeInTheDocument();
    expect(table).toHaveTextContent('منتهٍ منذ 5 يوماً');
    expect(table).toHaveTextContent('باقٍ 16 يوماً');
    expect(bannedWordsIn(userFacingText(document.body))).toEqual([]);
    await user.click(screen.getByRole('radio', { name: '30 يوماً' }));
    expect(await screen.findByText(/لا شيء ينتهي في هذه المدة/)).toBeInTheDocument();
    expect(requestsTo('GET', '/v1/inventory/expiry?days=30')).toHaveLength(1);
  });
});
