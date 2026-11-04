import type { FastifyInstance } from 'fastify';
import { broadcastInput, broadcastPreviewInput } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { createBroadcast, listBroadcasts, previewBroadcast, resumeBroadcasts } from '../services/broadcasts';
import { parseBody } from './validation';

/** Messages to the store's customers (packages/core › contracts/broadcasts.ts). */
export async function broadcastRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onReady', async () => {
    await resumeBroadcasts(app);
  });
  app.post('/v1/broadcasts/preview', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return previewBroadcast(app, request.auth, parseBody(broadcastPreviewInput, request.body).audience);
  });
  app.post('/v1/broadcasts', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createBroadcast(app, request.auth, parseBody(broadcastInput, request.body), {
      ip: clientIp(request),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
    return reply.status(201).send(made);
  });
  app.get('/v1/broadcasts', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listBroadcasts(app, request.auth);
  });
}
