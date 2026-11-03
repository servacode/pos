import type { FastifyInstance } from 'fastify';
import { promotionInput, promotionUpdateInput, uuidSchema } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { createPromotion, listPromotions, updatePromotion } from '../services/promotions';
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
}
