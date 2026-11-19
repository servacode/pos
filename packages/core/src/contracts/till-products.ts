import { z } from 'zod';
import { barcodeCodeSchema, MAX_PRICE_MINOR } from './catalog';
import { currencyCodeSchema, uuidSchema } from './common';
import { approvalSchema } from './documents';

/**
 * `temp_item`: «أضف صنف جديد» made at the till without a connection (round 38; docs/specs 03 › الكاشير). The till
 * names the product and its one variant itself (uuid v7), sells it at once under those ids and queues this document;
 * when it syncs the server writes the product under the same ids (so the sale line already points at the real product,
 * and a document sent twice creates one product), as «بانتظار المراجعة» (status temporary) like the online route.
 *
 * `actorId` is the user who holds catalog.manage in the till's branch (the signed-in cashier, or the manager whose
 * code was typed: then `approval` says who and whether the till was offline). The price is in the store's base
 * currency. A barcode another product took in the meantime is not a reason to lose the sale: the product is made
 * without it and the document is flagged `duplicate_barcode` for the owner to merge.
 */
export const tempItemPayloadSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema,
  actorId: uuidSchema,
  nameAr: z.string().trim().min(1).max(120),
  priceMinor: z.number().int().min(1).max(MAX_PRICE_MINOR),
  currency: currencyCodeSchema,
  categoryId: uuidSchema.nullable(),
  barcode: barcodeCodeSchema,
  approval: approvalSchema.nullable().default(null),
});
export type TempItemPayload = z.output<typeof tempItemPayloadSchema>;
