import type { FastifyInstance } from 'fastify';
import { serialQuery } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { lookupSerials } from '../services/serials';
import { parseBody } from './validation';

/** Serial numbers and IMEIs (packages/core › contracts/purchases.ts SerialRow). */
export async function serialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/serials', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return lookupSerials(app.db, request.auth, parseBody(serialQuery, request.query).q);
  });
}
