import type { FastifyInstance } from 'fastify';
import { customerInput, customerListQuery, uuidSchema } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { createCustomer, listCustomers, readCustomer, updateCustomer } from '../services/customers';
import { parseBody } from './validation';

/** Customers and their balances (packages/core › contracts/customers.ts). */
export async function customerRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا الزبون غير موجود.');
    return parsed.data;
  };

  app.get('/v1/customers', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listCustomers(app.db, request.auth, parseBody(customerListQuery, request.query));
  });

  app.post('/v1/customers', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createCustomer(
      app.db,
      request.auth,
      parseBody(customerInput, request.body),
      meta(request),
      app.clock.now(),
    );
    return reply.code(201).send(created);
  });

  app.get('/v1/customers/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return readCustomer(app.db, request.auth, idOf(request.params));
  });

  app.put('/v1/customers/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateCustomer(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(customerInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });
}
