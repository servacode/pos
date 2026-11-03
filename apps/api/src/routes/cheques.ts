import type { FastifyInstance } from 'fastify';
import { chequeActionInput, chequeListQuery } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { actOnCheque, listCheques } from '../services/cheques';
import { parseBody } from './validation';

/** Cheques under collection (packages/core › contracts/cheques.ts). */
export async function chequeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/cheques', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listCheques(app.db, request.auth, parseBody(chequeListQuery, request.query).status);
  });

  app.post('/v1/cheques/actions', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return actOnCheque(app.db, request.auth, parseBody(chequeActionInput, request.body), {
      ip: clientIp(request),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
  });
}
