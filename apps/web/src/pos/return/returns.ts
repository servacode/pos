import type { InvoiceLookup } from '@serva/core/contracts/till';
import type { ReturnPayload, SalePayload } from '@serva/core/contracts/documents';
import type { ReturnedLine } from '@serva/core/sale-return';
import { returnWindowDays } from '@serva/core/contracts/till';
import type { SettingsRow } from '@serva/core/contracts/catalog';
import type { OutboxEntry } from '@serva/sync';
import { APP_VERSION } from '../../offline/sync';
import { EXPIRY_SECTORS, storeSells } from '../../lib/sectors';

/** The days the till looks back for an invoice to return from: the store's setting, else by business type */
export const returnWindowOf = (settings: Pick<SettingsRow, 'till' | 'sectors'>): number =>
  returnWindowDays(settings.till, settings.sectors);

export interface ReturnableSale {
  id: string;
  number: string;
  deviceTime: string;
  sale: SalePayload;
  /** What returns saved on this till already took back from it */
  returned: ReturnedLine[];
}

/**
 * The invoices of this till within the window, newest first, each with what was returned from
 * it here. Another till's returns of the same invoice reach the server, which flags an
 * over-return; this till only knows its own (an invoice found on the server brings the count).
 */
export function returnableSales(
  entries: readonly OutboxEntry[],
  now: number,
  windowDays = 7,
): ReturnableSale[] {
  const since = now - windowDays * 86_400_000;
  const returned = new Map<string, ReturnedLine[]>();
  for (const { doc } of entries) {
    if (doc.type !== 'return') continue;
    const ret = doc.payload as unknown as ReturnPayload;
    const list = returned.get(ret.saleId) ?? [];
    for (const l of ret.lines) list.push({ saleLineNo: l.saleLineNo, qty: l.qty, ...l.refund });
    returned.set(ret.saleId, list);
  }
  return entries
    .filter((e) => e.doc.type === 'sale' && e.doc.number && Date.parse(e.doc.deviceTime) >= since)
    .map((e) => ({
      id: e.doc.id,
      number: e.doc.number!,
      deviceTime: e.doc.deviceTime,
      sale: e.doc.payload as unknown as SalePayload,
      returned: returned.get(e.doc.id) ?? [],
    }))
    .sort((a, b) => b.deviceTime.localeCompare(a.deviceTime));
}

/**
 * An invoice the server found (sold on any till of the store), or null when it is outside the
 * window. What this till returned from it in the meantime and the server has not seen yet is added.
 */
export function saleFromServer(
  found: InvoiceLookup,
  entries: readonly OutboxEntry[],
  now: number,
  windowDays: number,
): ReturnableSale | null {
  if (Date.parse(found.deviceTime) < now - windowDays * 86_400_000) return null;
  const here = returnableSales(entries, now, 3650).find((s) => s.id === found.id);
  // The server's count includes this till's synced returns; take the larger, never both
  const own = here?.returned.reduce((n, r) => n + r.qty, 0) ?? 0;
  const theirs = found.returned.reduce((n, r) => n + r.qty, 0);
  return {
    id: found.id,
    number: found.number,
    deviceTime: found.deviceTime,
    sale: found.payload as SalePayload,
    returned: own > theirs && here ? here.returned : found.returned,
  };
}

/** Matches the typed number by its end, as printed on the receipt («154» finds …-0000154) */
export function matchesNumber(number: string, typed: string): boolean {
  const digits = typed.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  if (!digits) return true;
  return number.replace(/\D/g, '').endsWith(digits) || number.includes(typed.trim());
}

const FASHION_REASONS = ['المقاس غير مناسب', 'عيب في القطعة', 'لم يعجب الزبون', 'تبديل'] as const;

/**
 * Why a piece comes back, by what the store sells: a clothes shop talks about sizes and defects, a
 * grocery about expiry. «تالف أو منتهي الصلاحية» is the default only where expiry applies; a store with no
 * business type set gets the general list.
 */
export function returnReasons(sectors: SettingsRow['sectors']): string[] {
  const fashion = sectors !== undefined && sectors.includes('clothing');
  const expiry = storeSells(sectors, EXPIRY_SECTORS);
  if (!fashion) return ['تالف أو منتهي الصلاحية', 'الزبون غيّر رأيه', 'تبديل', 'خطأ في الفاتورة'];
  return [...FASHION_REASONS, ...(expiry ? ['تالف أو منتهي الصلاحية'] : []), 'خطأ في الفاتورة'];
}

export type InvoiceSearch = { found: InvoiceLookup } | { found: null; reason: 'missing' | 'offline' };

/**
 * GET /v1/device/invoices/lookup (`Authorization: Device <token>`): finds an invoice of any till of
 * the store by its number or its receipt's barcode. `offline` when there is no answer at all.
 */
export async function searchInvoice(
  q: string,
  token: string,
  fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<InvoiceSearch> {
  try {
    const res = await fetchFn(`/v1/device/invoices/lookup?q=${encodeURIComponent(q.trim())}`, {
      headers: { Accept: 'application/json', Authorization: `Device ${token}`, 'X-App-Version': APP_VERSION },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404) return { found: null, reason: 'missing' };
    if (!res.ok) return { found: null, reason: 'offline' };
    return { found: (await res.json()) as InvoiceLookup };
  } catch {
    return { found: null, reason: 'offline' };
  }
}
