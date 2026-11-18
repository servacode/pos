import type { FastifyInstance } from 'fastify';
import {
  batchBlockInput,
  expiryQuery,
  inventoryQuery,
  profitQuery,
  purchaseInput,
  purchaseListQuery,
  purchaseOrderInput,
  purchaseOrderListQuery,
  purchaseOrderStatusInput,
  purchaseOrderSuggestQuery,
  purchaseOrderUpdateInput,
  recallQuery,
  stocktakeInput,
  supplierInput,
  supplierPaymentInput,
  supplierReturnInput,
  transferInput,
  uuidSchema,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  createPurchase,
  createStocktake,
  createSupplierReturn,
  createTransfer,
  inventory,
  listPurchases,
  listSuppliers,
  listSupplierReturns,
  listTransfers,
  paySupplier,
  profitReport,
  readPurchase,
  saveSupplier,
} from '../services/purchases';
import {
  createPurchaseOrder,
  listPurchaseOrders,
  movePurchaseOrder,
  readPurchaseOrder,
  suggestPurchaseOrder,
  updatePurchaseOrder,
} from '../services/purchase-orders';
import { expiryReport } from '../services/expiry';
import { listDamagedStock } from '../services/damaged-stock';
import { recall, setBatchBlocked } from '../services/batches';
import { parseBody } from './validation';

/** Suppliers, purchases, payments, stock value, counts and profit (contracts/purchases.ts). */
export async function purchaseRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown, what: string) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', `${what} غير موجود.`);
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  app.get('/v1/suppliers', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listSuppliers(app.db, request.auth);
  });
  app.post('/v1/suppliers', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const saved = await saveSupplier(
      app.db,
      request.auth,
      null,
      parseBody(supplierInput, request.body),
      meta(request),
      app.clock.now(),
    );
    return reply.code(201).send(saved);
  });
  app.put('/v1/suppliers/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return saveSupplier(
      app.db,
      request.auth,
      idOf(request.params, 'هذا المورد'),
      parseBody(supplierInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });

  app.get('/v1/purchases', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listPurchases(app.db, request.auth, parseBody(purchaseListQuery, request.query));
  });
  app.post('/v1/purchases', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createPurchase(
      app.db,
      request.auth,
      parseBody(purchaseInput, request.body),
      meta(request),
    );
    return reply.code(201).send(created);
  });
  app.get('/v1/purchases/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return readPurchase(app.db, request.auth, idOf(request.params, 'هذه الفاتورة'));
  });

  // Purchase orders (طلبية شراء): a promise to a supplier; nothing posts, nothing moves
  app.get('/v1/purchase-orders', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listPurchaseOrders(app.db, request.auth, parseBody(purchaseOrderListQuery, request.query));
  });
  app.get('/v1/purchase-orders/suggest', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const q = parseBody(purchaseOrderSuggestQuery, request.query);
    return suggestPurchaseOrder(app.db, request.auth, { supplierId: q.supplierId, all: q.all === '1' });
  });
  app.post('/v1/purchase-orders', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createPurchaseOrder(
      app.db,
      request.auth,
      parseBody(purchaseOrderInput, request.body),
      meta(request),
    );
    return reply.code(201).send(made);
  });
  app.get('/v1/purchase-orders/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return readPurchaseOrder(app.db, request.auth, idOf(request.params, 'هذه الطلبية'));
  });
  app.put('/v1/purchase-orders/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return updatePurchaseOrder(
      app.db,
      request.auth,
      idOf(request.params, 'هذه الطلبية'),
      parseBody(purchaseOrderUpdateInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/purchase-orders/:id/status', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const body = parseBody(purchaseOrderStatusInput, request.body);
    return movePurchaseOrder(
      app.db,
      request.auth,
      idOf(request.params, 'هذه الطلبية'),
      body.status,
      body.version,
      meta(request),
    );
  });

  app.post('/v1/supplier-payments', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const paid = await paySupplier(
      app.db,
      request.auth,
      parseBody(supplierPaymentInput, request.body),
      meta(request),
    );
    return reply.code(201).send(paid);
  });

  app.get('/v1/inventory', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return inventory(app.db, request.auth, parseBody(inventoryQuery, request.query));
  });
  // «البضاعة التالفة» (round 35, D7): what each store holds as damaged goods
  app.get('/v1/damaged-stock', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listDamagedStock(app.db, request.auth);
  });
  app.get('/v1/inventory/expiry', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const q = parseBody(expiryQuery, request.query);
    return expiryReport(app.db, request.auth, q.days, app.clock.now(), {
      variantId: q.variantId,
      branchId: q.branchId,
      unbatched: q.unbatched === '1',
    });
  });
  // Recall (سحب دفعة): who got a batch, and stopping every till from selling it
  app.get('/v1/batches/recall', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return recall(app.db, request.auth, parseBody(recallQuery, request.query).batchNo);
  });
  app.post('/v1/batches/block', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return setBatchBlocked(
      app.db,
      request.auth,
      parseBody(batchBlockInput, request.body),
      true,
      meta(request),
    );
  });
  app.post('/v1/batches/unblock', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return setBatchBlocked(
      app.db,
      request.auth,
      parseBody(batchBlockInput, request.body),
      false,
      meta(request),
    );
  });
  app.post('/v1/stocktakes', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const done = await createStocktake(
      app.db,
      request.auth,
      parseBody(stocktakeInput, request.body),
      meta(request),
    );
    return reply.code(201).send(done);
  });

  app.get('/v1/transfers', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listTransfers(app.db, request.auth);
  });
  app.post('/v1/transfers', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    return reply
      .code(201)
      .send(
        await createTransfer(app.db, request.auth, parseBody(transferInput, request.body), meta(request)),
      );
  });

  app.get('/v1/supplier-returns', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listSupplierReturns(app.db, request.auth);
  });
  app.post('/v1/supplier-returns', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    return reply
      .code(201)
      .send(
        await createSupplierReturn(
          app.db,
          request.auth,
          parseBody(supplierReturnInput, request.body),
          meta(request),
        ),
      );
  });

  app.get('/v1/reports/profit', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return profitReport(app.db, request.auth, parseBody(profitQuery, request.query));
  });
}
