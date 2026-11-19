import type { FastifyInstance } from 'fastify';
import { periodCloseInput, periodReopenInput } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { closePeriod, periodCloseState, reopenPeriod } from '../services/period-close';
import { parseBody } from './validation';

/** «إقفال الفترة» (packages/core › contracts/period-close.ts). Each service checks its own permission. */
export async function periodCloseRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const opts = { preHandler: requireAuth };

  app.get('/v1/period-close', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return periodCloseState(app.db, request.auth, app.clock.now());
  });
  app.post('/v1/period-close/close', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return closePeriod(
      app.db,
      request.auth,
      parseBody(periodCloseInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });
  app.post('/v1/period-close/reopen', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return reopenPeriod(
      app.db,
      request.auth,
      parseBody(periodReopenInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });
}
