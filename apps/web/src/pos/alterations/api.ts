import type { AlterationTicket } from '@serva/core/contracts/alterations';
import { APP_VERSION } from '../../offline/sync';

/** The cart's mark that its sale delivers a ticket: when the sale is saved the ticket is marked delivered */
export interface DeliveringTicket {
  id: string;
  number: string;
  version: number;
}

export type Answer<T> = { kind: 'ok'; body: T } | { kind: 'refused'; message: string } | { kind: 'network' };

/** The till's calls for alteration tickets (`Authorization: Device <token>`); they need the server */
export async function call<T>(
  path: string,
  token: string,
  fetchFn: typeof fetch | undefined,
  body?: unknown,
): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await (fetchFn ?? globalThis.fetch)(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Device ${token}`,
        'X-App-Version': APP_VERSION,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { kind: 'network' };
  }
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string; fields?: Record<string, string> } }) | null;
  if (res.ok && json) return { kind: 'ok', body: json };
  if (res.status >= 500 || !json) return { kind: 'network' };
  const fields = Object.values(json.error?.fields ?? {});
  return { kind: 'refused', message: fields[0] ?? json.error?.message ?? 'رُفض الطلب.' };
}

/** Marks a ticket delivered once the sale of its fee is saved; false when the server did not answer */
export async function deliverTicket(
  d: DeliveringTicket,
  token: string,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  const answer = await call<AlterationTicket>(`/v1/device/alterations/${d.id}/status`, token, fetchFn, {
    status: 'delivered',
    version: d.version,
  });
  return answer.kind === 'ok';
}
