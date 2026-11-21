import type { FastifyInstance } from 'fastify';
import {
  uuidSchema,
  warrantyClaimInput,
  warrantyListQuery,
  warrantyLookupQuery,
  warrantyStatusInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import {
  createWarrantyClaim,
  listWarrantyClaims,
  lookupWarranty,
  setWarrantyStatus,
} from '../services/warranty';
import { parseBody } from './validation';

/** Warranty and maintenance claims (packages/core › contracts/warranty.ts). */
export async function warrantyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/warranty/lookup', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return lookupWarranty(app.db, request.auth, parseBody(warrantyLookupQuery, request.query).serial);
  });
  app.get('/v1/warranty/claims', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listWarrantyClaims(app.db, request.auth, parseBody(warrantyListQuery, request.query).status);
  });
  app.post('/v1/warranty/claims', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createWarrantyClaim(app.db, request.auth, parseBody(warrantyClaimInput, request.body));
    return reply.status(201).send(made);
  });
  app.post('/v1/warranty/claims/:id/status', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const parsed = uuidSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذه المطالبة غير موجودة.');
    return setWarrantyStatus(app.db, request.auth, parsed.data, parseBody(warrantyStatusInput, request.body));
  });
}
