import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  activateDeviceInput,
  createPairingCodeInput,
  renameDeviceInput,
  type DeviceListResponse,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import type { AccessClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { enforceLimits } from '../http/rate-limit';
import {
  activateByOwner,
  activateWithCode,
  activateWithQr,
  activationStatus,
  approveDevice,
  createPairingCode,
  listDevices,
  rejectDevice,
  renameDevice,
  revokeDevice,
} from '../services/devices';
import type { RequestMeta } from '../types';
import { parseBody } from './validation';

const metaOf = (request: FastifyRequest): RequestMeta => ({
  ip: clientIp(request),
  userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
});

const authOf = (request: FastifyRequest): AccessClaims => {
  if (!request.auth) throw unauthorized();
  return request.auth;
};

const deviceId = z.uuid();
/** An id that is not a UUID cannot exist: 404 like any other unknown device. */
function idOf(request: FastifyRequest): string {
  const parsed = deviceId.safeParse((request.params as { id?: string }).id);
  if (!parsed.success) throw new AppError(404, 'not_found', 'هذا الجهاز غير موجود.');
  return parsed.data;
}

/** Linking devices (17 › الأجهزة). */
export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  const { env, db, clock } = app;

  app.post('/v1/devices/pairing-codes', { preHandler: requireAuth }, async (request, reply) => {
    const input = parseBody(createPairingCodeInput, request.body);
    const webOrigin = env.PUBLIC_WEB_ORIGIN ?? `${request.protocol}://${request.host}`;
    const body = await createPairingCode(
      db,
      authOf(request),
      input,
      { now: clock.now(), webOrigin },
      metaOf(request),
    );
    return reply.status(201).send(body);
  });

  // No sign-in for qr and code: the code is the proof, so both are limited per address, and the
  // typed code per store code too. The owner method needs the owner's own access token.
  app.post('/v1/devices/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = parseBody(activateDeviceInput, request.body);
    const now = clock.now();
    if (data.method === 'owner') {
      await requireAuth(request, reply);
      return reply.status(201).send(await activateByOwner(db, authOf(request), data, now, metaOf(request)));
    }
    await enforceLimits(request, reply, 60_000, [
      { key: `activate:ip:${clientIp(request)}`, max: env.ACTIVATE_RATE_LIMIT_PER_MINUTE },
    ]);
    if (data.method === 'code') {
      await enforceLimits(request, reply, 3_600_000, [
        { key: `activate:store:${data.storeCode}`, max: env.ACTIVATE_STORE_LIMIT_PER_HOUR },
      ]);
      return reply.status(202).send(await activateWithCode(db, data, now, metaOf(request)));
    }
    return reply.status(202).send(await activateWithQr(db, data, now, metaOf(request)));
  });

  app.get('/v1/devices/activations/:id', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Activation ')) throw unauthorized();
    const id = (request.params as { id: string }).id;
    return activationStatus(db, id, header.slice('Activation '.length), clock.now(), metaOf(request));
  });

  app.get('/v1/devices', { preHandler: requireAuth }, async (request): Promise<DeviceListResponse> => ({
    devices: await listDevices(db, authOf(request), clock.now()),
  }));

  app.patch('/v1/devices/:id', { preHandler: requireAuth }, async (request) => {
    const id = idOf(request);
    const input = parseBody(renameDeviceInput, request.body);
    return renameDevice(db, authOf(request), id, input, { now: clock.now(), meta: metaOf(request) });
  });

  for (const [action, handler] of [
    ['approve', approveDevice],
    ['reject', rejectDevice],
    ['revoke', revokeDevice],
  ] as const) {
    app.post(`/v1/devices/:id/${action}`, { preHandler: requireAuth }, async (request) =>
      handler(db, authOf(request), idOf(request), { now: clock.now(), meta: metaOf(request) }),
    );
  }
}
