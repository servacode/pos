import type { StaffSessionInput, StaffSessionResponse } from '@serva/core';
import { APP_VERSION } from '../../offline/sync';

/** POST /v1/device/staff-sessions (`Authorization: Device <token>`): shapes from `@serva/core` (contracts/staff). */
export type { StaffSessionInput, StaffSessionResponse };

export type StaffSessionAnswer =
  | { kind: 'ok'; body: StaffSessionResponse }
  /** 401 pin_invalid */
  | { kind: 'invalid' }
  /** 429 locked: the server's lockout, retry after this many seconds */
  | { kind: 'locked'; retryAfterSeconds: number }
  /** Another refusal: not this branch's staff, a disabled user, a revoked device */
  | { kind: 'refused'; code: string | null }
  /** No answer, or a server error: the device checks offline instead */
  | { kind: 'network' };

export async function postStaffSession(
  input: StaffSessionInput,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<StaffSessionAnswer> {
  let res: Response;
  try {
    res = await fetchFn('/v1/device/staff-sessions', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Device ${token}`,
        'X-App-Version': APP_VERSION,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { kind: 'network' };
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; retryAfter?: number };
  } | null;
  if (res.ok)
    return body ? { kind: 'ok', body: body as unknown as StaffSessionResponse } : { kind: 'network' };
  if (res.status >= 500) return { kind: 'network' };
  const code = body?.error?.code ?? null;
  if (res.status === 401 && code === 'pin_invalid') return { kind: 'invalid' };
  if (res.status === 429) {
    const header = Number(res.headers.get('retry-after'));
    const seconds = body?.error?.retryAfter ?? (Number.isFinite(header) && header > 0 ? header : 60);
    return { kind: 'locked', retryAfterSeconds: seconds };
  }
  return { kind: 'refused', code };
}
