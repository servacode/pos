import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch, type MockReply } from './test/fetchMock';
import { makeMe, signedInRefresh, signedOutRefresh } from './test/fixtures';
import { renderApp } from './test/renderApp';

describe('routing', () => {
  it('shows a loader while the session is being restored', async () => {
    let finishRefresh: (reply: MockReply) => void = () => {};
    const { requestsTo } = mockFetch({
      'POST /v1/auth/refresh': () =>
        new Promise<MockReply>((resolve) => {
          finishRefresh = resolve;
        }),
    });
    renderApp('/');

    await waitFor(() => expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(1));
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحميل…');
    finishRefresh(signedOutRefresh);
    expect(await screen.findByRole('heading', { name: 'أهلاً بعودتك' })).toBeInTheDocument();
  });

  it('sends signed-out visitors to the login page', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'أهلاً بعودتك' })).toBeInTheDocument();
  });

  it('sends signed-in users away from the register page', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    renderApp('/register');

    expect(await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' })).toBeInTheDocument();
  });

  it('redirects unknown routes to the home page', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    renderApp('/does-not-exist');

    expect(await screen.findByRole('heading', { name: 'متجرك جاهز، أحمد' })).toBeInTheDocument();
  });
});
