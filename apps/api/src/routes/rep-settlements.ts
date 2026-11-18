import type { FastifyInstance } from 'fastify';
import {
  repDebtForgiveInput,
  repDebtPaymentInput,
  repSettlementCreateInput,
  repVanCountInput,
  settlementApproveInput,
  settlementCancelInput,
  settlementListQuery,
  settlementPreviewQuery,
  uuidSchema,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  approveSettlement,
  cancelSettlement,
  createSettlement,
  getSettlement,
  listSettlements,
  previewSettlement,
  saveVanCount,
} from '../services/rep-settlements';
import { forgiveRepDebt, getRepDebt, listRepDebts, payRepDebt } from '../services/rep-debt';
import { parseBody } from './validation';

/**
 * «تسوية المندوب» (packages/core › contracts/distribution-ops.ts): the supervisor's evening record of
 * a rep's day (`rep.settle`), and the one call a rep's phone makes for it, its blind van count.
 */
export async function repSettlementRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: Parameters<typeof clientIp>[0] & { headers: Record<string, unknown> }) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذه التسوية غير موجودة.');
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  app.get('/v1/rep-settlements/preview', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return previewSettlement(app.db, request.auth, parseBody(settlementPreviewQuery, request.query));
  });
  app.get('/v1/rep-settlements', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listSettlements(app.db, request.auth, parseBody(settlementListQuery, request.query));
  });
  app.post('/v1/rep-settlements', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createSettlement(
      app.db,
      request.auth,
      parseBody(repSettlementCreateInput, request.body),
      meta(request),
    );
    return reply.status(201).send(made);
  });
  app.get('/v1/rep-settlements/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return getSettlement(app.db, request.auth, idOf(request.params));
  });
  app.post('/v1/rep-settlements/:id/approve', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return approveSettlement(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(settlementApproveInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/rep-settlements/:id/cancel', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return cancelSettlement(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(settlementCancelInput, request.body),
      meta(request),
    );
  });

  // What a rep owes the shop after a cash shortage (round 35, D6): his balance, what he pays back, what the owner forgives
  const repIdOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا المندوب غير موجود.');
    return parsed.data;
  };
  app.get('/v1/rep-debts', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listRepDebts(app.db, request.auth);
  });
  app.get('/v1/reps/:id/debt', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return getRepDebt(app.db, request.auth, repIdOf(request.params));
  });
  app.post('/v1/reps/:id/debt/payments', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return payRepDebt(
      app.db,
      request.auth,
      repIdOf(request.params),
      parseBody(repDebtPaymentInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/reps/:id/debt/forgive', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return forgiveRepDebt(
      app.db,
      request.auth,
      repIdOf(request.params),
      parseBody(repDebtForgiveInput, request.body),
      meta(request),
    );
  });

  // The rep's phone: its blind count of the van, kept on his day for the settlement
  app.post('/v1/device/rep/van-count', { onRequest: requireDevice({ write: true }) }, async (request) => {
    if (!request.device) throw unauthorized();
    return saveVanCount(app.db, request.device, parseBody(repVanCountInput, request.body));
  });
}
