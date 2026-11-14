import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { invoiceLookupQuery, saleListQuery, type SaleDetail, type SaleListPage } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { lookupInvoice } from '../services/invoice-lookup';
import { getSale, listSales } from '../services/sales';
import { parseBody } from './validation';

const uuid = z.uuid();

/** The invoice list and one invoice (contracts/sales.ts). Read-only; report.view, checked in the service. */
export async function saleRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const signedIn = { preHandler: requireAuth };

  app.get('/v1/sales', signedIn, async (request): Promise<SaleListPage> => {
    if (!request.auth) throw unauthorized();
    return listSales(db, request.auth, parseBody(saleListQuery, request.query));
  });

  // The till finds an invoice of any till of the store to return from (contracts/till.ts)
  app.get('/v1/device/invoices/lookup', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return lookupInvoice(db, request.device, parseBody(invoiceLookupQuery, request.query).q);
  });

  app.get('/v1/sales/:id', signedIn, async (request): Promise<SaleDetail> => {
    if (!request.auth) throw unauthorized();
    const id = uuid.safeParse((request.params as { id?: string }).id);
    if (!id.success) throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    return getSale(db, request.auth, id.data);
  });
}
