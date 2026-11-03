import { and, desc, eq, sql } from 'drizzle-orm';
import {
  convert,
  formatMoney,
  rateFor,
  stripBidiControls,
  type CurrencyCode,
  type OnlineOrder,
  type OnlineStoreSettings,
  type ShopHome,
  type ShopOrderPlaced,
  type ShopProduct,
  type TradeRate,
  type onlineOrderStatusInput,
  type onlineStoreInput,
  type shopOrderInput,
} from '@serva/core';
import {
  onlineOrders,
  onlineStores,
  withTenant,
  type Database,
  type OnlineOrderLine,
  type Transaction,
} from '@serva/db';
import type { z } from 'zod';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { imageUrl } from './catalog/images';

/**
 * The online shop, first step (26 › المتجر الإلكتروني; contracts/shop.ts): the store's goods on its
 * own link, and orders sent on WhatsApp. Public reads carry nothing a customer should not see: no
 * cost, no stock counts (only «متوفر»), no staff, no other store.
 */

const SHOP = 'هذا المتجر غير موجود أو غير مفعّل.';
const notFound = (message: string) => new AppError(404, 'not_found', message);
const fieldError = (field: string, message: string) =>
  new AppError(400, 'validation_failed', 'تحقّق من الحقول المظلّلة.', { [field]: message });

const money = (minor: number, currency: CurrencyCode) => stripBidiControls(formatMoney(minor, currency));

/** The store behind a shop link, or 404 (also when its shop is off). */
async function tenantOf(db: Database, slug: string): Promise<string> {
  const [row] = await db.execute<{ id: string | null }>(sql`select shop_find_by_slug(${slug}) as id`);
  if (!row?.id) throw notFound(SHOP);
  return row.id;
}

async function storeOf(tx: Transaction, tenantId: string) {
  const [row] = await tx.execute<{
    name: string;
    base: string;
    slug: string;
    whatsapp: string | null;
    delivery: boolean;
    pickup: boolean;
    note: string | null;
    show_out_of_stock: boolean;
  }>(sql`
    select t.name, s.base_currency as base, o.slug, o.whatsapp, o.delivery, o.pickup, o.note, o.show_out_of_stock
    from online_stores o
    join tenants t on t.id = o.tenant_id
    join tenant_settings s on s.tenant_id = o.tenant_id
    where o.tenant_id = ${tenantId}`);
  if (!row) throw notFound(SHOP);
  return row;
}

async function ratesOf(tx: Transaction): Promise<TradeRate[]> {
  const rows = await tx.execute<{ unit: string; quote: string; rate: string }>(sql`
    select distinct on (unit, quote) unit, quote, rate from exchange_rates
    where effective_at <= now() order by unit, quote, effective_at desc`);
  return rows.map((r) => ({ unit: r.unit as CurrencyCode, quote: r.quote as CurrencyCode, rate: r.rate }));
}

/** A price in the store's own currency, at today's rate when the piece is priced in another. */
function inBase(
  minor: number,
  currency: CurrencyCode,
  base: CurrencyCode,
  rates: TradeRate[],
): number | null {
  if (currency === base) return minor;
  const rate = rateFor(rates, currency, base);
  return rate ? convert(minor, currency, base, rate) : null;
}

const sellable = sql`p.archived_at is null and p.status = 'active' and p.sell_on_pos`;
const liveVariant = sql`v.archived_at is null`;
/** On the shelf in any branch, or a service that has no stock */
const availableSql = sql`(p.type = 'service' or coalesce((select sum(l.qty) from stock_levels l where l.variant_id = v.id), 0) > 0)`;

