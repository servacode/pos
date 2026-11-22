import type { FastifyInstance } from 'fastify';
import {
  boardQuery,
  DISTRIBUTION_REPORT_KINDS,
  distributionReportQuery,
  repTargetInput,
  repTargetListQuery,
  repTargetUpdateInput,
  uuidSchema,
  type DistributionReportKind,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  createTarget,
  deleteTarget,
  distributionReport,
  listTargets,
  todayBoard,
  updateTarget,
} from '../services/distribution-reports';
import { parseBody } from './validation';

/**
 * The supervisor's views of the reps' work: the day board, the monthly targets (`rep.targets`) and the
 * distribution reports (`report.view`). Reads, but for the targets, which post nothing.
 */
export async function distributionReportRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: Parameters<typeof clientIp>[0] & { headers: Record<string, unknown> }) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا الهدف غير موجود.');
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  app.get('/v1/distribution/today', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return todayBoard(app.db, request.auth, parseBody(boardQuery, request.query).date);
  });
  app.get('/v1/distribution/reports/:kind', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const kind = (request.params as { kind?: string }).kind;
    if (!DISTRIBUTION_REPORT_KINDS.includes(kind as DistributionReportKind)) {
      throw new AppError(404, 'not_found', 'هذا التقرير غير موجود.');
    }
    return distributionReport(
      app.db,
      request.auth,
      kind as DistributionReportKind,
      parseBody(distributionReportQuery, request.query),
    );
  });

  app.get('/v1/rep-targets', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listTargets(app.db, request.auth, parseBody(repTargetListQuery, request.query));
  });
  app.post('/v1/rep-targets', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createTarget(
      app.db,
      request.auth,
      parseBody(repTargetInput, request.body),
      meta(request),
    );
    return reply.status(201).send(made);
  });
  app.put('/v1/rep-targets/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const input = parseBody(repTargetUpdateInput, request.body);
    return updateTarget(app.db, request.auth, idOf(request.params), input, meta(request));
  });
  app.delete('/v1/rep-targets/:id', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    await deleteTarget(app.db, request.auth, idOf(request.params), meta(request));
    return reply.status(204).send();
  });
}
