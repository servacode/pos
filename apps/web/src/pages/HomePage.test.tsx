import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch } from '../test/fetchMock';
import { makeMe, signedInRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';

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
});
