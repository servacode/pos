import { vi } from 'vitest';

export interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

export interface MockReply {
  status: number;
  body?: unknown;
}

type Route = MockReply | ((request: MockRequest) => MockReply | Promise<MockReply>);

export function mockFetch(routes: Record<string, Route>) {
  const requests: MockRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request: MockRequest = {
      method: init.method ?? 'GET',
      path: String(input),
      headers: { ...(init.headers as Record<string, string> | undefined) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
    };
    requests.push(request);
    const route = routes[`${request.method} ${request.path}`];
    if (!route) throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    const reply = typeof route === 'function' ? await route(request) : route;
    const body = reply.body === undefined ? null : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    requests,
    requestsTo: (method: string, path: string) =>
      requests.filter((r) => r.method === method && r.path === path),
  };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): MockReply {
  return { status, body: { error: { code, message, ...(fields ? { fields } : {}) } } };
}
