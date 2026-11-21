import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type {
  CustomerKind,
  Promotion,
  PromotionData,
  PromotionKind,
  PromotionPreview,
  PromotionPreviewInput,
  PromotionReport,
  PromotionReportQuery,
  PromotionScope,
} from '@serva/core';
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
async function checkCoupon(
  tx: Transaction,
  input: { couponCode: string | null; archived: boolean },
  ownId: string | null,
): Promise<void> {
  // A stopped offer keeps its code only for show: the code is free for another offer (index 0095)
  if (!input.couponCode || input.archived) return;
  const [same] = await tx
    .select({ id: promotions.id })
    .from(promotions)
    .where(
      and(
        isNull(promotions.archivedAt),
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
    // Restarting runs the rules a new offer would: an old row with a code and an audience would go live and never work
    if (!input.archived) {
      if (
        before.couponCode &&
        (before.repOnly || before.customerKinds.length > 0 || before.priceTiers.length > 0)
      ) {
        throw fieldError(
          'couponCode',
          'الكود لا يعمل مع عرض مخصص لفئة من الزبائن أو للمندوب. عدّل العرض وأزل أحدهما ثم شغّله',
        );
      }
      await checkCoupon(tx, { couponCode: before.couponCode, archived: false }, id);
    }
    const [row] = await tx
      .update(promotions)
      .set({ archivedAt: input.archived ? now : null })
      .where(and(eq(promotions.id, id), eq(promotions.version, input.version)))
      .returning()
      .catch(rethrowCode);
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

/**
 * What each offer did at the tills between two dates. The sales keep the offer's name as the reason of
 * the line's `promotion` discount, so that is what the rows group by (an offer renamed mid-period shows
 * as two rows, as its receipts did).
 */
export function promotionReport(
  db: Database,
  auth: AccessClaims,
  query: PromotionReportQuery,
): Promise<PromotionReport> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const rows = await tx.execute<{
      name: string;
      currency: string;
      invoices: number;
      pieces: string;
      discount: string;
      net: string;
      free: string;
    }>(sql`
      select l -> 'discount' ->> 'reason' as name, i.currency,
             count(distinct i.id)::int as invoices,
             coalesce(sum((l ->> 'qty')::bigint), 0)::text as pieces,
             coalesce(sum((l -> 'priced' ->> 'lineDiscountMinor')::bigint), 0)::text as discount,
             coalesce(sum((l -> 'priced' ->> 'netMinor')::bigint), 0)::text as net,
             coalesce(sum(case when (l -> 'priced' ->> 'grossMinor')::bigint = 0 then (l ->> 'qty')::bigint else 0 end), 0)::text as free
      from invoices i
      cross join lateral jsonb_array_elements(i.payload -> 'lines') l
      where i.business_date between ${query.from}::date and ${query.to}::date
        and l -> 'discount' ->> 'source' = 'promotion'
      group by 1, 2
      order by sum((l -> 'priced' ->> 'lineDiscountMinor')::bigint) desc, 1 limit 200`);
    return {
      from: query.from,
      to: query.to,
      items: rows.map((r) => ({
        name: r.name ?? '',
        currency: r.currency,
        invoices: r.invoices,
        pieces: Number(r.pieces) / 1000,
        discountMinor: Number(r.discount),
        netMinor: Number(r.net),
        freePieces: Number(r.free) / 1000,
      })),
    };
  });
}

/** How many products an offer's scope reaches (a category counts its sub-categories), before the owner saves it */
export function promotionPreview(
  db: Database,
  auth: AccessClaims,
  input: PromotionPreviewInput & { scope: PromotionScope },
): Promise<PromotionPreview> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const live = sql`p.archived_at is null and p.status = 'active' and p.sell_on_pos`;
    const categoryIds = [...new Set(input.categoryIds ?? [])];
    const productIds = [...new Set(input.productIds ?? [])];
    let reach = sql`true`;
    if (input.scope === 'categories') {
      if (categoryIds.length === 0) return { products: 0, sample: [] };
      reach = sql`p.category_id in (
        with recursive tree(id) as (
          select id from categories where id in (${sql.join(
            categoryIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          union select c.id from categories c join tree t on c.parent_id = t.id)
        select id from tree)`;
    } else if (input.scope === 'products') {
      if (productIds.length === 0) return { products: 0, sample: [] };
      reach = sql`p.id in (${sql.join(
        productIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;
    }
    const [count] = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from products p where ${live} and ${reach}`,
    );
    const names = await tx.execute<{ name: string }>(
      sql`select p.name_ar as name from products p where ${live} and ${reach} order by p.name_ar, p.id limit 3`,
    );
    return { products: count?.n ?? 0, sample: names.map((r) => r.name) };
  });
}
