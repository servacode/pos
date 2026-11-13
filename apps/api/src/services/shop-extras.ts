import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  MAX_IMAGE_BYTES,
  MAX_THUMB_BYTES,
  stripBidiControls,
  type CodSummary,
  type CurrencyCode,
  type OnlineOrder,
  type OnlineStoreSettings,
  type ProductTexts,
  type ShopCoupon,
  type StockAlert,
  type onlineOrderDeliveryInput,
  type productImageInput,
  type productTextsInput,
  type stockAlertInput,
} from '@serva/core';
import {
  onlineOrders,
  onlineStores,
  productTexts,
  stockAlerts,
  uploads,
  withTenant,
  type Database,
} from '@serva/db';
import type { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { sniffImage } from './catalog/images';
import {
  COUPON_BAD,
  couponRule,
  fieldError,
  getOnlineStore,
  notFound,
  orderChanged,
  orderOf,
  staleVersion,
  storeOf,
  tenantOf,
} from './shop';

/**
 * The online shop's growth (26 › المتجر الإلكتروني): the coupon a customer types, «أبلغني عند
 * التوفر», the delivery stage and the cash couriers bring back, the store's logo and cover, and the
 * product's description. None of it posts anything: the money is the till sale's, as always.
 */

// ─── «كود الخصم» ─────────────────────────────────────────────────────────────

/** The offer a typed code opens, for the cart to show before the order; 400 when it opens none. */
export function shopCoupon(db: Database, slug: string, code: string): Promise<ShopCoupon> {
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const store = await storeOf(tx, tenantId);
      const rule = await couponRule(tx, code);
      if (!rule) throw fieldError('coupon', COUPON_BAD);
      return {
        name: rule.name,
        // A price-ish number only where the shop shows prices
        percentBp: store.show_prices && rule.kind === 'percent' ? rule.percentBp : null,
      };
    }),
  );
}

// ─── «أبلغني عند التوفر» ──────────────────────────────────────────────────────

/** A phone left on a piece that is out of stock. The same phone on the same piece is kept once. */
export function notifyStockAlert(
  db: Database,
  slug: string,
  productId: string,
  input: z.output<typeof stockAlertInput>,
): Promise<void> {
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const [piece] = await tx.execute<{ in_stock: boolean }>(sql`
        select (p.type = 'service' or coalesce((select sum(l.qty) from stock_levels l where l.variant_id = v.id), 0) > 0) as in_stock
        from variants v join products p on p.id = v.product_id
        where v.id = ${input.variantId} and p.id = ${productId} and v.archived_at is null
          and p.archived_at is null and p.status = 'active' and p.sell_on_pos`);
      if (!piece) throw notFound('هذه القطعة غير موجودة.');
      if (piece.in_stock) {
        throw new AppError(409, 'conflict', 'هذه القطعة متوفرة الآن، أضفها إلى السلة.');
      }
      await tx
        .insert(stockAlerts)
        .values({ tenantId, productId, variantId: input.variantId, phone: input.phone })
        .onConflictDoNothing({ target: [stockAlerts.tenantId, stockAlerts.variantId, stockAlerts.phone] });
    }),
  );
}

export function listStockAlerts(
  db: Database,
  auth: AccessClaims,
  productId: string,
): Promise<{ items: StockAlert[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const [product] = await tx.execute<{ id: string }>(sql`select id from products where id = ${productId}`);
    if (!product) throw notFound('هذا المنتج غير موجود.');
    const rows = await tx.execute<{
      id: string;
      variant_id: string;
      label: string | null;
      phone: string;
      created_at: Date;
      notified_at: Date | null;
      in_stock: boolean;
    }>(sql`
      select a.id, a.variant_id, v.label, a.phone, a.created_at, a.notified_at,
             (p.type = 'service' or coalesce((select sum(l.qty) from stock_levels l where l.variant_id = v.id), 0) > 0) as in_stock
      from stock_alerts a
      join variants v on v.id = a.variant_id
      join products p on p.id = a.product_id
      where a.product_id = ${productId}
      order by a.notified_at is not null, a.created_at, a.id
      limit 500`);
    return {
      items: rows.map((r) => ({
        id: r.id,
        variantId: r.variant_id,
        variantLabel: r.label,
        phone: r.phone,
        createdAt: new Date(r.created_at).toISOString(),
        notifiedAt: r.notified_at ? new Date(r.notified_at).toISOString() : null,
        inStock: r.in_stock,
      })),
    };
  });
}

