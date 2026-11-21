import type { FastifyInstance } from 'fastify';
import { repDayStartInput, repVisitReportInput } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { unauthorized } from '../errors';
import { recordRepVisit, repDaySheet, startRepDay } from '../services/rep-day';
import { parseBody } from './validation';

/**
 * The rep's phone (packages/core › distribution.ts): its day sheet and the two small writes of a
 * day. The device is the only input that names a rep, so there is nothing to forge.
 */
export async function repDayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/device/rep/day', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return repDaySheet(app.db, request.device);
  });
  app.post('/v1/device/rep/day', { onRequest: requireDevice({ write: true }) }, async (request) => {
    if (!request.device) throw unauthorized();
    return startRepDay(app.db, request.device, parseBody(repDayStartInput, request.body));
  });
  app.post('/v1/device/rep/visits', { onRequest: requireDevice({ write: true }) }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const made = await recordRepVisit(app.db, request.device, parseBody(repVisitReportInput, request.body));
    return reply.status(201).send(made);
  });
}
