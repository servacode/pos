import { apiFetch } from '../lib/api';

const inFlight = new Map<string, Promise<unknown>>();

/**
 * A public GET shared while it is on its way: the same page asked for twice at once (the page
 * remounting, a dev build running effects twice) makes one request, and each asker gets the answer.
 * Nothing is kept once it lands, so the next visit asks again.
 */
export function getOnce<T>(path: string): Promise<T> {
  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T>;
  const request = apiFetch<T>(path).finally(() => inFlight.delete(path));
  inFlight.set(path, request);
  return request;
}
