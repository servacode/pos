import type { ContractPriceForTill } from '@serva/core/contracts/contract-prices';
import type { MaintenanceContract } from '@serva/core/contracts/maintenance';
import type { Rental } from '@serva/core/contracts/rentals';
import { call } from '../alterations/api';

/** The cart's mark that its sale returns a rental: once the sale is saved the rental closes */
export interface ReturningRental {
  id: string;
  number: string;
  version: number;
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
