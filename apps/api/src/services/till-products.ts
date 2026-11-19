import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  createProductInput,
  type CurrencyCode,
  type tillProductInput,
  type TillProductPlaced,
} from '@serva/core';
import { products, roles, userRoles, users, withTenant, type Database, type Transaction } from '@serva/db';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { barcodeConflict, createProductTx } from './catalog/products';

/**
 * «أضف صنف جديد» at the till (round 37, decision 15; contracts/till.ts tillProductInput). The product is
 * written by the product API's own function (createProductTx), so its rules, its barcode check and its audit
 * entry are the ones every product has. What this adds is only who may do it from a till: a user who holds
 * catalog.manage in the till's branch, named by the till (the signed-in user, or the manager whose code was
 * typed there, checked by the till as every manager approval is). The product is made «temporary»: it sells
 * at once at the tills and waits for the owner's review, and stays out of the online shop until then.
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

export function createTillProduct(
  db: Database,
  device: DeviceClaims,
  input: z.output<typeof tillProductInput>,
  now: Date,
  meta: RequestMeta,
): Promise<TillProductPlaced> {
  return withTenant(db, device.tenantId, async (tx) => {
    if (!(await mayManageCatalog(tx, input.actorId, device.branchId))) throw forbiddenHere();
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings where tenant_id = ${device.tenantId}`,
    );
    const base = (settings?.base ?? 'SYP') as CurrencyCode;
    const data = createProductInput.parse({
      nameAr: input.nameAr,
      categoryId: input.categoryId,
      variants: [
        {
          price: { currency: base, priceMinor: input.priceMinor },
          barcodes: [{ kind: 'standard', code: input.barcode }],
        },
      ],
    });
    let detail;
    try {
      detail = await createProductTx(tx, data, {
        auth: { userId: input.actorId, tenantId: device.tenantId, sessionId: device.deviceId },
        now,
        meta,
      });
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
        data: { nameAr: input.nameAr, barcode: input.barcode, branchId: device.branchId },
      },
      meta,
    );
    return {
      productId: detail.id,
      variantId: detail.variants[0]!.id,
      nameAr: detail.nameAr,
      barcode: input.barcode,
    };
  });
}