export function shopHome(db: Database, slug: string): Promise<ShopHome> {
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const store = await storeOf(tx, tenantId);
      const base = store.base as CurrencyCode;
      const rates = await ratesOf(tx);
      const rows = await tx.execute<{
        id: string;
        name: string;
        category_id: string | null;
        currency: string;
        price: string;
        available: boolean;
        upload_id: string | null;
      }>(sql`
        select p.id, p.name_ar as name, p.category_id, pr.currency, pr.price_minor::text as price,
               ${availableSql} as available,
               (select i.upload_id from product_images i where i.product_id = p.id
                order by i.sort_order, i.created_at limit 1) as upload_id
        from products p
        join variants v on v.product_id = p.id and ${liveVariant}
        join prices pr on pr.id = v.id
        where ${sellable}
        order by p.name_ar, p.id
        limit 5000`);
      const byProduct = new Map<string, ShopHome['products'][number]>();
      for (const r of rows) {
        const price = inBase(Number(r.price), r.currency as CurrencyCode, base, rates);
        if (price === null) continue;
        const card = byProduct.get(r.id);
        if (!card) {
          byProduct.set(r.id, {
            id: r.id,
            name: r.name,
            categoryId: r.category_id,
            imageUrl: r.upload_id ? imageUrl(tenantId, r.upload_id, true) : null,
            currency: base,
            priceMinor: price,
            maxPriceMinor: price,
            available: r.available,
          });
        } else {
          card.priceMinor = Math.min(card.priceMinor, price);
          card.maxPriceMinor = Math.max(card.maxPriceMinor, price);
          card.available ||= r.available;
        }
      }
      const products = [...byProduct.values()].filter((p) => p.available || store.show_out_of_stock);
      const used = new Set(products.map((p) => p.categoryId).filter(Boolean));
      const categories = await tx.execute<{ id: string; name: string; parent_id: string | null }>(sql`
        select id, name, parent_id from categories where archived_at is null order by sort_order, name`);
      // A category shows when it or one of its sub-categories has goods
      const parent = new Map(categories.map((c) => [c.id, c.parent_id]));
      const shown = new Set<string>();
      for (const id of used) {
        let at: string | null | undefined = id;
        while (at && !shown.has(at)) {
          shown.add(at);
          at = parent.get(at);
        }
      }
      return {
        store: {
          name: store.name,
          slug: store.slug,
          currency: base,
          whatsapp: store.whatsapp ? store.whatsapp.replace('+', '') : null,
          delivery: store.delivery,
          pickup: store.pickup,
          note: store.note,
        },
        categories: categories
          .filter((c) => shown.has(c.id))
          .map((c) => ({ id: c.id, name: c.name, parentId: c.parent_id })),
        products,
      };
    }),
  );
}

export function shopProduct(db: Database, slug: string, productId: string): Promise<ShopProduct> {
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const store = await storeOf(tx, tenantId);
      const base = store.base as CurrencyCode;
      const rates = await ratesOf(tx);
      const rows = await tx.execute<{
        product_name: string;
        category_id: string | null;
        id: string;
        label: string | null;
        attributes: { name: string; value: string }[];
        currency: string;
        price: string;
        available: boolean;
      }>(sql`
        select p.name_ar as product_name, p.category_id, v.id, v.label, v.attributes, pr.currency,
               pr.price_minor::text as price, ${availableSql} as available
        from products p
        join variants v on v.product_id = p.id and ${liveVariant}
        join prices pr on pr.id = v.id
        where p.id = ${productId} and ${sellable}
        order by v.sort_order, v.id`);
      if (rows.length === 0) throw notFound('هذا الصنف غير موجود.');
      const variants = rows.flatMap((r) => {
        const price = inBase(Number(r.price), r.currency as CurrencyCode, base, rates);
        if (price === null || (!r.available && !store.show_out_of_stock)) return [];
        return [
          {
            id: r.id,
            label: r.label,
            attributes: r.attributes ?? [],
            priceMinor: price,
            available: r.available,
          },
        ];
      });
      if (variants.length === 0) throw notFound('هذا الصنف غير متوفر الآن.');
      const options: ShopProduct['options'] = [];
      for (const v of variants) {
        for (const a of v.attributes) {
          let option = options.find((o) => o.name === a.name);
          if (!option) options.push((option = { name: a.name, values: [] }));
          if (!option.values.includes(a.value)) option.values.push(a.value);
        }
      }
      const images = await tx.execute<{ upload_id: string; option_value: string | null }>(sql`
        select upload_id, option_value from product_images where product_id = ${productId}
        order by sort_order, created_at, id`);
      return {
        id: productId,
        name: rows[0]!.product_name,
        categoryId: rows[0]!.category_id,
        currency: base,
        images: images.map((i) => ({
          url: imageUrl(tenantId, i.upload_id),
          thumbUrl: imageUrl(tenantId, i.upload_id, true),
          optionValue: i.option_value,
        })),
        options,
        variants,
      };
    }),
  );
}

/** The order as WhatsApp opens with it: short lines, the store's numbers, nothing to retype. */
export function orderMessage(order: {
  number: string;
  customerName: string;
  phone: string;
  fulfilment: 'delivery' | 'pickup';
  address: string | null;
  note: string | null;
  currency: CurrencyCode;
  totalMinor: number;
  lines: OnlineOrderLine[];
}): string {
  return [
    `طلب جديد من المتجر: ${order.number}`,
    `الاسم: ${order.customerName}`,
    `الجوال: ${order.phone}`,
    '',
    ...order.lines.map(
      (l) =>
        `• ${l.name}${l.label ? ` (${l.label})` : ''} × ${l.qty} = ${money(l.totalMinor, order.currency)}`,
    ),
    '',
    `المجموع: ${money(order.totalMinor, order.currency)}`,
    order.fulfilment === 'delivery' ? `التوصيل إلى: ${order.address ?? '—'}` : 'الاستلام من المحل',
    ...(order.note ? [`ملاحظة: ${order.note}`] : []),
  ].join('\n');
}

