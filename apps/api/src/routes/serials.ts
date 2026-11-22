import type { FastifyInstance } from 'fastify';
import { serialFixInput, serialQuery, stockSerialsQuery } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { fixSerial, lookupSerials, stockSerials, unassignedSales } from '../services/serials';
import { parseBody } from './validation';

/** Serial numbers and IMEIs (packages/core › contracts/purchases.ts SerialRow). */
export async function serialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/serials', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return lookupSerials(app.db, request.auth, parseBody(serialQuery, request.query));
  });

  // «بيعات بلا رقم»: sales that left without a serial, with the in-stock numbers to pick from
  app.get('/v1/serials/unassigned', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return unassignedSales(app.db, request.auth);
  });

  // The numbers in stock in a branch for a product: a count picks the missing pieces from them (round 60)
  app.get('/v1/inventory/serials', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return stockSerials(app.db, request.auth, parseBody(stockSerialsQuery, request.query));
  });

  // «تصحيح»: a drifted row back in stock, or sold again by its latest sale
  app.post('/v1/serials/fix', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return fixSerial(app.db, request.auth, parseBody(serialFixInput, request.body), {
      ip: clientIp(request),
      userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
    });
  });
}
