import { and, desc, eq, sql } from 'drizzle-orm';
import {
  convert,
  formatMoney,
  promotionActive,
  promotionDiscount,
  rateFor,
  stripBidiControls,
  type CurrencyCode,
  type OnlineOrder,
  type OnlineStoreSettings,
  type PromotionRule,
  type HoldPlaced,
  type ShopCodeSent,
  type ShopHome,
  type ShopOrderPlaced,
  type ShopOrderTrack,
  type ShopProduct,
  type TradeRate,
  type onlineOrderStatusInput,
  type holdInput,
  type onlineStoreInput,
  type shopCodeInput,
  type shopOrderInput,
} from '@serva/core';
import {
  onlineOrders,
  onlineStores,
  uuidv7,
  withTenant,
  type Database,
  type OnlineOrderLine,
  type Transaction,
} from '@serva/db';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { DeviceClaims } from '../auth/device-guard';
import { hashOtp, isTestMode, newOtpCode, OtpDeliveryError } from '../auth/otp';
import { requirePermission } from '../auth/permissions';
import type { AccessClaims } from '../auth/tokens';
import { AppError, isUniqueViolation } from '../errors';
import type { RequestMeta } from '../types';
import { audit } from './audit';
import { imageUrl } from './catalog/images';

/**
 * The online shop (26 › المتجر الإلكتروني; contracts/shop.ts): the store's goods on its own link,
 * and orders sent on WhatsApp or placed in the shop itself, the phone confirmed by a code. Public
 * reads carry nothing a customer should not see: no cost, no stock counts (only «متوفر»), no staff,
 * no other store. An accepted order holds its pieces: the shop counts them out until the till sells
 * them (the sale closes the order) or the order is rejected.
 */

