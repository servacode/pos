import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { controlledRegisterQuery, shortageRequestInput } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { controlledRegister } from '../services/pharmacy';
import { listShortages, recordShortageRequest, resolveShortages } from '../services/shortages';
import { parseBody } from './validation';

const resolveInput = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

/** «سجل الأدوية المراقبة» and «النواقص» (packages/core › contracts/pharmacy.ts). */
export async function pharmacyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/pharmacy/controlled-register', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return controlledRegister(app.db, request.auth, parseBody(controlledRegisterQuery, request.query));
  });

  // «طلبو زبون وما كان موجود»: a till writes the request with its own id (a retry writes nothing twice)
  app.post('/v1/device/shortages', { onRequest: requireDevice({ write: true }) }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const placed = await recordShortageRequest(
      app.db,
      request.device,
      parseBody(shortageRequestInput, request.body),
    );
    return reply.status(placed.created ? 201 : 200).send(placed);
  });

  app.get('/v1/pharmacy/shortages', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listShortages(app.db, request.auth);
  });

  app.post('/v1/pharmacy/shortages/resolve', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const { ids } = parseBody(resolveInput, request.body);
    await resolveShortages(app.db, request.auth, ids, {
      ip: clientIp(request),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
    return listShortages(app.db, request.auth);
  });
}
