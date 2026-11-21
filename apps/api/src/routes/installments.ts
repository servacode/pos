import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cancelPlanInput,
  collectInput,
  instalmentSettingsInput,
  noteActionInput,
  planListQuery,
  reminderInput,
  uuidSchema,
  worklistQuery,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { requireDevice } from '../auth/device-guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  cancelPlan,
  collectOnPlan,
  customerInstalments,
  getPlan,
  getSettings,
  listPlans,
  logReminder,
  actOnNote,
  notesPrinted,
  saveSettings,
  summary,
  worklist,
} from '../services/installments';
import { parseBody } from './validation';

const idParams = z.object({ id: uuidSchema });
const reminderParams = z.object({ planId: uuidSchema, no: z.coerce.number().int().min(1).max(60) });

/** Instalments (packages/core › contracts/installments.ts): plans, the due list, collecting, settings. */
export async function installmentRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown>; ip: string }) => ({
    ip: clientIp(request as never),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });

  app.get('/v1/installment-plans', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listPlans(app.db, request.auth, parseBody(planListQuery, request.query), app.clock.now());
  });

  app.get('/v1/installment-plans/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return getPlan(app.db, request.auth, parseBody(idParams, request.params).id, app.clock.now());
  });

  app.post('/v1/installment-plans/:id/collect', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return collectOnPlan(
      app.db,
      request.auth,
      parseBody(idParams, request.params).id,
      parseBody(collectInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });

  app.post('/v1/installment-plans/:id/cancel', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return cancelPlan(
      app.db,
      request.auth,
      parseBody(idParams, request.params).id,
      parseBody(cancelPlanInput, request.body).reason,
      meta(request),
      app.clock.now(),
    );
  });

  app.get('/v1/installments/worklist', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return worklist(app.db, request.auth, parseBody(worklistQuery, request.query).bucket, app.clock.now());
  });

  app.get('/v1/installments/summary', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return summary(app.db, request.auth, app.clock.now());
  });

  app.post('/v1/installments/:planId/:no/reminders', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    const { planId, no } = parseBody(reminderParams, request.params);
    return logReminder(app.db, request.auth, planId, no, parseBody(reminderInput, request.body).kind);
  });

  app.post('/v1/installment-plans/:id/notes-printed', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return notesPrinted(app.db, request.auth, parseBody(idParams, request.params).id);
  });

  app.post('/v1/promissory-notes/:id/action', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return actOnNote(
      app.db,
      request.auth,
      parseBody(idParams, request.params).id,
      parseBody(noteActionInput, request.body).action,
      meta(request),
      app.clock.now(),
    );
  });

  app.get('/v1/store/installments-settings', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return getSettings(app.db, request.auth);
  });

  app.put('/v1/store/installments-settings', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return saveSettings(
      app.db,
      request.auth,
      parseBody(instalmentSettingsInput, request.body),
      meta(request),
    );
  });

  app.get('/v1/device/installments/customer/:id', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    return customerInstalments(
      app.db,
      request.device,
      parseBody(idParams, request.params).id,
      app.clock.now(),
    );
  });
}