const CODE_TTL_SECONDS = 600;
const MAX_CODE_ATTEMPTS = 5;

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
    order_mode: 'whatsapp' | 'shop';
  }>(sql`
    select t.name, s.base_currency as base, o.slug, o.whatsapp, o.delivery, o.pickup, o.note,
           o.show_out_of_stock, o.order_mode
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

interface Priced {
  priceMinor: number;
  wasPriceMinor: number | null;
  offer: string | null;
}

/**
 * The shop's price of a piece (03 › الألبسة: العروض في المتجر): in the store's currency, less the
 * best percent offer running now on it (as the till would take it off), with the price before the
 * markdown or the offer to strike through. Buy-and-get offers stay for the till.
 */
async function pricerOf(
  tx: Transaction,
  base: CurrencyCode,
): Promise<
  (row: {
    productId: string;
    categoryId: string | null;
    currency: string;
    price: string;
    was: string | null;
  }) => Priced | null
> {
  const rates = await ratesOf(tx);
  const [tenant] = await tx.execute<{ timezone: string | null }>(sql`select timezone from tenants limit 1`);
  const rows = await tx.execute<{
    id: string;
    name: string;
    percent_bp: number | null;
    scope: string;
    category_ids: string[] | null;
    product_ids: string[] | null;
    starts_at: string | null;
    ends_at: string | null;
    days_of_week: number[] | null;
    from_time: string | null;
    to_time: string | null;
  }>(sql`
    select id, name, percent_bp, scope, category_ids, product_ids,
           to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
           to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
           days_of_week, from_time, to_time
    from promotions where archived_at is null and kind = 'percent'`);
  const now = new Date();
  const rules: PromotionRule[] = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: 'percent' as const,
      percentBp: r.percent_bp,
      buyQty: null,
      getQty: null,
      scope: r.scope as PromotionRule['scope'],
      categoryIds: r.category_ids ?? [],
      productIds: r.product_ids ?? [],
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      daysOfWeek: r.days_of_week ?? [],
      fromTime: r.from_time,
      toTime: r.to_time,
      archived: false,
    }))
    .filter((r) => promotionActive(r, now, tenant?.timezone ?? 'Asia/Damascus'));
  const parent = new Map<string, string | null>();
  if (rules.some((r) => r.scope === 'categories')) {
    const cats = await tx.execute<{ id: string; parent_id: string | null }>(
      sql`select id, parent_id from categories`,
    );
    for (const c of cats) parent.set(c.id, c.parent_id);
  }
  const pathOf = (id: string | null): string[] => {
    const path: string[] = [];
    for (let at = id; at && path.length < 10; at = parent.get(at) ?? null) path.push(at);
    return path;
  };
  return (row) => {
    const price = inBase(Number(row.price), row.currency as CurrencyCode, base, rates);
    if (price === null) return null;
    const keptRaw =
      row.was === null ? null : inBase(Number(row.was), row.currency as CurrencyCode, base, rates);
    const kept = keptRaw !== null && keptRaw > price ? keptRaw : null;
    let best: { off: number; name: string } | null = null;
    for (const rule of rules) {
      const off = promotionDiscount(rule, {
        lineNo: 1,
        productId: row.productId,
        categoryPath: pathOf(row.categoryId),
        qty: 1000,
        unitPriceMinor: price,
        weighed: false,
      });
      if (off > 0 && (!best || off > best.off)) best = { off, name: rule.name };
    }
    if (!best) return { priceMinor: price, wasPriceMinor: kept, offer: null };
    return { priceMinor: price - best.off, wasPriceMinor: kept ?? price, offer: best.name };
  };
}

const sellable = sql`p.archived_at is null and p.status = 'active' and p.sell_on_pos`;
const liveVariant = sql`v.archived_at is null`;
/** Pieces held by accepted orders not sold yet, in stock units (a thousandth of a piece) */
const heldSql = sql`coalesce((select sum((x->>'qty')::bigint) * 1000 from online_orders o
  cross join lateral jsonb_array_elements(o.lines) x
  where o.status = 'accepted' and x->>'variantId' = v.id::text), 0)`;
/** On the shelf in any branch, less what accepted orders hold; or a service that has no stock */
const availableSql = sql`(p.type = 'service' or coalesce((select sum(l.qty) from stock_levels l where l.variant_id = v.id), 0) - ${heldSql} > 0)`;

export function shopHome(db: Database, slug: string): Promise<ShopHome> {
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const store = await storeOf(tx, tenantId);
      const base = store.base as CurrencyCode;
      const priceOf = await pricerOf(tx, base);
      const rows = await tx.execute<{
        id: string;
        name: string;
        category_id: string | null;
        currency: string;
        price: string;
        was: string | null;
        available: boolean;
        upload_id: string | null;
      }>(sql`
        select p.id, p.name_ar as name, p.category_id, pr.currency, pr.price_minor::text as price,
               pr.was_price_minor::text as was, ${availableSql} as available,
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
        const priced = priceOf({ productId: r.id, categoryId: r.category_id, ...r });
        if (priced === null) continue;
        const price = priced.priceMinor;
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
            wasPriceMinor: priced.wasPriceMinor,
            offer: priced.offer,
            available: r.available,
          });
        } else {
          // The card shows the cheapest piece, and what that one was before
          if (price < card.priceMinor) {
            card.priceMinor = price;
            card.wasPriceMinor = priced.wasPriceMinor;
          }
          card.maxPriceMinor = Math.max(card.maxPriceMinor, price);
          card.offer ??= priced.offer;
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
          orderMode: store.order_mode,
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
      const priceOf = await pricerOf(tx, base);
      const rows = await tx.execute<{
        product_name: string;
        category_id: string | null;
        id: string;
        label: string | null;
        attributes: { name: string; value: string }[];
        currency: string;
        price: string;
        was: string | null;
        available: boolean;
      }>(sql`
        select p.name_ar as product_name, p.category_id, v.id, v.label, v.attributes, pr.currency,
               pr.price_minor::text as price, pr.was_price_minor::text as was, ${availableSql} as available
        from products p
        join variants v on v.product_id = p.id and ${liveVariant}
        join prices pr on pr.id = v.id
        where p.id = ${productId} and ${sellable}
        order by v.sort_order, v.id`);
      if (rows.length === 0) throw notFound('هذا الصنف غير موجود.');
      let offer: string | null = null;
      const variants = rows.flatMap((r) => {
        const priced = priceOf({ productId, categoryId: r.category_id, ...r });
        if (priced === null || (!r.available && !store.show_out_of_stock)) return [];
        offer ??= priced.offer;
        return [
          {
            id: r.id,
            label: r.label,
            attributes: r.attributes ?? [],
            priceMinor: priced.priceMinor,
            wasPriceMinor: priced.wasPriceMinor,
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
        offer,
      };
    }),
  );
}

/**
 * The order's lines at the server's prices in the store's currency, the same piece twice made one
 * line. A shop order needs each piece on the shelf (less what other orders hold); a hold at the
 * counter has the piece in hand.
 */
