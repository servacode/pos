import type { FastifyInstance } from 'fastify';
import {
  holdInput,
  onlineOrderDeliveryInput,
  onlineOrderListQuery,
  onlineOrderStatusInput,
  onlineStoreInput,
  priceHistoryQuery,
  productImageInput,
  productTextsInput,
  shopCodeInput,
  shopCouponQuery,
  shopOrderInput,
  shopQuoteInput,
  stockAlertInput,
  uuidSchema,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { enforceLimits } from '../http/rate-limit';
import {
  getOnlineStore,
  listOnlineOrders,
  placeHold,
  placeShopOrder,
  requestOrderCancel,
  requestShopCode,
  saveOnlineStore,
  setOnlineOrderStatus,
  shopHome,
  shopOrderTrack,
  shopProduct,
} from '../services/shop';
import { priceHistory } from '../services/price-history';
import { catalogueKeepMs, keepCatalogue, keptCatalogue } from '../services/shop-cache';
import {
  codSummary,
  getProductTexts,
  listStockAlerts,
  markStockAlertNotified,
  notifyStockAlert,
  removeStoreImage,
  saveProductTexts,
  setOrderDelivery,
  setStoreImage,
  shopCoupon,
  shopQuote,
  type StoreImageSlot,
} from '../services/shop-extras';
import { parseBody } from './validation';

/** The online shop (packages/core › contracts/shop.ts): its public pages and the dashboard's side. */
export async function shopRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const slugOf = (params: unknown) => String((params as { slug?: string }).slug ?? '').slice(0, 60);
  const idOf = (params: unknown, message: string) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', message);
    return parsed.data;
  };

  // One catalogue per link per half minute, shared by the visits in between (a busy link is one query, not one per visit).
  // Any owner's save that the shop shows drops it (hook in app.ts), so an edit is live at once.
  const catalogue = (slug: string) => {
    const now = Date.now();
    const hit = keptCatalogue<Awaited<ReturnType<typeof shopHome>>>(slug, now);
    if (hit) return hit;
    const home = shopHome(app.db, slug);
    if (catalogueKeepMs() > 0) keepCatalogue(slug, now, home);
    return home;
  };

  // ─── Public: anyone with the link ────────────────────────────────────────
  // The catalogue is the same for everyone: a customer's browser (and a shared link's preview) may keep it half a minute
  app.get('/v1/shop/:slug', async (request, reply) => {
    // The answer is stamped cacheable only once it is a catalogue: a missing or switched-off shop is never kept
    const home = await catalogue(slugOf(request.params));
    reply.header('cache-control', 'public, max-age=30');
    return home;
  });
  app.get('/v1/shop/:slug/products/:id', async (request) =>
    shopProduct(app.db, slugOf(request.params), idOf(request.params, 'هذا الصنف غير موجود.')),
  );
  // «كود الخصم»: a few tries a minute from one address, so a code cannot be guessed
  app.get(
    '/v1/shop/:slug/coupon',
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (request) =>
      shopCoupon(app.db, slugOf(request.params), parseBody(shopCouponQuery, request.query).code),
  );
  // «أبلغني عند التوفر»: a phone left on a piece that is out of stock
  app.post(
    '/v1/shop/:slug/products/:id/notify',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      await notifyStockAlert(
        app.db,
        slugOf(request.params),
        idOf(request.params, 'هذا الصنف غير موجود.'),
        parseBody(stockAlertInput, request.body),
      );
      return reply.status(204).send();
    },
  );
  // A few orders a minute from one address is plenty for a person; more is someone else
  app.post(
    '/v1/shop/:slug/orders',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const placed = await placeShopOrder(
        app,
        slugOf(request.params),
        parseBody(shopOrderInput, request.body),
      );
      return reply.status(201).send(placed);
    },
  );
  // A code costs a message: a few a minute from one address
  app.post(
    '/v1/shop/:slug/orders/code',
    { config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
    async (request, reply) => {
      const input = parseBody(shopCodeInput, request.body);
      // A message costs money and reaches a stranger: a few per number, and a ceiling per store
      await enforceLimits(request, reply, 10 * 60_000, [{ key: `shop-code:phone:${input.phone}`, max: 4 }]);
      await enforceLimits(request, reply, 60 * 60_000, [
        { key: `shop-code:store:${slugOf(request.params)}`, max: 120 },
      ]);
      return requestShopCode(app, slugOf(request.params), input, meta(request));
    },
  );
  // What the cart really costs, priced by the server (the offers and the code, as the order will be)
  app.post(
    '/v1/shop/:slug/quote',
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (request) => shopQuote(app.db, slugOf(request.params), parseBody(shopQuoteInput, request.body)),
  );
  app.get('/v1/shop/:slug/orders/:token', async (request) =>
    shopOrderTrack(
      app.db,
      slugOf(request.params),
      String((request.params as { token?: string }).token ?? '').slice(0, 64),
    ),
  );

  // A few a minute from one address: a customer asks once
  app.post(
    '/v1/shop/:slug/orders/:token/cancel-request',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request) =>
      requestOrderCancel(
        app.db,
        slugOf(request.params),
        String((request.params as { token?: string }).token ?? '').slice(0, 64),
      ),
  );

  // ─── The till: «احجز» ────────────────────────────────────────────────────
  app.post('/v1/device/holds', { onRequest: requireDevice({ write: true }) }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const placed = await placeHold(app.db, request.device, parseBody(holdInput, request.body));
    return reply.status(201).send(placed);
  });

  // ─── The dashboard ───────────────────────────────────────────────────────
  app.get('/v1/online-store', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return getOnlineStore(app.db, request.auth);
  });
  app.put('/v1/online-store', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return saveOnlineStore(app.db, request.auth, parseBody(onlineStoreInput, request.body), meta(request));
  });
  app.get('/v1/online-orders', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listOnlineOrders(app.db, request.auth, parseBody(onlineOrderListQuery, request.query));
  });
  app.get('/v1/online-orders/cod', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return codSummary(app.db, request.auth);
  });
  app.post('/v1/online-orders/:id/delivery', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return setOrderDelivery(
      app.db,
      request.auth,
      idOf(request.params, 'هذا الطلب غير موجود.'),
      parseBody(onlineOrderDeliveryInput, request.body),
      meta(request),
    );
  });
  // The logo and the cover banner
  const slotOf = (params: unknown): StoreImageSlot => {
    const slot = (params as { slot?: string }).slot;
    if (slot !== 'logo' && slot !== 'cover') throw new AppError(404, 'not_found', 'هذه الصورة غير موجودة.');
    return slot;
  };
  app.put(
    '/v1/online-store/image/:slot',
    { preHandler: requireAuth, bodyLimit: 4 * 1024 * 1024 },
    async (request) => {
      if (!request.auth) throw unauthorized();
      return setStoreImage(
        app.db,
        request.auth,
        slotOf(request.params),
        parseBody(productImageInput, request.body),
        meta(request),
      );
    },
  );
  app.delete('/v1/online-store/image/:slot', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return removeStoreImage(app.db, request.auth, slotOf(request.params), meta(request));
  });
  // The product's description, size guide and the phones waiting for it; the price history
  app.get('/v1/products/:id/shop-text', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return getProductTexts(app.db, request.auth, idOf(request.params, 'هذا المنتج غير موجود.'));
  });
  app.put('/v1/products/:id/shop-text', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return saveProductTexts(
      app.db,
      request.auth,
      idOf(request.params, 'هذا المنتج غير موجود.'),
      parseBody(productTextsInput, request.body),
      meta(request),
    );
  });
  app.get('/v1/products/:id/stock-alerts', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listStockAlerts(app.db, request.auth, idOf(request.params, 'هذا المنتج غير موجود.'));
  });
  app.post('/v1/stock-alerts/:id/notified', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return markStockAlertNotified(
      app.db,
      request.auth,
      idOf(request.params, 'هذا الطلب غير موجود.'),
      meta(request),
    );
  });
  app.get('/v1/price-history', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return priceHistory(app.db, request.auth, parseBody(priceHistoryQuery, request.query));
  });
  app.post('/v1/online-orders/:id/status', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return setOnlineOrderStatus(
      app.db,
      request.auth,
      idOf(request.params, 'هذا الطلب غير موجود.'),
      parseBody(onlineOrderStatusInput, request.body),
      meta(request),
    );
  });
}