/** The owner wrote to them: the row stays, marked, so the next time they only see who is left. */
export function markStockAlertNotified(
  db: Database,
  auth: AccessClaims,
  id: string,
  meta: RequestMeta,
): Promise<{ id: string; notifiedAt: string }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    const [row] = await tx
      .update(stockAlerts)
      .set({ notifiedAt: sql`now()` })
      .where(and(eq(stockAlerts.tenantId, auth.tenantId), eq(stockAlerts.id, id)))
      .returning({ id: stockAlerts.id, at: stockAlerts.notifiedAt });
    if (!row) throw notFound('هذا الطلب غير موجود.');
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'stock_alert.notified',
        entity: 'stock_alert',
        entityId: id,
      },
      meta,
    );
    return { id: row.id, notifiedAt: row.at!.toISOString() };
  });
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/**
 * «خرج للتوصيل» with the courier's name, then «سُلّم». A delivery order the store accepted, or the
 * till already sold; the stage never touches the status or the money.
 */
export function setOrderDelivery(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof onlineOrderDeliveryInput>,
  meta: RequestMeta,
): Promise<OnlineOrder> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const [row] = await tx
      .select()
      .from(onlineOrders)
      .where(and(eq(onlineOrders.tenantId, auth.tenantId), eq(onlineOrders.id, id)))
      .for('update');
    if (!row) throw notFound('هذا الطلب غير موجود.');
    if (row.version !== input.version) {
      if (row.deliveryStage === input.stage) throw orderChanged('تم هذا الإجراء على الطلب للتو.');
      throw orderChanged('تغيّر هذا الطلب للتو. حدّث الصفحة وراجعه.');
    }
    if (row.fulfilment !== 'delivery') throw fieldError('stage', 'هذا الطلب استلام من المحل لا توصيل.');
    if (row.status !== 'accepted' && row.status !== 'done') {
      throw fieldError('stage', 'اقبل الطلب أولاً قبل أن يخرج للتوصيل.');
    }
    const wanted = input.stage === 'out' ? null : 'out';
    if (row.deliveryStage !== wanted) {
      throw fieldError(
        'stage',
        input.stage === 'out' ? 'خرج هذا الطلب للتوصيل من قبل.' : 'يجب أن يخرج الطلب للتوصيل أولاً.',
      );
    }
    const [done] = await tx
      .update(onlineOrders)
      .set(
        input.stage === 'out'
          ? {
              deliveryStage: 'out',
              courierName: stripBidiControls(input.courier),
              outAt: sql`now()`,
              updatedAt: sql`now()`,
            }
          : { deliveryStage: 'delivered', deliveredAt: sql`now()`, updatedAt: sql`now()` },
      )
      .where(
        and(
          eq(onlineOrders.tenantId, auth.tenantId),
          eq(onlineOrders.id, id),
          eq(onlineOrders.version, input.version),
        ),
      )
      .returning();
    if (!done) throw staleVersion();
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: `online_order.${input.stage === 'out' ? 'out_for_delivery' : 'delivered'}`,
        entity: 'online_order',
        entityId: id,
        ...(input.stage === 'out' ? { data: { courier: done.courierName } } : {}),
      },
      meta,
    );
    return orderOf(done);
  });
}

