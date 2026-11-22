import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MeResponse, WasteReport } from '@serva/core';
import { mockFetch } from '../../test/fetchMock';
import { makeMe, signedInRefresh } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';
import { daysAgo } from './MerchandisePage';

/** Round 38, #41: the waste report by period, reason, product and cost */

const report: WasteReport = {
  from: '2026-10-21',
  to: '2026-11-19',
  baseCurrency: 'SYP',
  totalCostMinor: 120_000,
  byReason: [
    { reason: 'انتهت صلاحيتو', qty: 3000, costMinor: 90_000, count: 2 },
    { reason: 'انكسر', qty: 1000, costMinor: 30_000, count: 1 },
  ],
  byProduct: [
    { variantId: 'v-1', name: 'حليب 1 لتر', qty: 3000, costMinor: 90_000, count: 2 },
    { variantId: 'v-2', name: 'مرطبان مخلل', qty: 1000, costMinor: 30_000, count: 1 },
  ],
  rows: [
    {
      date: '2026-11-18',
      number: 'STK-2026-000003',
      branchId: 'b-1',
      variantId: 'v-1',
      name: 'حليب 1 لتر',
      reason: 'انتهت صلاحيتو',
      qty: 2000,
      costMinor: 60_000,
    },
  ],
};

function owner(): MeResponse {
  const base = makeMe();
  return { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'inventory.adjust'] } };
}

describe('«التالف والهدر»', () => {
  it('reads the report for the period and shows it by reason, by product and move by move', async () => {
    const { requests } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': () => ({ status: 200, body: owner() }),
      [`GET /v1/reports/waste?from=${daysAgo(29)}&to=${daysAgo(0)}`]: () => ({ status: 200, body: report }),
    });
    const { user } = renderApp('/reports/waste');
    expect(await screen.findByRole('heading', { name: 'التالف والهدر', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('انتهت صلاحيتو')).toBeInTheDocument();
    expect(requests.some((r) => r.path.startsWith('/v1/reports/waste'))).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'بحسب الصنف' }));
    expect(await screen.findByText('مرطبان مخلل')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'كل الحركات' }));
    expect(await screen.findByText('2026-11-18')).toBeInTheDocument();
  });
});
