import type { FastifyInstance } from 'fastify';
import {
  committedQuery,
  pickingListQuery,
  salesOrderAssignInput,
  salesOrderCancelInput,
  salesOrderCreateInput,
  salesOrderListQuery,
  uuidSchema,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  assignSalesOrder,
  cancelSalesOrder,
  committedQuantities,
  createSalesOrder,
  getSalesOrder,
  listSalesOrders,
  pickingList,
} from '../services/sales-orders';
import { parseBody } from './validation';

/**
 * «طلبيات البيع المسبق» (packages/core › contracts/distribution.ts): the supervisor's list, picking
 * list, dispatch and cancel, and the rep phone's way to take an order. An order posts nothing.
 */
export async function salesOrderRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: Parameters<typeof clientIp>[0] & { headers: Record<string, unknown> }) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذه الطلبية غير موجودة.');
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  app.get('/v1/sales-orders', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listSalesOrders(app.db, request.auth, parseBody(salesOrderListQuery, request.query));
  });
  app.get('/v1/sales-orders/picking', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return pickingList(app.db, request.auth, parseBody(pickingListQuery, request.query));
  });
  app.get('/v1/sales-orders/committed', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return committedQuantities(
      app.db,
      request.auth,
      parseBody(committedQuery, request.query).warehouseBranchId,
    );
  });
  app.get('/v1/sales-orders/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return getSalesOrder(app.db, request.auth, idOf(request.params));
  });
  app.post('/v1/sales-orders', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createSalesOrder(
      app.db,
      { kind: 'user', auth: request.auth },
      parseBody(salesOrderCreateInput, request.body),
      meta(request),
    );
    return reply.code(201).send(made);
  });
  app.post('/v1/sales-orders/:id/cancel', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return cancelSalesOrder(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(salesOrderCancelInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/sales-orders/:id/assign', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return assignSalesOrder(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(salesOrderAssignInput, request.body),
      meta(request),
    );
  });

  // A rep's phone takes an order; sent again with the same id it is the same order
  app.post(
    '/v1/device/sales-orders',
    { onRequest: requireDevice({ write: true }) },
    async (request, reply) => {
      if (!request.device) throw unauthorized();
      const made = await createSalesOrder(
        app.db,
        { kind: 'device', device: request.device },
        parseBody(salesOrderCreateInput, request.body),
        meta(request),
      );
      return reply.code(201).send(made);
    },
  );
}
