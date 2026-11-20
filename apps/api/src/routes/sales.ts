import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  invoiceLookupQuery,
  invoiceSearchQuery,
  saleListQuery,
  type SaleDetail,
  type SaleListPage,
  type SaleSummary,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { lookupInvoice, searchInvoices } from '../services/invoice-lookup';
import { getSale, listSales, salesSummary } from '../services/sales';
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

  // Count, total and returns of the list's filters, for the strip above it
  app.get('/v1/sales/summary', signedIn, async (request): Promise<SaleSummary> => {
    if (!request.auth) throw unauthorized();
    return salesSummary(db, request.auth, parseBody(saleListQuery, request.query));
  });

  // The till finds an invoice of any till of the store to return from (contracts/till.ts)
  app.get('/v1/device/invoices/lookup', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    const q = parseBody(invoiceLookupQuery, request.query).q;
    // `quiet=1`: a till asking «is there such an invoice?» gets 200 {invoice:null} instead of a 404 its console logs as an error
    const quiet = (request.query as { quiet?: string }).quiet === '1';
    try {
      return await lookupInvoice(db, request.device, q);
    } catch (error) {
      if (quiet && error instanceof AppError && error.statusCode === 404) return { invoice: null };
      throw error;
    }
  });

  // …or finds recent ones by the customer's name, phone or the end of the number
  app.get('/v1/device/invoices/search', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    const { q, days } = parseBody(invoiceSearchQuery, request.query);
    return searchInvoices(db, request.device, q, days);
  });

  app.get('/v1/sales/:id', signedIn, async (request): Promise<SaleDetail> => {
    if (!request.auth) throw unauthorized();
    const id = uuid.safeParse((request.params as { id?: string }).id);
    if (!id.success) throw new AppError(404, 'not_found', 'هذه الفاتورة غير موجودة.');
    return getSale(db, request.auth, id.data);
  });
}
