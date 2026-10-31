import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDeviceStore } from '../offline/database';
import { apiError, mockFetch } from '../test/fetchMock';
import { signedOutRefresh } from '../test/fixtures';
import { renderApp } from '../test/renderApp';
import { apiFetch } from './api';
import { setTestMode, TEST_MODE_HEADER } from './testMode';

const RIBBON = 'نسخة تجربة على الخادم المحلي';
const marked = { ...signedOutRefresh, headers: { [TEST_MODE_HEADER]: '1' } };

afterEach(async () => {
  localStorage.clear();
  await resetDeviceStore();
});

describe('test-mode ribbon', () => {
  it('appears on every page once an API answer carries the test-mode mark', async () => {
    mockFetch({ 'POST /v1/auth/refresh': marked });
    renderApp('/register');

    await screen.findByRole('heading', { name: 'افتح متجرك خلال دقيقة' });
    expect(screen.getByRole('note')).toHaveTextContent(RIBBON);
  });

  it('is absent on a normal server', async () => {
    mockFetch({ 'POST /v1/auth/refresh': signedOutRefresh });
    renderApp('/login');

    await screen.findByRole('heading', { name: 'أهلاً بعودتك' });
    expect(screen.queryByText(RIBBON)).not.toBeInTheDocument();
  });

  it('is remembered for the cashier, which opens without any request', async () => {
    mockFetch({ 'POST /v1/auth/refresh': marked });
    renderApp('/login');
    await screen.findByText(RIBBON);
    expect(localStorage.getItem('serva.testMode')).toBe('1');
  });

  it('shows on the cashier from what the device remembers, with no request', async () => {
    setTestMode(true);
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchSpy);
    renderApp('/pos');

    expect(await screen.findByText(RIBBON)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('goes away when the server answers without the mark, but not on a proxy error', async () => {
    mockFetch({ 'POST /v1/auth/refresh': marked });
    renderApp('/login');
    await screen.findByText(RIBBON);

    mockFetch({
      'GET /v1/me': { status: 502 },
      'POST /v1/auth/login': apiError(401, 'invalid_credentials', 'رقم الجوال أو كلمة السر غير صحيحة.'),
    });
    await apiFetch('/v1/me').catch(() => {});
    expect(screen.getByText(RIBBON)).toBeInTheDocument();

    await apiFetch('/v1/auth/login', { method: 'POST', body: {} }).catch(() => {});
    await waitFor(() => expect(screen.queryByText(RIBBON)).not.toBeInTheDocument());
    expect(localStorage.getItem('serva.testMode')).toBeNull();
  });
});