async function priceLines(
  tx: Transaction,
  base: CurrencyCode,
  input: { variantId: string; qty: number }[],
  needOnShelf: boolean,
): Promise<OnlineOrderLine[]> {
  const priceOf = await pricerOf(tx, base);
  const ids = [...new Set(input.map((l) => l.variantId))];
  const rows = await tx.execute<{
    id: string;
    product_id: string;
    category_id: string | null;
    name: string;
    label: string | null;
    currency: string;
    price: string;
    was: string | null;
    available: boolean;
  }>(sql`
    select v.id, p.id as product_id, p.category_id, p.name_ar as name, v.label, pr.currency,
           pr.price_minor::text as price, pr.was_price_minor::text as was, ${availableSql} as available
    from variants v
    join products p on p.id = v.product_id
    join prices pr on pr.id = v.id
    where v.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) and ${liveVariant} and ${sellable}`);
  const known = new Map(rows.map((r) => [r.id, r]));
  const lines: OnlineOrderLine[] = [];
  for (const [index, line] of input.entries()) {
    const row = known.get(line.variantId);
    // The price the shop showed, its offer taken off
    const price = row
      ? (priceOf({ productId: row.product_id, categoryId: row.category_id, ...row })?.priceMinor ?? null)
      : null;
    if (!row || price === null || (needOnShelf && !row.available)) {
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
  return lines;
}

/** The next order number of a store (ONL-000001…); the lock keeps two orders off the same one */
async function nextOrderNumber(tx: Transaction, tenantId: string): Promise<{ seq: number; number: string }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('online_orders'), hashtext(${tenantId}))`);
  const [last] = await tx.execute<{ seq: number | null }>(
    sql`select max(seq) as seq from online_orders where tenant_id = ${tenantId}`,
  );
  const seq = (last?.seq ?? 0) + 1;
  return { seq, number: `ONL-${String(seq).padStart(6, '0')}` };
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

const codeUnavailable = () =>
  new AppError(503, 'unavailable', 'تعذّر إرسال الرمز الآن. أعد المحاولة بعد قليل.');

/**
 * «من المتجر مباشرة»: a code to the customer's phone first, so an order always has a number that
 * answers. The challenge holds which store asked; the code is checked when the order is placed.
 */
export async function requestShopCode(
  app: FastifyInstance,
  slug: string,
  input: z.output<typeof shopCodeInput>,
  meta: RequestMeta,
): Promise<ShopCodeSent> {
  const { db, clock, env, otpSender } = app;
  const tenantId = await tenantOf(db, slug);
  const store = await withTenant(db, tenantId, (tx) => storeOf(tx, tenantId));
  if (store.order_mode !== 'shop') throw fieldError('phone', 'هذا المتجر يستقبل الطلبات على واتساب.');
  if (!otpSender) throw codeUnavailable();
  const challengeId = uuidv7();
  const code = newOtpCode();
  const now = clock.now();
  await db.execute(sql`select otp_create(
    ${challengeId}::uuid, 'shop_order', ${input.phone}, ${hashOtp(env.JWT_SECRET, challengeId, code)},
    ${JSON.stringify({ tenantId })}::jsonb, ${new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString()}::timestamptz,
    ${meta.ip}, ${now.toISOString()}::timestamptz)`);
  try {
    await otpSender.send({ phone: input.phone, code, purpose: 'shop_order' });
  } catch (error) {
    if (error instanceof OtpDeliveryError) throw codeUnavailable();
    throw error;
  }
  const answer: ShopCodeSent = { challengeId, expiresIn: CODE_TTL_SECONDS };
  return isTestMode(env) ? { ...answer, testCode: code } : answer;
}

/**
 * The code is used up before the order is written, outside its transaction: a wrong one counts an
 * attempt even though the order fails, so five guesses lock it.
 */
async function checkShopCode(
  app: FastifyInstance,
  tenantId: string,
  input: z.output<typeof shopOrderInput>,
): Promise<void> {
  if (!input.challengeId || !input.code) throw fieldError('code', 'اكتب الرمز الذي وصلك على جوالك');
  const [result] = await app.db.execute<{
    status: string;
    phone: string | null;
    payload: { tenantId?: string } | null;
  }>(
    sql`select * from otp_consume(${input.challengeId}::uuid, 'shop_order',
      ${hashOtp(app.env.JWT_SECRET, input.challengeId, input.code)}, ${MAX_CODE_ATTEMPTS},
      ${app.clock.now().toISOString()}::timestamptz)`,
  );
  if (result?.status === 'locked') {
    throw new AppError(429, 'locked', 'محاولات خاطئة كثيرة. اطلب رمزاً جديداً.');
  }
  if (result?.status === 'expired') throw fieldError('code', 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.');
  if (result?.status !== 'ok' || result.payload?.tenantId !== tenantId || result.phone !== input.phone) {
    throw fieldError('code', 'الرمز غير صحيح. تأكد منه وأعد المحاولة.');
  }
}

export function placeShopOrder(
  app: FastifyInstance,
  slug: string,
  input: z.output<typeof shopOrderInput>,
): Promise<ShopOrderPlaced> {
  const { db } = app;
  return tenantOf(db, slug).then(async (tenantId) => {
    const mode = (await withTenant(db, tenantId, (tx) => storeOf(tx, tenantId))).order_mode;
    if (mode === 'shop') await checkShopCode(app, tenantId, input);
    return withTenant(db, tenantId, async (tx) => {
      const store = await storeOf(tx, tenantId);
      const base = store.base as CurrencyCode;
      if (input.fulfilment === 'delivery' && !store.delivery)
        throw fieldError('fulfilment', 'هذا المحل لا يوصّل، الاستلام من المحل.');
      if (input.fulfilment === 'pickup' && !store.pickup)
        throw fieldError('fulfilment', 'هذا المحل يوصّل فقط.');
      if (input.fulfilment === 'delivery' && !input.address)
        throw fieldError('address', 'اكتب عنوان التوصيل');
      const lines = await priceLines(tx, base, input.lines, true);
      const totalMinor = lines.reduce((n, l) => n + l.totalMinor, 0);
      const { seq, number } = await nextOrderNumber(tx, tenantId);
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
      const [made] = await tx
        .insert(onlineOrders)
        .values({ tenantId, seq, source: mode, ...order })
        .returning({ token: onlineOrders.trackToken });
      const message = orderMessage(order);
      return {
        trackPath: `/shop/${store.slug}/o/${made!.token}`,
        number,
        currency: base,
        totalMinor,
        message,
        whatsappUrl:
          mode === 'whatsapp' && store.whatsapp
            ? `https://wa.me/${store.whatsapp.replace('+', '')}?text=${encodeURIComponent(message)}`
            : null,
      };
    });
  });
}