/** The orders out for delivery, by courier: the cash each is expected to bring back. */
export function codSummary(db: Database, auth: AccessClaims): Promise<CodSummary> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const rows = await tx
      .select()
      .from(onlineOrders)
      .where(
        and(
          eq(onlineOrders.tenantId, auth.tenantId),
          eq(onlineOrders.fulfilment, 'delivery'),
          eq(onlineOrders.deliveryStage, 'out'),
        ),
      )
      .orderBy(asc(onlineOrders.outAt), asc(onlineOrders.seq))
      .limit(500);
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings where tenant_id = ${auth.tenantId}`,
    );
    const couriers = new Map<string, CodSummary['couriers'][number]>();
    for (const r of rows) {
      const name = r.courierName ?? '—';
      let group = couriers.get(name);
      if (!group) couriers.set(name, (group = { courier: name, expectedMinor: 0, orders: [] }));
      const collectMinor = r.totalMinor + r.deliveryFeeMinor;
      group.expectedMinor += collectMinor;
      group.orders.push({
        id: r.id,
        number: r.number,
        customerName: r.customerName,
        phone: r.phone,
        address: r.address,
        deliveryArea: r.deliveryArea,
        collectMinor,
        outAt: r.outAt?.toISOString() ?? null,
      });
    }
    return {
      currency: (settings?.base ?? 'SYP') as CurrencyCode,
      couriers: [...couriers.values()].sort((a, b) => a.courier.localeCompare(b.courier, 'ar')),
    };
  });
}

// ─── The store's logo and cover ──────────────────────────────────────────────

const SLOTS = { logo: 'logoUploadId', cover: 'coverUploadId' } as const;
export type StoreImageSlot = keyof typeof SLOTS;

/** The logo or the cover banner: resized in the browser like a product's picture, kept the same way. */
export function setStoreImage(
  db: Database,
  auth: AccessClaims,
  slot: StoreImageSlot,
  input: z.output<typeof productImageInput>,
  meta: RequestMeta,
): Promise<OnlineStoreSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const data = Buffer.from(input.data, 'base64');
    const thumb = Buffer.from(input.thumb, 'base64');
    if (data.length > MAX_IMAGE_BYTES) throw fieldError('data', 'الصورة أكبر من المسموح');
    if (thumb.length > MAX_THUMB_BYTES) throw fieldError('thumb', 'الصورة المصغّرة أكبر من المسموح');
    if (sniffImage(data) !== input.contentType || sniffImage(thumb) !== input.contentType) {
      throw fieldError('data', 'هذا الملف ليس صورة. اختر صورة JPG أو PNG أو WebP.');
    }
    const [store] = await tx
      .select({ id: onlineStores.tenantId })
      .from(onlineStores)
      .where(eq(onlineStores.tenantId, auth.tenantId));
    if (!store) throw new AppError(409, 'conflict', 'احفظ إعدادات المتجر أولاً ثم أضف الصورة.');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const [same] = await tx
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.tenantId, auth.tenantId), eq(uploads.sha256, sha256)))
      .limit(1);
    let uploadId = same?.id;
    if (!uploadId) {
      const [made] = await tx
        .insert(uploads)
        .values({
          tenantId: auth.tenantId,
          kind: slot === 'logo' ? 'shop_logo' : 'shop_cover',
          contentType: input.contentType,
          sha256,
          width: input.width,
          height: input.height,
          data,
          thumb,
          createdBy: auth.userId,
        })
        .returning({ id: uploads.id });
      uploadId = made!.id;
    }
    await tx
      .update(onlineStores)
      .set({ [SLOTS[slot]]: uploadId, updatedAt: sql`now()` })
      .where(eq(onlineStores.tenantId, auth.tenantId));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: `online_store.${slot}_set`,
        entity: 'online_store',
        entityId: auth.tenantId,
        data: { bytes: data.length },
      },
      meta,
    );
  }).then(() => getOnlineStore(db, auth));
}

export function removeStoreImage(
  db: Database,
  auth: AccessClaims,
  slot: StoreImageSlot,
  meta: RequestMeta,
): Promise<OnlineStoreSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    await tx
      .update(onlineStores)
      .set({ [SLOTS[slot]]: null, updatedAt: sql`now()` })
      .where(eq(onlineStores.tenantId, auth.tenantId));
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: `online_store.${slot}_removed`,
        entity: 'online_store',
        entityId: auth.tenantId,
      },
      meta,
    );
  }).then(() => getOnlineStore(db, auth));
}

// ─── The product's description and size guide ────────────────────────────────

/**
 * Plain text only: line breaks stay, every other control character and the invisible direction
 * marks go. The shop shows it as text (never as markup), so what is typed is what is read.
 */
export function plainText(text: string | null): string | null {
  if (text === null) return null;
  const kept = [...stripBidiControls(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n')]
    .filter((ch) => ch === '\n' || ch === '\t' || ch >= ' ')
    .join('')
    .trim();
  return kept === '' ? null : kept;
}

async function requireProduct(tx: Parameters<Parameters<typeof withTenant>[2]>[0], productId: string) {
  const [row] = await tx.execute<{ id: string }>(sql`select id from products where id = ${productId}`);
  if (!row) throw notFound('هذا المنتج غير موجود.');
}

export function getProductTexts(db: Database, auth: AccessClaims, productId: string): Promise<ProductTexts> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    await requireProduct(tx, productId);
    const [row] = await tx
      .select({ description: productTexts.description, sizeGuide: productTexts.sizeGuide })
      .from(productTexts)
      .where(and(eq(productTexts.tenantId, auth.tenantId), eq(productTexts.productId, productId)));
    return { description: row?.description ?? null, sizeGuide: row?.sizeGuide ?? null };
  });
}

export function saveProductTexts(
  db: Database,
  auth: AccessClaims,
  productId: string,
  input: z.output<typeof productTextsInput>,
  meta: RequestMeta,
): Promise<ProductTexts> {
  const values = { description: plainText(input.description), sizeGuide: plainText(input.sizeGuide) };
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'catalog.manage');
    await requireProduct(tx, productId);
    await tx
      .insert(productTexts)
      .values({ tenantId: auth.tenantId, productId, ...values, updatedBy: auth.userId })
      .onConflictDoUpdate({
        target: [productTexts.tenantId, productTexts.productId],
        set: { ...values, updatedBy: auth.userId, updatedAt: sql`now()` },
      });
    await audit(
      tx,
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: 'product.texts_saved',
        entity: 'product',
        entityId: productId,
      },
      meta,
    );
    return values;
  });
}
