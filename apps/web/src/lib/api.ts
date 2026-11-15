import type { ApiErrorBody, ErrorCode, RefreshResponse } from '@serva/core';
import { noteTestMode } from './testMode';

export const NETWORK_ERROR_MESSAGE = 'لا يوجد إنترنت الآن. تحقّق من الاتصال وحاول مرة أخرى.';
const UNEXPECTED_ERROR_MESSAGE = 'حدث خطأ غير متوقع. حاول مجدداً.';
const SERVER_ERROR_MESSAGE = 'الخادم مشغول حالياً. حاول بعد قليل.';
const RATE_LIMIT_MESSAGE = 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.';
const SESSION_EXPIRED_MESSAGE = 'انتهى دخولك. سجّل الدخول مرة أخرى.';

export type ApiErrorCode = ErrorCode | 'network_error' | 'unknown';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /**
   * A fixed Authorization header for a request outside the signed-in admin: the owner's token on a
   * cashier being linked, or `Activation <secret>` while it waits. No refresh is tried with it.
   */
  authorization?: string;
}

const REFRESH_PATH = '/v1/auth/refresh';

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const sessionExpiredListeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function expireSession(): void {
  accessToken = null;
  for (const listener of sessionExpiredListeners) listener();
}

async function send(
  path: string,
  method: string,
  body: unknown,
  token: string | null,
  authorization?: string,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (authorization) headers.Authorization = authorization;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'network_error', NETWORK_ERROR_MESSAGE);
  }
  noteTestMode(res);
  return res;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

function fallbackMessage(status: number): string {
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status >= 500) return SERVER_ERROR_MESSAGE;
  return UNEXPECTED_ERROR_MESSAGE;
}

async function toApiError(res: Response): Promise<ApiError> {
  const data = await readJson(res);
  if (isApiErrorBody(data)) {
    const { code, message, fields } = data.error;
    return new ApiError(res.status, code, message, fields);
  }
  return new ApiError(res.status, 'unknown', fallbackMessage(res.status));
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toApiError(res);
  return (await readJson(res)) as T;
}

/** The server answers 409 when another tab rotated the same refresh cookie a moment ago. */
const REFRESH_RACE_RETRIES = 3;
const REFRESH_RACE_WAIT_MS = 250;

async function refreshOnce(): Promise<string | null> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await send(REFRESH_PATH, 'POST', undefined, null);
    // 409: another tab refreshed with this cookie and already holds the new one. Not a lost
    // session: wait a moment and ask again, now with the cookie it set.
    if (res.status === 409 && attempt < REFRESH_RACE_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RACE_WAIT_MS * (attempt + 1)));
      continue;
    }
    // Only a real «no» (no cookie, expired or revoked session) ends the session. A busy server, a
    // rate limit or a race that outlasted its retries is a failed attempt: it throws, the caller
    // keeps the signed-in screen, and the next request asks again (this was the rare bounce).
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw await toApiError(res);
    const data = (await readJson(res)) as RefreshResponse | undefined;
    accessToken = data?.accessToken ?? null;
    return accessToken;
  }
}

/** One refresh at a time across the tabs of this browser (Web Locks), so two tabs never race. */
async function refreshAcrossTabs(): Promise<string | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return refreshOnce();
  return await locks.request('serva-refresh', refreshOnce);
}

/**
 * Asks for a new access token with the refresh cookie. One call at a time in this page (everyone
 * who asks while it runs gets the same answer), one at a time across tabs, and a 409 race is
 * retried rather than treated as a lost session. A network failure throws and does not sign out.
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= refreshAcrossTabs().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// The same signed-in read asked twice at once (a page and the shell, or React's double mount in
// development) shares one request; each asker gets the answer once it lands. Writes never share.
const readsInFlight = new Map<string, Promise<unknown>>();

export function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, authorization } = options;
  if (method !== 'GET' || body !== undefined || !auth || authorization) return apiFetchOnce<T>(path, options);
  const key = `${accessToken ?? ''}|${path}`;
  const running = readsInFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const request = apiFetchOnce<T>(path, options).finally(() => readsInFlight.delete(key));
  readsInFlight.set(key, request);
  return request;
}

async function apiFetchOnce<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const { method = 'GET', body, auth = false, authorization } = options;
  if (!auth) return parse<T>(await send(path, method, body, null, authorization));

  // The page is still getting its first token: join that refresh instead of sending a request
  // that is bound to be refused.
  if (!accessToken && refreshInFlight) await refreshInFlight.catch(() => null);
  const usedToken = accessToken;
  const first = await send(path, method, body, usedToken);
  if (first.status !== 401) return parse<T>(first);

  const freshToken = accessToken && accessToken !== usedToken ? accessToken : await refreshAccessToken();
  if (!freshToken) {
    expireSession();
    throw await toApiError(first);
  }

  const retry = await send(path, method, body, freshToken);
  if (retry.status === 401) expireSession();
  return parse<T>(retry);
}

/**
 * A binary download behind the sign-in (the store export): the same token and refresh handling as
 * apiFetch, the answer as a Blob with the file name the server suggested.
 */
export async function apiDownload(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const usedToken = accessToken;
  let res = await send(path, 'GET', undefined, usedToken);
  if (res.status === 401) {
    const freshToken = accessToken && accessToken !== usedToken ? accessToken : await refreshAccessToken();
    if (!freshToken) {
      expireSession();
      throw await toApiError(res);
    }
    res = await send(path, 'GET', undefined, freshToken);
    if (res.status === 401) expireSession();
  }
  if (!res.ok) throw await toApiError(res);
  const disposition = res.headers.get('content-disposition') ?? '';
  return { blob: await res.blob(), fileName: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null };
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : UNEXPECTED_ERROR_MESSAGE;
}
