import type { FastifyInstance } from 'fastify';
import {
  activeInput,
  regionInput,
  regionUpdateInput,
  repInput,
  repUpdateInput,
  routeCustomersInput,
  routeInput,
  routeUpdateInput,
  uuidSchema,
  vanInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  createRegion,
  createRep,
  createRoute,
  createVan,
  getRoute,
  listRegions,
  listReps,
  listRoutes,
  listVans,
  setRepActive,
  setRouteCustomers,
  setVanActive,
  updateRegion,
  updateRep,
  updateRoute,
  updateVan,
} from '../services/distribution';
import { parseBody } from './validation';

/**
 * «المندوبون والتوزيع», the setup side (packages/core › contracts/distribution.ts): regions, vans,
 * reps and routes, for `routes.manage` and only on a plan that has the module (plans.limits.reps).
 */
export async function distributionRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: Parameters<typeof clientIp>[0] & { headers: Record<string, unknown> }) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown, what: string) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', `${what} غير موجود.`);
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  // Regions
  app.get('/v1/regions', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listRegions(app.db, request.auth);
  });
  app.post('/v1/regions', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createRegion(
      app.db,
      request.auth,
      parseBody(regionInput, request.body),
      meta(request),
    );
    return reply.code(201).send(made);
  });
  app.patch('/v1/regions/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateRegion(
      app.db,
      request.auth,
      idOf(request.params, 'هذه المنطقة'),
      parseBody(regionUpdateInput, request.body),
      meta(request),
    );
  });

  // Vans: branches of kind van
  app.get('/v1/vans', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listVans(app.db, request.auth);
  });
  app.post('/v1/vans', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createVan(app.db, request.auth, parseBody(vanInput, request.body), meta(request));
    return reply.code(201).send(made);
  });
  app.patch('/v1/vans/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateVan(
      app.db,
      request.auth,
      idOf(request.params, 'هذه السيارة'),
      parseBody(vanInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/vans/:id/active', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const { active } = parseBody(activeInput, request.body);
    return setVanActive(app.db, request.auth, idOf(request.params, 'هذه السيارة'), active, meta(request));
  });

  // Reps
  app.get('/v1/reps', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listReps(app.db, request.auth);
  });
  app.post('/v1/reps', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createRep(app.db, request.auth, parseBody(repInput, request.body), meta(request));
    return reply.code(201).send(made);
  });
  app.patch('/v1/reps/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateRep(
      app.db,
      request.auth,
      idOf(request.params, 'هذا المندوب'),
      parseBody(repUpdateInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/reps/:id/active', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const { active } = parseBody(activeInput, request.body);
    return setRepActive(app.db, request.auth, idOf(request.params, 'هذا المندوب'), active, meta(request));
  });

  // Routes and the customers on them
  app.get('/v1/routes', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listRoutes(app.db, request.auth);
  });
  app.post('/v1/routes', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createRoute(app.db, request.auth, parseBody(routeInput, request.body), meta(request));
    return reply.code(201).send(made);
  });
  app.get('/v1/routes/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return getRoute(app.db, request.auth, idOf(request.params, 'خط السير هذا'));
  });
  app.patch('/v1/routes/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateRoute(
      app.db,
      request.auth,
      idOf(request.params, 'خط السير هذا'),
      parseBody(routeUpdateInput, request.body),
      meta(request),
    );
  });
  app.put('/v1/routes/:id/customers', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return setRouteCustomers(
      app.db,
      request.auth,
      idOf(request.params, 'خط السير هذا'),
      parseBody(routeCustomersInput, request.body),
      meta(request),
    );
  });
}
