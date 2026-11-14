import type { FastifyInstance } from 'fastify';
import { controlledRegisterQuery } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { controlledRegister } from '../services/pharmacy';
import { parseBody } from './validation';

/** «سجل الأدوية المراقبة» (packages/core › contracts/pharmacy.ts). */
export async function pharmacyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/pharmacy/controlled-register', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return controlledRegister(app.db, request.auth, parseBody(controlledRegisterQuery, request.query));
  });
}
