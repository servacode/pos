import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Promotion, PromotionData, PromotionKind, PromotionScope } from '@serva/core';
import { categories, products, promotions, withTenant, type Database, type Transaction } from '@serva/db';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { fieldError, staleVersion } from './catalog/common';

/**
 * Promotions (packages/core › contracts/promotions.ts): the owner's list, add and change. Tills
 * pull them (sync-pull › promotions) and apply them themselves; nothing here touches a sale.
 */

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
    buyQty: input.kind === 'buy_get' ? input.buyQty : null,
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
  if (same) throw fieldError('couponCode', 'هذا الكود لعرض آخر، اختر غيره');
}

async function one(tx: Transaction, id: string): Promise<Row> {
  const [row] = await tx.select().from(promotions).where(eq(promotions.id, id)).limit(1);
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
      .returning();
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
      .where(eq(promotions.id, id))
      .returning();
    const after = view(row!);
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
