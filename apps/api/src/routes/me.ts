import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { loadMe } from '../services/me';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/me', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return loadMe(app.db, request.auth, app.clock.now());
  });
}
