import type { Approval } from '@serva/core/contracts/documents';
import type { TillProductInput, TillProductPlaced } from '@serva/core/contracts/till';
import { PRICING_ENGINE_VERSION } from '@serva/core/pricing';
import { APP_VERSION } from '../../offline/sync';
import type { PosServices } from '../services';
import { forgetLocalProduct, rememberLocalProduct, type LocalProduct } from './localProducts';

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

/**
 * The same product when the server cannot be reached (round 38): the till gives it its ids itself, keeps it on the
 * device so the cashier sells it right away, and queues it as a `temp_item` document like any other offline document.
 * When it syncs the server writes it under those ids, so the sale line already points at the real product and a
 * document sent twice makes one product. The permission and manager-code rules were checked by the caller.
 */
export async function queueNewProduct(
  pos: PosServices,
  item: Omit<LocalProduct, 'docId'> & { actorId: string; approval: Approval | null },
  businessDate: string,
): Promise<void> {
  const { actorId, approval, ...product } = item;
  // Kept first: the save below makes the sale screen read the catalog again, and it must find it
  await rememberLocalProduct(pos.local, { ...product, docId: '' });
  try {
    const entry = await pos.save({
      type: 'temp_item',
      payload: { ...product, actorId, approval } satisfies Record<string, unknown>,
      businessDate,
      engineVersion: PRICING_ENGINE_VERSION,
    });
    await rememberLocalProduct(pos.local, { ...product, docId: entry.doc.id });
  } catch (error) {
    await forgetLocalProduct(pos.local, product.productId);
    throw error;
  }
}