export function placeShopOrder(
  db: Database,
  slug: string,
  input: z.output<typeof shopOrderInput>,
): Promise<ShopOrderPlaced> {
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const store = await storeOf(tx, tenantId);
      const base = store.base as CurrencyCode;
      if (input.fulfilment === 'delivery' && !store.delivery)
        throw fieldError('fulfilment', 'هذا المحل لا يوصّل، الاستلام من المحل.');
      if (input.fulfilment === 'pickup' && !store.pickup)
        throw fieldError('fulfilment', 'هذا المحل يوصّل فقط.');
      if (input.fulfilment === 'delivery' && !input.address)
        throw fieldError('address', 'اكتب عنوان التوصيل');
      const rates = await ratesOf(tx);
      const ids = [...new Set(input.lines.map((l) => l.variantId))];
      const rows = await tx.execute<{
        id: string;
        product_id: string;
        name: string;
        label: string | null;
        currency: string;
        price: string;
        available: boolean;
      }>(sql`
        select v.id, p.id as product_id, p.name_ar as name, v.label, pr.currency,
               pr.price_minor::text as price, ${availableSql} as available
        from variants v
        join products p on p.id = v.product_id
        join prices pr on pr.id = v.id
        where v.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) and ${liveVariant} and ${sellable}`);
      const known = new Map(rows.map((r) => [r.id, r]));
      const lines: OnlineOrderLine[] = [];
      for (const [index, line] of input.lines.entries()) {
        const row = known.get(line.variantId);
        const price = row ? inBase(Number(row.price), row.currency as CurrencyCode, base, rates) : null;
        if (!row || price === null || !row.available) {
          throw fieldError(`lines.${index}`, 'قطعة في السلة لم تعد متوفرة. احذفها وأكمل الطلب.');
        }
        const existing = lines.find((l) => l.variantId === line.variantId);
        if (existing) {
          existing.qty += line.qty;
          existing.totalMinor = existing.priceMinor * existing.qty;
        } else {
          lines.push({
            variantId: row.id,
            productId: row.product_id,
            name: row.name,
            label: row.label,
            qty: line.qty,
            priceMinor: price,
            totalMinor: price * line.qty,
          });
        }
      }
      const totalMinor = lines.reduce((n, l) => n + l.totalMinor, 0);
      // Numbers follow each other within a store; the lock keeps two orders off the same one
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('online_orders'), hashtext(${tenantId}))`);
      const [last] = await tx.execute<{ seq: number | null }>(
        sql`select max(seq) as seq from online_orders where tenant_id = ${tenantId}`,
      );
      const seq = (last?.seq ?? 0) + 1;
      const number = `ONL-${String(seq).padStart(6, '0')}`;
      const order = {
        number,
        customerName: input.name,
        phone: input.phone,
        fulfilment: input.fulfilment,
        address: input.fulfilment === 'delivery' ? input.address : null,
        note: input.note,
        currency: base,
        totalMinor,
        lines,
      };
      await tx.insert(onlineOrders).values({ tenantId, seq, source: 'whatsapp', ...order });
      const message = orderMessage(order);
      return {
        number,
        currency: base,
        totalMinor,
        message,
        whatsappUrl: store.whatsapp
          ? `https://wa.me/${store.whatsapp.replace('+', '')}?text=${encodeURIComponent(message)}`
          : null,
      };
    }),
  );
}

// ─── The dashboard ────────────────────────────────────────────────────────────

const DEFAULTS = (slug: string): OnlineStoreSettings => ({
  version: null,
  enabled: false,
  slug,
  whatsapp: null,
  delivery: true,
  pickup: true,
  note: null,
  showOutOfStock: false,
});

export function getOnlineStore(db: Database, auth: AccessClaims): Promise<OnlineStoreSettings> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'settings.manage');
    const [row] = await tx.select().from(onlineStores).where(eq(onlineStores.tenantId, auth.tenantId));
    if (!row) {
      const [tenant] = await tx.execute<{ code: string | null }>(
        sql`select store_code as code from tenants where id = ${auth.tenantId}`,
      );
      return DEFAULTS(`shop-${(tenant?.code ?? auth.tenantId.slice(0, 8)).toLowerCase()}`);
    }
    return {
      version: row.version,
      enabled: row.enabled,
      slug: row.slug,
      whatsapp: row.whatsapp,
      delivery: row.delivery,
      pickup: row.pickup,
      note: row.note,
      showOutOfStock: row.showOutOfStock,
    };
  });
}

