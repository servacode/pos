import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { CustomerKind, Promotion, PromotionData, PromotionKind, PromotionScope } from '@serva/core';
import {
  categories,
  products,
  promotions,
  variants,
  withTenant,
  type Database,
  type Transaction,
} from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { fieldError, staleVersion } from './catalog/common';

/**
 * Promotions (packages/core › contracts/promotions.ts): the owner's list, add and change. Tills
 * pull them (sync-pull › promotions) and apply them themselves; nothing here touches a sale.
 */

const codeTaken = () => fieldError('couponCode', 'هذا الكود لعرض آخر، اختر غيره');
const notFound = () => new AppError(404, 'not_found', 'هذا العرض غير موجود.');

type Row = typeof promotions.$inferSelect;

const view = (r: Row): Promotion => ({
  id: r.id,
  name: r.name,
  kind: r.kind as PromotionKind,
  percentBp: r.percentBp,
  buyQty: r.buyQty,
  getQty: r.getQty,
  scope: r.scope as PromotionScope,
  categoryIds: r.categoryIds,
  productIds: r.productIds,
  startsAt: r.startsAt?.toISOString() ?? null,
  endsAt: r.endsAt?.toISOString() ?? null,
  daysOfWeek: r.daysOfWeek,
  fromTime: r.fromTime,
  toTime: r.toTime,
  couponCode: r.couponCode,
  tiers: r.tiers ?? [],
  freeVariantId: r.freeVariantId,
  freeQty: r.freeQty,
  customerKinds: r.customerKinds as CustomerKind[],
  priceTiers: r.priceTiers as ('retail' | 'wholesale')[],
  repOnly: r.repOnly,
  archived: r.archivedAt !== null,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

/** Only the fields the kind and scope use are kept, so a stored row never carries a stale value. */
function columns(input: PromotionData, now: Date, archivedAt: Date | null) {
  return {
    name: input.name,
    kind: input.kind,
    percentBp: input.kind === 'percent' ? input.percentBp : null,
    buyQty: input.kind === 'buy_get' || input.kind === 'free_item' ? input.buyQty : null,
    getQty: input.kind === 'buy_get' ? input.getQty : null,
    scope: input.scope,
    categoryIds: input.scope === 'categories' ? [...new Set(input.categoryIds)] : [],
    productIds: input.scope === 'products' ? [...new Set(input.productIds)] : [],
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    daysOfWeek: [...new Set(input.daysOfWeek)].sort(),
    fromTime: input.fromTime,
    toTime: input.toTime,
    couponCode: input.couponCode ? input.couponCode.toUpperCase() : null,
    // Trade promotions: the fields of the other kinds are never kept
    tiers: input.kind === 'tiered' ? [...input.tiers].sort((a, b) => a.minQty - b.minQty) : null,
    freeVariantId: input.kind === 'free_item' ? input.freeVariantId : null,
    freeQty: input.kind === 'free_item' ? input.freeQty : null,
    customerKinds: [...new Set(input.customerKinds)].sort(),
    priceTiers: [...new Set(input.priceTiers)].sort(),
    repOnly: input.repOnly,
    archivedAt: input.archived ? (archivedAt ?? now) : null,
  };
}

/** Every category or product a promotion names is the store's own. */
async function checkTargets(tx: Transaction, input: PromotionData): Promise<void> {
  if (input.scope === 'categories') {
    const ids = [...new Set(input.categoryIds)];
    const found = await tx.select({ id: categories.id }).from(categories).where(inArray(categories.id, ids));
    if (found.length !== ids.length) throw fieldError('categoryIds', 'تصنيف غير موجود');
  }
  if (input.kind === 'free_item' && input.freeVariantId) {
    const [found] = await tx
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.id, input.freeVariantId))
      .limit(1);
    if (!found) throw fieldError('freeVariantId', 'الصنف المجاني غير موجود');
  }
  if (input.scope === 'products') {
    const ids = [...new Set(input.productIds)];
    const found = await tx.select({ id: products.id }).from(products).where(inArray(products.id, ids));
    if (found.length !== ids.length) throw fieldError('productIds', 'منتج غير موجود');
  }
}

