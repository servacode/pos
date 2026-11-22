import type { FastifyInstance } from 'fastify';
import { cancellationsQuery, hallCommand, kitchenCommand } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  cancellationsReport,
  hallCommandRun,
  hallMenu,
  hallState,
  kitchenCommandRun,
  kitchenState,
} from '../services/hall';
import { parseBody } from './validation';

/** The hall, the kitchen screen and the waiter (packages/core › contracts/hall.ts). */
export async function hallRoutes(app: FastifyInstance): Promise<void> {
  const { db, clock, passwords } = app;

  app.get('/v1/device/hall', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return hallState(db, request.device, clock.now());
  });

  app.post('/v1/device/hall', { onRequest: requireDevice({ write: true }) }, async (request) => {
    if (!request.device) throw unauthorized();
    return hallCommandRun(db, passwords, request.device, parseBody(hallCommand, request.body), clock.now(), {
      ip: clientIp(request),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
  });

  app.get('/v1/device/kitchen', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return kitchenState(db, request.device, clock.now());
  });

  app.post('/v1/device/kitchen', { onRequest: requireDevice({ write: true }) }, async (request) => {
    if (!request.device) throw unauthorized();
    return kitchenCommandRun(db, request.device, parseBody(kitchenCommand, request.body), clock.now());
  });

  app.get('/v1/device/menu', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return hallMenu(db, request.device);
  });

  app.get('/v1/hall/cancellations', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return cancellationsReport(db, request.auth, parseBody(cancellationsQuery, request.query), clock.now());
  });
}
