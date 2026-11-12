import type { FastifyInstance } from 'fastify';
import {
  holdInput,
  onlineOrderListQuery,
  onlineOrderStatusInput,
  onlineStoreInput,
  shopCodeInput,
  shopOrderInput,
  uuidSchema,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  getOnlineStore,
  listOnlineOrders,
  placeHold,
  placeShopOrder,
  requestShopCode,
  saveOnlineStore,
  setOnlineOrderStatus,
  shopHome,
  shopOrderTrack,
  shopProduct,
} from '../services/shop';
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

  // ─── Public: anyone with the link ────────────────────────────────────────
  app.get('/v1/shop/:slug', async (request) => shopHome(app.db, slugOf(request.params)));
  app.get('/v1/shop/:slug/products/:id', async (request) =>
    shopProduct(app.db, slugOf(request.params), idOf(request.params, 'هذا الصنف غير موجود.')),
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
    async (request) =>
      requestShopCode(app, slugOf(request.params), parseBody(shopCodeInput, request.body), meta(request)),
  );
  app.get('/v1/shop/:slug/orders/:token', async (request) =>
    shopOrderTrack(
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
    return listOnlineOrders(app.db, request.auth, parseBody(onlineOrderListQuery, request.query).status);
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
