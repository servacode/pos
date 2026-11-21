import type { FastifyInstance } from 'fastify';
import { countSheetQuery, tillWasteInput, wasteReportQuery } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { countSheet, tillWaste, wasteReport } from '../services/stock-waste';
import { parseBody } from './validation';

/** «تالف / هدر» at the till, the waste report and the phone's count sheet (round 38; services/stock-waste.ts) */
export async function stockWasteRoutes(app: FastifyInstance): Promise<void> {
  const opts = { preHandler: requireAuth };
  app.post('/v1/device/waste', { onRequest: requireDevice({ write: true }) }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const done = await tillWaste(
      app.db,
      request.device,
      parseBody(tillWasteInput, request.body),
      app.clock.now(),
      {
        ip: clientIp(request),
        userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
      },
    );
    return reply.code(201).send(done);
  });
  app.get('/v1/reports/waste', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return wasteReport(app.db, request.auth, parseBody(wasteReportQuery, request.query));
  });
  app.get('/v1/inventory/count-sheet', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return countSheet(app.db, request.auth, parseBody(countSheetQuery, request.query), app.clock.now());
  });
}
