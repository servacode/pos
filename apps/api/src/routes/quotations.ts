import type { FastifyInstance } from 'fastify';
import {
  quotationConvertInput,
  quotationInput,
  quotationListQuery,
  quotationStatusInput,
  quotationUpdateInput,
  uuidSchema,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import {
  adminActor,
  convertQuotation,
  createQuotation,
  deviceActor,
  getQuotation,
  getQuotationForTill,
  listQuotations,
  openQuotationsForTill,
  setQuotationStatus,
  updateQuotation,
} from '../services/quotations';
import { parseBody } from './validation';

/** «عروض الأسعار»: the admin's list and editor, and the tills' save and open (packages/core › contracts/quotations.ts). */
export async function quotationRoutes(app: FastifyInstance): Promise<void> {
  const idOf = (params: unknown): string => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'عرض السعر هذا غير موجود.');
    return parsed.data;
  };

  app.get('/v1/quotations', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listQuotations(app.db, request.auth, parseBody(quotationListQuery, request.query));
  });
  app.get('/v1/quotations/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return getQuotation(app.db, request.auth, idOf(request.params));
  });
  app.post('/v1/quotations', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createQuotation(
      app.db,
      adminActor(request.auth),
      parseBody(quotationInput, request.body),
      'draft',
    );
    return reply.status(201).send(made);
  });
  app.put('/v1/quotations/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateQuotation(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(quotationUpdateInput, request.body),
    );
  });
  app.post('/v1/quotations/:id/status', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return setQuotationStatus(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(quotationStatusInput, request.body),
    );
  });

  // ─── The tills ───────────────────────────────────────────────────────────
  app.get('/v1/device/quotations', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return openQuotationsForTill(app.db, request.device);
  });
  app.get('/v1/device/quotations/:id', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return getQuotationForTill(app.db, request.device, idOf(request.params));
  });
  app.post('/v1/device/quotations', { onRequest: requireDevice({ write: true }) }, async (request, reply) => {
    if (!request.device) throw unauthorized();
    const made = await createQuotation(
      app.db,
      deviceActor(request.device),
      parseBody(quotationInput, request.body),
      'sent',
    );
    return reply.status(201).send(made);
  });
  app.post(
    '/v1/device/quotations/:id/convert',
    { onRequest: requireDevice({ write: true }) },
    async (request) => {
      if (!request.device) throw unauthorized();
      return convertQuotation(
        app.db,
        request.device.tenantId,
        idOf(request.params),
        parseBody(quotationConvertInput, request.body).version,
      );
    },
  );
}
