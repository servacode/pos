import type { SaleLine } from '@serva/core/contracts/documents';
import type { Quotation, QuotationInput } from '@serva/core/contracts/quotations';
import { call, type Answer } from '../alterations/api';

/** The cart's mark that its sale turns a quotation into an invoice: once the sale is saved the quotation is marked converted */
export interface ConvertingQuotation {
  id: string;
  number: string;
  version: number;
}

/**
 * The cart's priced lines as a quotation: what the till shows is what is offered, so a line's
 * discount (a typed one or a running promotion) goes in as it was priced.
 */
export function quotationInputOf(
  lines: readonly SaleLine[],
  invoiceDiscount: { type: 'percent'; bp: number } | { type: 'amount'; minor: number } | null,
  customer: { id: string; name: string } | null,
  /** The name the cashier typed or the customer's, when no card is attached */
  customerName: string | null,
): QuotationInput {
  return {
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? customerName,
    invoiceDiscount,
    lines: lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      unitName: l.unitName,
      packQty: l.packQty,
      qty: l.qty,
      unitPriceMinor: l.unitPriceMinor,
      discount: l.discount
        ? l.discount.type === 'percent'
          ? { type: 'percent' as const, bp: l.discount.bp }
          : { type: 'amount' as const, minor: l.discount.minor }
        : null,
      taxRateId: l.taxRateId,
      taxRateBp: l.taxRateBp,
    })),
  };
}

/** POST /v1/device/quotations: the cart saved as a numbered quotation (needs the server) */
export const saveQuotation = (
  input: QuotationInput,
  token: string,
  fetchFn?: typeof fetch,
): Promise<Answer<Quotation>> => call<Quotation>('/v1/device/quotations', token, fetchFn, input);

export const openQuotations = (token: string, fetchFn?: typeof fetch) =>
  call<{ items: Quotation[] }>('/v1/device/quotations', token, fetchFn);

export const quotationById = (id: string, token: string, fetchFn?: typeof fetch) =>
  call<Quotation>(`/v1/device/quotations/${id}`, token, fetchFn);

/** Marks a quotation converted once the sale made from it is saved; false when the server did not answer */
export async function convertQuotation(
  q: ConvertingQuotation,
  token: string,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  const answer = await call<Quotation>(`/v1/device/quotations/${q.id}/convert`, token, fetchFn, {
    version: q.version,
  });
  return answer.kind === 'ok';
}