export async function saveOnlineStore(
  db: Database,
  auth: AccessClaims,
  input: z.output<typeof onlineStoreInput>,
  meta: RequestMeta,
): Promise<OnlineStoreSettings> {
  if (input.enabled && !input.whatsapp) throw fieldError('whatsapp', 'اكتب رقم واتساب الطلبات لتفعيل المتجر');
  if (!input.delivery && !input.pickup)
    throw fieldError('delivery', 'اختر التوصيل أو الاستلام من المحل أو الاثنين');
  try {
    await withTenant(db, auth.tenantId, async (tx) => {
      await requirePermission(tx, auth.userId, 'settings.manage');
      const values = {
        slug: input.slug,
        enabled: input.enabled,
        whatsapp: input.whatsapp,
        delivery: input.delivery,
        pickup: input.pickup,
        note: input.note || null,
        showOutOfStock: input.showOutOfStock,
      };
      if (input.version === null) {
        const made = await tx
          .insert(onlineStores)
          .values({ tenantId: auth.tenantId, ...values })
          .onConflictDoNothing({ target: onlineStores.tenantId })
          .returning({ v: onlineStores.version });
        if (made.length === 0) throw staleVersion();
      } else {
        const done = await tx
          .update(onlineStores)
          .set({ ...values, updatedAt: sql`now()` })
          .where(and(eq(onlineStores.tenantId, auth.tenantId), eq(onlineStores.version, input.version)))
          .returning({ v: onlineStores.version });
        if (done.length === 0) throw staleVersion();
      }
      await audit(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, action: 'online_store.saved', data: values },
        meta,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error, 'online_stores_slug_unique'))
      throw fieldError('slug', 'هذا الرابط لمحل آخر، اختر غيره');
    throw error;
  }
  return getOnlineStore(db, auth);
}

const staleVersion = () =>
  new AppError(409, 'stale_version', 'عدّل شخص آخر هذا السجل للتو. حدّثنا البيانات، راجعها ثم احفظ من جديد.');

const orderOf = (r: typeof onlineOrders.$inferSelect): OnlineOrder => ({
  id: r.id,
  number: r.number,
  status: r.status as OnlineOrder['status'],
  source: 'whatsapp',
  customerName: r.customerName,
  phone: r.phone,
  fulfilment: r.fulfilment as OnlineOrder['fulfilment'],
  address: r.address,
  note: r.note,
  currency: r.currency as CurrencyCode,
  totalMinor: r.totalMinor,
  lines: r.lines,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  version: r.version,
});

export function listOnlineOrders(
  db: Database,
  auth: AccessClaims,
  status: OnlineOrder['status'] | undefined,
): Promise<{ items: OnlineOrder[] }> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const rows = await tx
      .select()
      .from(onlineOrders)
      .where(
        and(eq(onlineOrders.tenantId, auth.tenantId), ...(status ? [eq(onlineOrders.status, status)] : [])),
      )
      .orderBy(desc(onlineOrders.createdAt), desc(onlineOrders.seq))
      .limit(200);
    return { items: rows.map(orderOf) };
  });
}

const NEXT: Record<OnlineOrder['status'], readonly OnlineOrder['status'][]> = {
  pending: ['accepted', 'rejected'],
  accepted: ['done', 'rejected'],
  rejected: [],
  done: [],
};

export function setOnlineOrderStatus(
  db: Database,
  auth: AccessClaims,
  id: string,
  input: z.output<typeof onlineOrderStatusInput>,
  meta: RequestMeta,
): Promise<OnlineOrder> {
  return withTenant(db, auth.tenantId, async (tx) => {
    await requirePermission(tx, auth.userId, 'customers.view');
    const [row] = await tx
      .select()
      .from(onlineOrders)
      .where(and(eq(onlineOrders.tenantId, auth.tenantId), eq(onlineOrders.id, id)));
    if (!row) throw notFound('هذا الطلب غير موجود.');
    if (row.version !== input.version) throw staleVersion();
    if (!NEXT[row.status as OnlineOrder['status']].includes(input.status)) {
      throw fieldError('status', 'لا يمكن نقل الطلب إلى هذه الحالة.');
    }
    const [done] = await tx
      .update(onlineOrders)
      .set({ status: input.status, decidedBy: auth.userId, decidedAt: sql`now()`, updatedAt: sql`now()` })
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
        action: `online_order.${input.status}`,
        entity: 'online_order',
        entityId: id,
      },
      meta,
    );
    return orderOf(done);
  });
}
