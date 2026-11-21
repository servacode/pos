import type { FastifyInstance } from 'fastify';
import { setPinInput } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { loadHomeSummary } from '../services/home';
import { loadMe } from '../services/me';
import { searchRecords } from '../services/record-search';
import { setMyPin } from '../services/staff';
import { parseBody } from './validation';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/me', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return loadMe(app.db, request.auth, app.clock.now(), app.env.SUBSCRIPTION_ENFORCEMENT);
  });

  // The few numbers of the home page (debts, goods without a photo), each only for who may open them
  app.get('/v1/me/home-summary', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return loadHomeSummary(app.db, request.auth, app.clock.now());
  });

  // The top bar's search: a few suppliers, purchase invoices, returns, online orders, rentals and claims by what was typed
  app.get('/v1/me/search', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const q = (request.query as { q?: unknown }).q;
    return { items: await searchRecords(app.db, request.auth, typeof q === 'string' ? q.slice(0, 120) : '') };
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
