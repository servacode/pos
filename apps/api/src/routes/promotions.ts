import type { FastifyInstance } from 'fastify';
import {
  promotionArchiveInput,
  promotionInput,
  promotionEndDateInput,
  promotionPreviewInput,
  promotionReportQuery,
  promotionUpdateInput,
  uuidSchema,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  archivePromotion,
  createPromotion,
  listPromotions,
  promotionPreview,
  promotionReport,
  setPromotionEndDate,
  updatePromotion,
} from '../services/promotions';
import { parseBody } from './validation';

/** Promotions (packages/core › contracts/promotions.ts). */
export async function promotionRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });

  app.get('/v1/promotions', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listPromotions(app.db, request.auth);
  });

  app.get('/v1/promotions/report', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return promotionReport(app.db, request.auth, parseBody(promotionReportQuery, request.query));
  });

  app.post('/v1/promotions/preview', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return promotionPreview(app.db, request.auth, parseBody(promotionPreviewInput, request.body));
  });

  app.post('/v1/promotions', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createPromotion(
      app.db,
      request.auth,
      parseBody(promotionInput, request.body),
      meta(request),
      app.clock.now(),
    );
    return reply.code(201).send(created);
  });

  app.put('/v1/promotions/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const parsed = uuidSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا العرض غير موجود.');
    return updatePromotion(
      app.db,
      request.auth,
      parsed.data,
      parseBody(promotionUpdateInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });

  // Stopping or restarting an offer touches nothing else of it: an old row that today's form would refuse can still be stopped
  app.post('/v1/promotions/:id/archive', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const parsed = uuidSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا العرض غير موجود.');
    return archivePromotion(
      app.db,
      request.auth,
      parsed.data,
      parseBody(promotionArchiveInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });

  // Moving the end of an offer from the list touches nothing else of it
  app.post('/v1/promotions/:id/end-date', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const parsed = uuidSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا العرض غير موجود.');
    return setPromotionEndDate(
      app.db,
      request.auth,
      parsed.data,
      parseBody(promotionEndDateInput, request.body),
      meta(request),
    );
  });
}
