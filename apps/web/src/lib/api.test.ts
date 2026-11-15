import { describe, expect, it, vi } from 'vitest';
import { apiError, mockFetch, type MockRequest } from '../test/fetchMock';
import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  apiFetch,
  getAccessToken,
  onSessionExpired,
  refreshAccessToken,
  setAccessToken,
} from './api';

const unauthorized = apiError(401, 'unauthorized', 'انتهت صلاحية الدخول');

function meRoute(validToken: string) {
  return (request: MockRequest) =>
    request.headers.Authorization === `Bearer ${validToken}`
      ? { status: 200, body: { ok: true } }
      : unauthorized;
}

describe('apiFetch', () => {
  it('sends a fixed Authorization header as given, and never refreshes on its 401', async () => {
    setAccessToken('admin-token');
    const { requestsTo } = mockFetch({
      'GET /v1/devices/activations/a1': unauthorized,
      'POST /v1/auth/refresh': { status: 200, body: { accessToken: 'x', expiresIn: 900 } },
    });

    await expect(
      apiFetch('/v1/devices/activations/a1', { authorization: 'Activation sda_secret' }),
    ).rejects.toMatchObject({ status: 401 });

    expect(requestsTo('GET', '/v1/devices/activations/a1')[0]!.headers.Authorization).toBe(
      'Activation sda_secret',
    );
    expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(0);
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('stale');
    const { requests, requestsTo } = mockFetch({
      'GET /v1/me': meRoute('fresh'),
      'POST /v1/auth/refresh': { status: 200, body: { accessToken: 'fresh', expiresIn: 900 } },
    });

    await expect(apiFetch('/v1/me', { auth: true })).resolves.toEqual({ ok: true });

    expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(1);
    expect(requestsTo('GET', '/v1/me').map((r) => r.headers.Authorization)).toEqual([
      'Bearer stale',
      'Bearer fresh',
    ]);
    expect(requests.every((r) => r.credentials === 'include')).toBe(true);
    expect(getAccessToken()).toBe('fresh');
  });

  it('shares a single refresh between concurrent 401s', async () => {
    setAccessToken('stale');
    const { requestsTo } = mockFetch({
      'GET /v1/me': meRoute('fresh'),
      'GET /v1/branches': meRoute('fresh'),
      'POST /v1/auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 200, body: { accessToken: 'fresh', expiresIn: 900 } };
      },
    });

    await Promise.all([apiFetch('/v1/me', { auth: true }), apiFetch('/v1/branches', { auth: true })]);

    expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(1);
  });

  it('signs out when the refresh is rejected', async () => {
    setAccessToken('stale');
    const signOut = vi.fn();
    const unsubscribe = onSessionExpired(signOut);
    const { requestsTo } = mockFetch({
      'GET /v1/me': unauthorized,
      'POST /v1/auth/refresh': unauthorized,
    });

    const error = await apiFetch('/v1/me', { auth: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    expect(requestsTo('GET', '/v1/me')).toHaveLength(1);
    unsubscribe();
  });

  it('does not refresh for public endpoints', async () => {
    const { requestsTo } = mockFetch({
      'POST /v1/auth/login': apiError(401, 'invalid_credentials', 'رقم الجوال أو كلمة المرور غير صحيحة'),
    });

    await expect(
      apiFetch('/v1/auth/login', { method: 'POST', body: { phone: '+963912345678', password: 'x' } }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(0);
  });

  it('turns an ApiErrorBody into an ApiError with fields', async () => {
    mockFetch({
      'POST /v1/auth/register': apiError(409, 'phone_taken', 'هذا الرقم مسجّل', { phone: 'هذا الرقم مسجّل' }),
    });

    await expect(apiFetch('/v1/auth/register', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 409,
      code: 'phone_taken',
      message: 'هذا الرقم مسجّل',
      fields: { phone: 'هذا الرقم مسجّل' },
    });
  });

  it('reports network failures with a friendly Arabic message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiFetch('/health')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it('treats a 409 from the refresh as another tab winning the race, and asks again', async () => {
    setAccessToken('stale');
    let asked = 0;
    const { requestsTo } = mockFetch({
      'GET /v1/me': meRoute('fresh'),
      'POST /v1/auth/refresh': () => {
        asked += 1;
        return asked === 1
          ? apiError(409, 'conflict', 'جُدّد دخولك للتو من نافذة أخرى. أعد المحاولة.')
          : { status: 200, body: { accessToken: 'fresh', expiresIn: 900 } };
      },
    });
    const signOut = vi.fn();
    const unsubscribe = onSessionExpired(signOut);

    await expect(apiFetch('/v1/me', { auth: true })).resolves.toEqual({ ok: true });

    expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(2);
    expect(signOut).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('makes a request that has no token yet wait for the refresh already running', async () => {
    setAccessToken(null);
    const { requestsTo } = mockFetch({
      'GET /v1/me': meRoute('fresh'),
      'POST /v1/auth/refresh': async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 200, body: { accessToken: 'fresh', expiresIn: 900 } };
      },
    });

    const boot = refreshAccessToken();
    await expect(apiFetch('/v1/me', { auth: true })).resolves.toEqual({ ok: true });
    await boot;

    // No request was sent with an empty token, and only one refresh ran
    expect(requestsTo('GET', '/v1/me').map((r) => r.headers.Authorization)).toEqual(['Bearer fresh']);
    expect(requestsTo('POST', '/v1/auth/refresh')).toHaveLength(1);
  });

  it('does not sign out when the refresh fails for want of a connection', async () => {
    setAccessToken('stale');
    const signOut = vi.fn();
    const unsubscribe = onSessionExpired(signOut);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        if (init.method === 'POST') throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'x' } }), {
          status: 401,
        });
      }),
    );

    await expect(apiFetch('/v1/me', { auth: true })).rejects.toMatchObject({ code: 'network_error' });
    expect(signOut).not.toHaveBeenCalled();
    unsubscribe();
  });
});
