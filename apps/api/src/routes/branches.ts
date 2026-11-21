import type { FastifyInstance } from 'fastify';
import { branchActiveInput, branchInput, uuidSchema } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { createBranch, listBranches, setBranchActive, updateBranch } from '../services/branches';
import { parseBody } from './validation';

/** The store's branches «الفروع» (packages/core › contracts/branches.ts), under `settings.manage`. */
export async function branchRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: Parameters<typeof clientIp>[0] & { headers: Record<string, unknown> }) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا الفرع غير موجود.');
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  app.get('/v1/branches', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listBranches(app.db, request.auth);
  });
  app.post('/v1/branches', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const made = await createBranch(
      app.db,
      request.auth,
      parseBody(branchInput, request.body),
      meta(request),
    );
    return reply.code(201).send(made);
  });
  app.patch('/v1/branches/:id', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateBranch(
      app.db,
      request.auth,
      idOf(request.params),
      parseBody(branchInput, request.body),
      meta(request),
    );
  });
  app.post('/v1/branches/:id/active', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    const { active } = parseBody(branchActiveInput, request.body);
    return setBranchActive(app.db, request.auth, idOf(request.params), active, meta(request));
  });
}
