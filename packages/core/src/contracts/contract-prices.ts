import { z } from 'zod';
import type { CurrencyCode } from '../currencies';
import { isoDateSchema, nonNegativeMinorSchema, uuidSchema, versionSchema } from './common';
import { CUSTOMER_KINDS, type CustomerKind } from './customers';

/**
 * Contract prices (03 › الأدوات الطبية: أسعار العقود): what a customer, or every customer of one
 * type («مشفى»), pays for a product between two days, in place of the shelf price. The till asks for
 * the customer's prices when it picks them and prices the lines with them; a price for the customer
 * wins over one for their type. Prices are per base unit; a pack multiplies.
 *
 *   GET    /v1/contract-prices?customerId=&kind=&variantId=   → { items: ContractPrice[] } (catalog.manage)
 *   POST   /v1/contract-prices                                 contractPriceInput → ContractPrice (201)
 *   PUT    /v1/contract-prices/{id}                            contractPriceUpdateInput → ContractPrice
 *   DELETE /v1/contract-prices/{id}
 *   GET    /v1/device/contract-prices?customerId=              → { items: ContractPriceForTill[] } (Device)
 */

export const contractPriceInput = z
  .object({
    customerId: uuidSchema.nullable().optional(),
    customerKind: z.enum(CUSTOMER_KINDS).nullable().optional(),
    variantId: uuidSchema,
    priceMinor: nonNegativeMinorSchema,
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((t) => Boolean(t.customerId) !== Boolean(t.customerKind), {
    path: ['customerId'],
    message: 'اختر زبوناً واحداً أو نوع زبائن، لا الاثنين معاً',
  })
  .refine((t) => !t.validTo || t.validTo >= t.validFrom, {
    path: ['validTo'],
    message: 'تاريخ النهاية قبل البداية',
  });
export type ContractPriceInput = z.input<typeof contractPriceInput>;

export const contractPriceUpdateInput = z.object({ version: versionSchema }).and(contractPriceInput);

export const contractPriceListQuery = z.object({
  customerId: uuidSchema.optional(),
  kind: z.enum(CUSTOMER_KINDS).optional(),
  variantId: uuidSchema.optional(),
});

export const tillContractPriceQuery = z.object({ customerId: uuidSchema });

export interface ContractPrice {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerKind: CustomerKind | null;
  variantId: string;
  item: string;
  currency: CurrencyCode;
  priceMinor: number;
  validFrom: string;
  validTo: string | null;
  note: string | null;
  version: number;
}

/** One price the till uses for the customer today */
export interface ContractPriceForTill {
  variantId: string;
  currency: CurrencyCode;
  priceMinor: number;
}
