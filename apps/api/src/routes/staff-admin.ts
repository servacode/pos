import type { FastifyInstance } from 'fastify';
import { staffCreateInput, staffPinInput, staffUpdateInput, uuidSchema } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { createStaff, listStaff, resetStaffPin, setStaffActive, updateStaff } from '../services/staff-admin';
import { parseBody } from './validation';

/** The store's staff «الموظفون» (packages/core › contracts/staff-admin.ts), under `users.manage`. */
export async function staffAdminRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: Parameters<typeof clientIp>[0] & { headers: Record<string, unknown> }) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'هذا الموظف غير موجود.');
    return parsed.data;
  };

  app.get('/v1/staff', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return listStaff(app.db, request.auth);
  });

  app.post('/v1/staff', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createStaff(
      app.db,
      app.passwords,
      request.auth,
      parseBody(staffCreateInput, request.body),
      meta(request),
    );
    return reply.code(201).send(created);
  });

  app.patch('/v1/staff/:id', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateStaff(
      app.db,
      app.passwords,
      request.auth,
      idOf(request.params),
      parseBody(staffUpdateInput, request.body),
      meta(request),
    );
  });

  app.post('/v1/staff/:id/pin', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    await resetStaffPin(
      app.db,
      app.passwords,
      request.auth,
      idOf(request.params),
      parseBody(staffPinInput, request.body),
      meta(request),
    );
    return reply.code(204).send();
  });

  for (const [action, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    app.post(`/v1/staff/:id/${action}`, { preHandler: requireAuth }, async (request) => {
      if (!request.auth) throw unauthorized();
      return setStaffActive(
        app.db,
        request.auth,
        idOf(request.params),
        active,
        app.clock.now(),
        meta(request),
        (sessionId) => app.sessionGate.forget(sessionId),
      );
    });
  }
}
