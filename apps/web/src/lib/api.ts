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

export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await send(REFRESH_PATH, 'POST', undefined, null);
      if (!res.ok) return null;
      const data = (await readJson(res)) as RefreshResponse | undefined;
      accessToken = data?.accessToken ?? null;
      return accessToken;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, authorization } = options;
  if (!auth) return parse<T>(await send(path, method, body, null, authorization));

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

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : UNEXPECTED_ERROR_MESSAGE;
}
