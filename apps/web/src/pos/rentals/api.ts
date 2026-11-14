import type { Approval, ReturnPayload, SalePayload } from '@serva/core/contracts/documents';
import { buildReturnPayload } from '@serva/core/sale-return';
import type { ContractPriceForTill } from '@serva/core/contracts/contract-prices';
import type { MaintenanceContract } from '@serva/core/contracts/maintenance';
import type { Rental } from '@serva/core/contracts/rentals';
import { call } from '../alterations/api';

/** The cart's mark that its sale returns a rental: once the sale is saved the rental closes */
export interface ReturningRental {
  id: string;
  number: string;
  version: number;
  /** The deposit left after the rent, handed back in cash with this sale; absent: it stays on the voucher */
  cashBackMinor?: number;
  /** A manager's code, when the cashier cannot refund by themselves */
  cashBackApproval?: Approval;
}

/** The cart's mark that its sale bills a maintenance contract */
export interface BillingContract {
  id: string;
  number: string;
  version: number;
}

/** Closes a rental once the sale of its rent is saved; false when the server did not answer */
export async function returnRental(
  r: ReturningRental,
  token: string,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  const answer = await call<Rental>(`/v1/device/rentals/${r.id}/return`, token, fetchFn, {
    version: r.version,
  });
  return answer.kind === 'ok';
}

/** Marks a maintenance contract billed once the sale of its price is saved */
export async function markContractBilled(
  c: BillingContract,
  token: string,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  const answer = await call<MaintenanceContract>(`/v1/device/maintenance/${c.id}/billed`, token, fetchFn, {
    version: c.version,
  });
  return answer.kind === 'ok';
}

/** The customer's contract prices in force today; empty when the server cannot be reached */
export async function fetchContractPrices(
  customerId: string,
  token: string,
  fetchFn?: typeof fetch,
): Promise<ContractPriceForTill[]> {
  const answer = await call<{ items: ContractPriceForTill[] }>(
    `/v1/device/contract-prices?customerId=${encodeURIComponent(customerId)}`,
    token,
    fetchFn,
  );
  return answer.kind === 'ok' ? answer.body.items : [];
}

/**
 * The line that hands the unspent deposit back (03 › التأجير). The rental's sale has two lines:
 * the rent, and this one for what is left of the deposit; the voucher pays both exactly. Once the
 * sale is saved this line is returned for cash, so the customer gets the rest in hand and 2310
 * comes down: only a sale and a return are posted, both existing documents.
 */
export const DEPOSIT_BACK_NAME = 'ردّ العربون';

/** What of the deposit is left after the rent; 0 when nothing is */
export function depositLeft(rental: Pick<Rental, 'depositMinor' | 'chargeMinor' | 'depositVoucher'>): number {
  return rental.depositVoucher ? Math.max(0, rental.depositMinor - rental.chargeMinor) : 0;
}

/**
 * The return of the deposit line of the rental sale just saved, paid in cash from the drawer.
 * Null when the sale has no such line (it was edited away).
 */
export function depositBackReturn(input: {
  sale: { id: string; number: string; payload: Record<string, unknown> };
  shiftId: string;
  cashierId: string;
  approval?: Approval | null;
}): ReturnPayload | null {
  const payload = input.sale.payload as unknown as SalePayload;
  const line = payload.lines.find((l) => l.name.startsWith(DEPOSIT_BACK_NAME));
  if (!line) return null;
  return buildReturnPayload({
    sale: payload,
    saleId: input.sale.id,
    saleNumber: input.sale.number,
    shiftId: input.shiftId,
    cashierId: input.cashierId,
    reason: 'ردّ باقي عربون التأجير',
    picks: [{ saleLineNo: line.lineNo, qty: line.qty }],
    refundMethod: 'cash',
    approval: input.approval ?? null,
  });
}
