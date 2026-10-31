import type { FastifyInstance } from 'fastify';
import { staffSessionInput } from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { startStaffSession } from '../services/staff';
import { parseBody } from './validation';

/** Signing a person in on a device with their PIN (packages/core › contracts/staff.ts). */
export async function staffRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/device/staff-sessions', { onRequest: requireDevice() }, async (request) => {
    if (!request.device) throw unauthorized();
    const input = parseBody(staffSessionInput, request.body);
    return startStaffSession(app.db, app.passwords, request.device, input, app.clock.now(), {
      ip: clientIp(request),
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
    });
  });
}
