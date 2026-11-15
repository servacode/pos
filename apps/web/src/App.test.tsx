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

    expect(await screen.findByRole('heading', { name: 'أهلاً، أحمد' })).toBeInTheDocument();
  });

  it('says an unknown address does not exist, with the way home', async () => {
    mockFetch({
      'POST /v1/auth/refresh': signedInRefresh,
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    renderApp('/does-not-exist');

    expect(await screen.findByText('الصفحة غير موجودة')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'الصفحة الرئيسية' })).toHaveAttribute('href', '/');
  });

  it('sends a signed-out visitor of an unknown address to the login page', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/does-not-exist');

    expect(await screen.findByRole('heading', { name: 'أهلاً بعودتك' })).toBeInTheDocument();
  });

  it('opens the real shell at once from the session this tab kept, and confirms it in the background', async () => {
    sessionStorage.setItem('serva.me', JSON.stringify(makeMe()));
    let finishRefresh: (reply: MockReply) => void = () => {};
    mockFetch({
      'POST /v1/auth/refresh': () =>
        new Promise<MockReply>((resolve) => {
          finishRefresh = resolve;
        }),
      'GET /v1/me': { status: 200, body: makeMe() },
    });
    renderApp('/');

    // The refresh has not answered, and the page is already the person's own
    expect(await screen.findByRole('heading', { name: 'أهلاً، أحمد' })).toBeInTheDocument();
    finishRefresh(signedInRefresh);
    expect(screen.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeInTheDocument();
  });

  it('ends at the login page when the kept session turns out to be lost', async () => {
    sessionStorage.setItem('serva.me', JSON.stringify(makeMe()));
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'أهلاً بعودتك' })).toBeInTheDocument();
    expect(sessionStorage.getItem('serva.me')).toBeNull();
  });
});