/**
 * «احجز» at the till (03 › الألبسة: الحجز بعربون): the cart held for a customer at this branch, as
 * an accepted order, so its pieces are held and it waits on the tills for pickup.
 */
export function placeHold(
  db: Database,
  device: DeviceClaims,
  input: z.output<typeof holdInput>,
): Promise<HoldPlaced> {
  return withTenant(db, device.tenantId, async (tx) => {
    const [settings] = await tx.execute<{ base: string }>(
      sql`select base_currency as base from tenant_settings where tenant_id = ${device.tenantId}`,
    );
    const base = (settings?.base ?? 'SYP') as CurrencyCode;
    const lines = await priceLines(tx, base, input.lines, false);
    const totalMinor = lines.reduce((n, l) => n + l.totalMinor, 0);
    const { seq, number } = await nextOrderNumber(tx, device.tenantId);
    const [made] = await tx
      .insert(onlineOrders)
      .values({
        tenantId: device.tenantId,
        seq,
        number,
        status: 'accepted',
        source: 'hold',
        customerName: input.customerName,
        phone: input.phone,
        fulfilment: 'pickup',
        address: null,
        note: input.note || null,
        currency: base,
        totalMinor,
        lines,
        branchId: device.branchId,
        depositCode: input.depositCode,
        decidedAt: sql`now()`,
      })
      .returning({ id: onlineOrders.id });
    return { id: made!.id, number, currency: base, totalMinor };
  });
}

/** The 32 letters and digits of a track token, and nothing else */
function isTrackToken(token: string): boolean {
  if (token.length !== 32) return false;
  for (const ch of token) if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
  return true;
}

/** The customer's page for one order: its state and lines, by the unguessable token in its link. */
export function shopOrderTrack(db: Database, slug: string, token: string): Promise<ShopOrderTrack> {
  const gone = () => notFound('هذا الطلب غير موجود.');
  if (!isTrackToken(token)) return Promise.reject(gone());
  return tenantOf(db, slug).then((tenantId) =>
    withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(onlineOrders)
        .where(and(eq(onlineOrders.tenantId, tenantId), eq(onlineOrders.trackToken, token)));
      if (!row) throw gone();
      return {
        number: row.number,
        status: row.status as ShopOrderTrack['status'],
        fulfilment: row.fulfilment as ShopOrderTrack['fulfilment'],
        currency: row.currency as CurrencyCode,
        totalMinor: row.totalMinor,
        lines: row.lines.map((l) => ({ name: l.name, label: l.label, qty: l.qty, totalMinor: l.totalMinor })),
        createdAt: row.createdAt.toISOString(),
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
  orderMode: 'whatsapp',
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
      orderMode: row.orderMode as OnlineStoreSettings['orderMode'],
    };
  });
}

export async function saveOnlineStore(
  db: Database,
  auth: AccessClaims,
  input: z.output<typeof onlineStoreInput>,
  meta: RequestMeta,
): Promise<OnlineStoreSettings> {
  if (input.enabled && input.orderMode === 'whatsapp' && !input.whatsapp)
    throw fieldError('whatsapp', 'اكتب رقم واتساب الطلبات لتفعيل المتجر');
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
        orderMode: input.orderMode,
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
  source: r.source as OnlineOrder['source'],
  depositCode: r.depositCode,
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
