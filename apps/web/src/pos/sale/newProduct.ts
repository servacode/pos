import type { TillProductInput, TillProductPlaced } from '@serva/core/contracts/till';
import { APP_VERSION } from '../../offline/sync';

export type NewProductAnswer =
  | { kind: 'ok'; body: TillProductPlaced }
  /** Refused, with the server's words (a barcode already used, no permission, a wrong category…) */
  | { kind: 'refused'; message: string }
  /** No answer: adding a product needs the server */
  | { kind: 'network' };

/** POST /v1/device/products (`Authorization: Device <token>`): the unknown barcode becomes a product (decision 15) */
export async function postNewProduct(
  input: TillProductInput,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<NewProductAnswer> {
  let res: Response;
  try {
    res = await fetchFn('/v1/device/products', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Device ${token}`,
        'X-App-Version': APP_VERSION,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { kind: 'network' };
  }
  const body = (await res.json().catch(() => null)) as
    (TillProductPlaced & { error?: { message?: string; fields?: Record<string, string> } }) | null;
  if (res.ok && body) return { kind: 'ok', body };
  if (res.status >= 500 || !body) return { kind: 'network' };
  const fields = Object.values(body.error?.fields ?? {});
  return { kind: 'refused', message: fields[0] ?? body.error?.message ?? 'رُفض إضافة الصنف.' };
}