/** A code opens one offer: «كود الخصم» is the store's own, whatever the letters' case. */
async function checkCoupon(tx: Transaction, input: PromotionData, ownId: string | null): Promise<void> {
  if (!input.couponCode) return;
  const [same] = await tx
    .select({ id: promotions.id })
    .from(promotions)
    .where(
      and(
        sql`lower(${promotions.couponCode}) = lower(${input.couponCode})`,
        ...(ownId ? [ne(promotions.id, ownId)] : []),
      ),
    )
    .limit(1);
  if (same) throw codeTaken();
}

/** The offer, locked for the rest of the transaction so two edits cannot both pass the version check */
/** Two saves with the same code at once: the unique index says so, the owner reads the field message */
function rethrowCode(error: unknown): never {
  if (isUniqueViolation(error, 'promotions_coupon_unique')) throw codeTaken();
  throw error;
}

async function one(tx: Transaction, id: string): Promise<Row> {
  const [row] = await tx.select().from(promotions).where(eq(promotions.id, id)).limit(1).for('update');
  if (!row) throw notFound();
  return row;
}

export function listPromotions(db: Database, auth: AccessClaims): Promise<{ items: Promotion[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const rows = await tx
      .select()
      .from(promotions)
      .orderBy(asc(promotions.archivedAt), desc(promotions.createdAt), asc(promotions.id));
    return { items: rows.map(view) };
  });
}

export function createPromotion(
  db: Database,
  auth: AccessClaims,
  input: PromotionData,
  meta: RequestMeta,
  now: Date,
): Promise<Promotion> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    await checkTargets(tx, input);
    await checkCoupon(tx, input, null);
    const [row] = await tx
      .insert(promotions)
      .values({ tenantId: auth.tenantId, ...columns(input, now, null) })
      .returning()
      .catch(rethrowCode);
    const created = view(row!);
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'promotion.create',
        entity: 'promotion',
        entityId: created.id,
        changes: { name: [null, created.name], kind: [null, created.kind] },
      },
      meta,
    );
    return created;
  });
}

export function updatePromotion(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: PromotionData & { version: number },
  meta: RequestMeta,
  now: Date,
): Promise<Promotion> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const before = await one(tx, id);
    if (before.version !== input.version) {
      throw staleVersion();
    }
    await checkTargets(tx, input);
    await checkCoupon(tx, input, id);
    const [row] = await tx
      .update(promotions)
      .set(columns(input, now, before.archivedAt))
      .where(and(eq(promotions.id, id), eq(promotions.version, input.version)))
      .returning()
      .catch(rethrowCode);
    if (!row) throw staleVersion();
    const after = view(row);
    const old = view(before);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(after) as (keyof Promotion)[]) {
      if (key === 'version' || key === 'updatedAt') continue;
      if (JSON.stringify(old[key]) !== JSON.stringify(after[key])) changes[key] = [old[key], after[key]];
    }
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'promotion.update',
        entity: 'promotion',
        entityId: id,
        changes,
      },
      meta,
    );
    return after;
  });
}

/** Stops or restarts an offer; nothing else of it is read again, so an old row can always be stopped */
export function archivePromotion(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: { version: number; archived: boolean },
  meta: RequestMeta,
  now: Date,
): Promise<Promotion> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const before = await one(tx, id);
    if (before.version !== input.version) throw staleVersion();
    // Already in the state asked for (a double click): the answer is the offer as it is
    if ((before.archivedAt !== null) === input.archived) return view(before);
    const [row] = await tx
      .update(promotions)
      .set({ archivedAt: input.archived ? now : null })
      .where(and(eq(promotions.id, id), eq(promotions.version, input.version)))
      .returning();
    if (!row) throw staleVersion();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'promotion.update',
        entity: 'promotion',
        entityId: id,
        changes: { archived: [before.archivedAt !== null, input.archived] },
      },
      meta,
    );
    return view(row);
  });
}
