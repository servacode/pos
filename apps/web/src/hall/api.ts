import type {
  HallCommand,
  HallCommandResponse,
  HallMenuResponse,
  HallResponse,
  KitchenCommand,
  KitchenResponse,
} from '@serva/core';
import { APP_VERSION } from '../offline/sync';

/** What a screen of the hall gets back: the answer, a refusal with its Arabic message, or no network. */
export type HallAnswer<T> =
  | { kind: 'ok'; body: T }
  | { kind: 'refused'; message: string; code: string | null; status: number; retryAfterSeconds?: number }
  | { kind: 'network' };

/** The device's calls for the hall and the kitchen (`Authorization: Device <token>`). */
export interface HallApi {
  hall(): Promise<HallAnswer<HallResponse>>;
  command(command: HallCommand): Promise<HallAnswer<HallCommandResponse>>;
  kitchen(): Promise<HallAnswer<KitchenResponse>>;
  kitchenCommand(command: KitchenCommand): Promise<HallAnswer<KitchenResponse>>;
  menu(): Promise<HallAnswer<HallMenuResponse>>;
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string>; retryAfter?: number };
}

async function call<T>(
  path: string,
  token: string,
  fetchFn: typeof fetch,
  body?: unknown,
): Promise<HallAnswer<T>> {
  let res: Response;
  try {
    res = await fetchFn(path, {
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
  const json = (await res.json().catch(() => null)) as (T & ErrorBody) | null;
  if (res.ok && json) return { kind: 'ok', body: json };
  if (res.status >= 500 || !json) return { kind: 'network' };
  const fields = Object.values(json.error?.fields ?? {});
  return {
    kind: 'refused',
    message: fields[0] ?? json.error?.message ?? 'رُفض الطلب.',
    code: json.error?.code ?? null,
    status: res.status,
    ...(json.error?.retryAfter ? { retryAfterSeconds: json.error.retryAfter } : {}),
  };
}

export function createHallApi(
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): HallApi {
  return {
    hall: () => call<HallResponse>('/v1/device/hall', token, fetchFn),
    command: (command) => call<HallCommandResponse>('/v1/device/hall', token, fetchFn, command),
    kitchen: () => call<KitchenResponse>('/v1/device/kitchen', token, fetchFn),
    kitchenCommand: (command) => call<KitchenResponse>('/v1/device/kitchen', token, fetchFn, command),
    menu: () => call<HallMenuResponse>('/v1/device/menu', token, fetchFn),
  };
}
