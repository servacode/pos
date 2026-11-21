import type { FastifyInstance } from 'fastify';
import {
  customerGroupInput,
  customerInput,
  customerListQuery,
  customerOpeningDebtInput,
  customerPaymentInput,
  uuidSchema,
  voucherListQuery,
  voucherUpdateInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { requireDevice } from '../auth/device-guard';
import { openCustomerDebt, receiveCustomerPayment } from '../services/customer-money';
import {
  archiveDuplicateCustomer,
  createCustomer,
  customerPurchases,
  customerPurchasesForDevice,
  listCustomers,
  readCustomer,
  updateCustomer,
} from '../services/customers';
import { listVouchers, updateVoucher } from '../services/vouchers-admin';
import { createCustomerGroup, listCustomerGroups, updateCustomerGroup } from '../services/customer-groups';
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

  app.get('/v1/vouchers', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listVouchers(app.db, request.auth, parseBody(voucherListQuery, request.query));
  });

  app.put('/v1/vouchers/:code', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const code = String((request.params as { code?: string }).code ?? '').slice(0, 64);
    return updateVoucher(
      app.db,
      request.auth,
      code,
      parseBody(voucherUpdateInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });

  app.get('/v1/customer-groups', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listCustomerGroups(app.db, request.auth);
  });
  app.post('/v1/customer-groups', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createCustomerGroup(
      app.db,
      request.auth,
      parseBody(customerGroupInput, request.body),
      meta(request),
      app.clock.now(),
    );
    return reply.code(201).send(created);
  });
  app.put('/v1/customer-groups/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const parsed = uuidSchema.safeParse((request.params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذه المجموعة غير موجودة.');
    return updateCustomerGroup(
      app.db,
      request.auth,
      parsed.data,
      parseBody(customerGroupInput, request.body),
      meta(request),
      app.clock.now(),
    );
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

  app.get('/v1/customers/:id/purchases', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return customerPurchases(app.db, request.auth, idOf(request.params));
  });
  app.get('/v1/device/customers/:id/purchases', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return customerPurchasesForDevice(app.db, request.device, idOf(request.params));
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

  app.post('/v1/customers/:id/archive-duplicate', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return archiveDuplicateCustomer(
      app.db,
      request.auth,
      idOf(request.params),
      meta(request),
      app.clock.now(),
    );
  });

  app.post('/v1/customers/:id/payments', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const result = await receiveCustomerPayment(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(customerPaymentInput, request.body),
      meta(request),
      app.clock.now(),
    );
    return reply.code(201).send(result);
  });

  app.post('/v1/customers/:id/opening-debt', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const result = await openCustomerDebt(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(customerOpeningDebtInput, request.body),
      meta(request),
      app.clock.now(),
    );
    return reply.code(201).send(result);
  });
}
