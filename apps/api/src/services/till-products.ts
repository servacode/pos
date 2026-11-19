import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  createProductInput,
  tempItemPayloadSchema,
  type CurrencyCode,
  type tillProductInput,
  type TillProductPlaced,
} from '@serva/core';
import {
  barcodes,
  products,
  roles,
  userRoles,
  users,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import type { SyncFlag } from '@serva/sync';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { barcodeConflict, createProductTx } from './catalog/products';
import { DocumentRejection, type DocumentContext } from './sync-push';

/**
 * «أضف صنف جديد» at the till (round 37, decision 15; contracts/till.ts tillProductInput). The product is
 * written by the product API's own function (createProductTx), so its rules, its barcode check and its audit
 * entry are the ones every product has. What this adds is only who may do it from a till: a user who holds
 * catalog.manage in the till's branch, named by the till (the signed-in user, or the manager whose code was
 * typed there, checked by the till as every manager approval is). The product is made «temporary»: it sells
 * at once at the tills and waits for the owner's review, and stays out of the online shop until then.
 *
 * Round 38: a till with no connection makes the product itself, under ids it chose, sells it at once and queues a
 * `temp_item` document (contracts/till-products.ts). Both ways end in the same function (placeProduct), so a product
 * is written once however many times it is asked for.
 */

const forbiddenHere = () =>
  new AppError(403, 'forbidden', 'لا تملك صلاحية إضافة أصناف. اطلب رمز مدير أو اطلب من المالك.');

/** Active, and holding catalog.manage by a role of every branch or of this one */
async function mayManageCatalog(tx: Transaction, userId: string, branchId: string): Promise<boolean> {
  const rows = await tx
    .select({ permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.status, 'active')))
    .where(
      and(eq(userRoles.userId, userId), or(isNull(userRoles.branchId), eq(userRoles.branchId, branchId))),
    );
  return rows.some((r) => r.permissions.includes('catalog.manage'));
}

interface Placing {
  actorId: string;
  nameAr: string;
  priceMinor: number;
  categoryId: string | null;
  barcode: string;
  /** The ids the till sells it under; left out, the database gives them */
  productId?: string | undefined;
  variantId?: string | undefined;
}

/**
 * Writes the product, with its one variant, its price and its barcode, by the product API's own function, and marks
 * it «بانتظار المراجعة». With a product id it first looks for the product under that id: one that exists is the
 * answer and nothing is written (a retry, or a document sent twice, makes no duplicate). `dropTakenBarcode` (a
 * document from a till that was offline) makes the product without a barcode some other product holds now, rather
 * than refuse a sale that was already made.
 */
async function placeProduct(
  tx: Transaction,
  device: DeviceClaims,
  input: Placing,
  now: Date,
  meta: RequestMeta,
  options: { dropTakenBarcode: boolean; offline: boolean },
): Promise<{ placed: TillProductPlaced; created: boolean; barcodeDropped: boolean }> {
  if (input.productId) {
    const [known] = await tx
      .select({ id: products.id, nameAr: products.nameAr, variantId: variants.id })
      .from(products)
      .innerJoin(variants, eq(variants.productId, products.id))
      .where(eq(products.id, input.productId))
      .orderBy(variants.sortOrder)
      .limit(1);
    if (known) {
      const [code] = await tx
        .select({ code: barcodes.code })
        .from(barcodes)
        .where(eq(barcodes.variantId, known.variantId))
        .limit(1);
      return {
        placed: {
          productId: known.id,
          variantId: known.variantId,
          nameAr: known.nameAr,
          barcode: code?.code ?? input.barcode,
        },
        created: false,
        barcodeDropped: false,
      };
    }
  }
  const [settings] = await tx.execute<{ base: string }>(
    sql`select base_currency as base from tenant_settings where tenant_id = ${device.tenantId}`,
  );
  const base = (settings?.base ?? 'SYP') as CurrencyCode;
  let barcodeDropped = false;
  if (options.dropTakenBarcode) {
    const [taken] = await tx
      .select({ id: barcodes.id })
      .from(barcodes)
      .where(eq(barcodes.code, input.barcode))
      .limit(1);
    barcodeDropped = Boolean(taken);
  }
  const data = createProductInput.parse({
    nameAr: input.nameAr,
    categoryId: input.categoryId,
    variants: [
      {
        price: { currency: base, priceMinor: input.priceMinor },
        barcodes: barcodeDropped ? [] : [{ kind: 'standard', code: input.barcode }],
      },
    ],
  });
  let detail;
  try {
    detail = await createProductTx(
      tx,
      data,
      { auth: { userId: input.actorId, tenantId: device.tenantId, sessionId: device.deviceId }, now, meta },
      input.productId
        ? { productId: input.productId, variantIds: input.variantId ? [input.variantId] : [] }
        : undefined,
    );
  } catch (error) {
    if (isUniqueViolation(error, 'barcodes_code_unique')) throw barcodeConflict();
    throw error;
  }
  await tx.update(products).set({ status: 'temporary' }).where(eq(products.id, detail.id));
  await audit(
    tx,
    {
      tenantId: device.tenantId,
      userId: input.actorId,
      actorType: 'device',
      action: 'product.created_at_till',
      entity: 'product',
      entityId: detail.id,
      deviceId: device.deviceId,
      data: {
        nameAr: input.nameAr,
        barcode: input.barcode,
        branchId: device.branchId,
        ...(options.offline ? { offline: true, barcodeDropped } : {}),
      },
    },
    meta,
  );
  return {
    placed: {
      productId: detail.id,
      variantId: detail.variants[0]!.id,
      nameAr: detail.nameAr,
      barcode: input.barcode,
    },
    created: true,
    barcodeDropped,
  };
}

export function createTillProduct(
  db: Database,
  device: DeviceClaims,
  input: z.output<typeof tillProductInput>,
  now: Date,
  meta: RequestMeta,
): Promise<TillProductPlaced> {
  return withTenant(db, device.tenantId, async (tx) => {
    if (!(await mayManageCatalog(tx, input.actorId, device.branchId))) throw forbiddenHere();
    const { placed } = await placeProduct(tx, device, input, now, meta, {
      dropTakenBarcode: false,
      offline: false,
    });
    return placed;
  });
}

/**
 * `temp_item` (contracts/till-products.ts): a product the till made without a connection, and has sold under its
 * own ids already. It is written once under those ids, however many times the document arrives. The rules of the
 * online route hold: only a user who holds catalog.manage makes a product. A till that was right when it asked and
 * stale when it synced (the permission was taken away meanwhile) is accepted and flagged `permission_stale`, as every
 * offline document is, because the sale has been made; a person the store does not know is refused.
 */
export async function processTempItem({
  tx,
  device,
  doc,
  now,
}: DocumentContext): Promise<{ flags: SyncFlag[] }> {
  const parsed = tempItemPayloadSchema.safeParse(doc.payload);
  if (!parsed.success) throw new DocumentRejection('invalid_payload');
  const p = parsed.data;
  const [actor] = await tx.select({ id: users.id }).from(users).where(eq(users.id, p.actorId));
  if (!actor) throw new DocumentRejection('actor_unknown');
  const flags: SyncFlag[] = [];
  if (!(await mayManageCatalog(tx, p.actorId, device.branchId))) flags.push('permission_stale');
  if (p.approval?.offline) flags.push('approval_offline');
  const { barcodeDropped } = await placeProduct(
    tx,
    device,
    p,
    now,
    { ip: '', userAgent: null },
    { dropTakenBarcode: true, offline: true },
  );
  if (barcodeDropped) flags.push('duplicate_barcode');
  return { flags };
}
