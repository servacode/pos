import type { SectorKey } from '@serva/core';
import type { TillSettings, TillWasteInput } from '@serva/core/contracts/till';
import type { StocktakeDetail } from '@serva/core/contracts/purchases';
import { APP_VERSION } from '../../offline/sync';

/** Stores that throw away what spoils: the till shows «تالف / هدر» for them (any store, once it set its reasons) */
const WASTE_SECTORS: readonly SectorKey[] = [
  'supermarket',
  'bakery',
  'produce',
  'restaurant',
  'cafe',
  'general',
];

export const showsWaste = (
  sectors: readonly SectorKey[] | undefined,
  till: TillSettings | null | undefined,
) => (till?.wasteReasons?.length ?? 0) > 0 || (sectors ?? []).some((s) => WASTE_SECTORS.includes(s));

export type WasteAnswer =
  | { kind: 'ok'; body: StocktakeDetail }
  /** Refused, with the server's words (not enough on the shelf, no permission…) */
  | { kind: 'refused'; message: string }
  /** No answer: it may or may not have reached the server; sending the same id again is safe */
  | { kind: 'network' };

/** POST /v1/device/waste (`Authorization: Device <token>`): the write-off, through the store's stock count */
export async function postWaste(
  input: TillWasteInput,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<WasteAnswer> {
  let res: Response;
  try {
    res = await fetchFn('/v1/device/waste', {
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
    (StocktakeDetail & { error?: { message?: string; fields?: Record<string, string> } }) | null;
  if (res.ok && body) return { kind: 'ok', body };
  if (res.status >= 500 || !body) return { kind: 'network' };
  const fields = Object.values(body.error?.fields ?? {});
  return { kind: 'refused', message: fields[0] ?? body.error?.message ?? 'رُفض تسجيل التالف.' };
}

/** What the cashier typed as a quantity, in thousandths; null while it is not a quantity above zero */
export function wasteQtyOf(text: string, allowsFraction: boolean): number | null {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
  const pattern = allowsFraction ? /^\d{1,6}(\.\d{1,3})?$/ : /^\d{1,6}$/;
  if (!pattern.test(clean)) return null;
  const qty = Math.round(Number(clean) * 1000);
  return qty > 0 ? qty : null;
}
