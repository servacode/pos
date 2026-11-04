import type { FastifyInstance } from 'fastify';
import { alterationInput, alterationListQuery, alterationStatusInput, uuidSchema } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { AppError, unauthorized } from '../errors';
import { createAlteration, listAlterations, setAlterationStatus } from '../services/alterations';
import { parseBody } from './validation';

/** Alteration tickets on the tills (packages/core › contracts/alterations.ts). */
export async function alterationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/device/alterations', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return listAlterations(app.db, request.device, parseBody(alterationListQuery, request.query).status);
  });
  app.post('/v1/device/alterations', { onRequest: requireDevice() }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const made = await createAlteration(app.db, request.device, parseBody(alterationInput, request.body));
    return reply.status(201).send(made);
  });
  app.post('/v1/device/alterations/:id/status', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    const parsed = uuidSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذه التذكرة غير موجودة.');
    return setAlterationStatus(
      app.db,
      request.device,
      parsed.data,
      parseBody(alterationStatusInput, request.body),
    );
  });
}
