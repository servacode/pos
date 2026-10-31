import type { FastifyInstance } from 'fastify';
import { setPinInput } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { loadMe } from '../services/me';
import { setMyPin } from '../services/staff';
import { parseBody } from './validation';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/me', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return loadMe(app.db, request.auth, app.clock.now());
  });

  // «رمز الدخول للكاشير» (packages/core › contracts/staff.ts): 204, no body.
  app.put('/v1/me/pin', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const input = parseBody(setPinInput, request.body);
    await setMyPin(app.db, app.passwords, request.auth, input, {
      ip: clientIp(request),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
    return reply.status(204).send();
  });
}
