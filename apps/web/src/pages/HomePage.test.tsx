import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { dayReport } from '../test/reports';
import { withQuery } from '../admin/reports/api';
import { defaultBranch } from '../admin/reports/parts';
import { isoDay } from '../lib/dates';

describe('HomePage', () => {
  it('shows the trial days left, the store and its sectors', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe({ status: 'trialing', daysLeft: 12 }) },
    });
    renderApp('/');

    expect(await screen.findByText('باقي 12 يوماً من الباقة المجانية')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'متجرك جاهز، أحمد' })).toBeInTheDocument();
    expect(screen.getByText('سوبرماركت الياسمين')).toBeInTheDocument();
    const sectors = within(screen.getByRole('list', { name: 'نشاط المتجر' }));
    expect(sectors.getByText('سوبرماركت ومولات')).toBeInTheDocument();
    expect(sectors.getByText('مقهى وكافتيريا')).toBeInTheDocument();
  });

  it('hides the trial banner for paid stores', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe({ status: 'active', daysLeft: 200 }) },
    });
    renderApp('/');

    await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' });
    expect(screen.queryByText(/الباقة المجانية/)).not.toBeInTheDocument();
  });

  it('logs out and returns to the login page', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe() },
      'POST /v1/auth/logout': { status: 204 },
    });
    const { user } = renderApp('/');

    await user.click(await screen.findByRole('button', { name: /خروج/ }));

    expect(await screen.findByRole('heading', { name: 'أهلاً بعودتك' })).toBeInTheDocument();
    expect(requestsTo('POST', '/v1/auth/logout')).toHaveLength(1);
  });

  it('shows today against yesterday, the best sellers and the payment methods to whoever sees sales', async () => {
    const base = makeMe({ status: 'active', daysLeft: 200 });
    const me = { ...base, user: { ...base.user, permissions: [...base.user.permissions, 'report.view'] } };
    const branchId = defaultBranch(me as never);
    const day = (ms: number) =>
      `GET ${withQuery('/v1/reports/day', { branchId, date: isoDay(ms, me.tenant.timezone) })}`;
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: me },
      [day(Date.now())]: { status: 200, body: dayReport() },
      [day(Date.now() - 86_400_000)]: {
        status: 200,
        body: dayReport({ invoiceCount: 2, netSalesMinor: 1_000_000 }),
      },
    });
    renderApp('/');

    expect(await screen.findByText('صافي مبيعات اليوم')).toBeInTheDocument();
    expect(screen.getByText('الأكثر مبيعاً اليوم')).toBeInTheDocument();
    expect(screen.getByText('رز بسمتي')).toBeInTheDocument();
    expect(screen.getByText('طرق الدفع')).toBeInTheDocument();
    // 1,284,500 against 1,000,000 yesterday
    expect(screen.getAllByText('28%').length).toBeGreaterThan(0);
  });
});
