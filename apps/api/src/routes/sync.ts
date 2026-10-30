import { Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  PUSH_MAX_INFLATED_BYTES,
  PUSH_MAX_WIRE_BYTES,
  pullQuerySchema,
  pushRequestSchema,
  resyncRequestSchema,
} from '@serva/sync';
import { requireDevice, type DeviceClaims } from '../auth/device-guard';
import { clientIp } from '../http/client-ip';
import { AppError, unauthorized, validationError } from '../errors';
import { pullChanges, resyncSets } from '../services/sync-pull';
import { pushDocuments, type SyncProcessors } from '../services/sync-push';
import { parseBody } from './validation';

const tooLarge = () =>
  new AppError(413, 'payload_too_large', 'حجم الدفعة أكبر من المسموح. قسّمها إلى دفعات أصغر.');

/**
 * Push bodies may be gzip (17 › الحجم): at most 5 MB on the wire, compressed or not, and at most
 * 24 MB once inflated, so a small compressed body cannot blow up in memory. Both limits answer an
 * explicit 413 so the device splits its batch.
 */
function limitedBody(request: FastifyRequest, payload: Readable): Readable {
  const encoding = (request.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') {
    throw new AppError(415, 'unsupported_media_type', 'ترميز المحتوى غير مقبول.');
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > PUSH_MAX_WIRE_BYTES) throw tooLarge();

  let wireBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      wireBytes += chunk.length;
      if (wireBytes > PUSH_MAX_WIRE_BYTES) callback(tooLarge());
      else callback(null, chunk);
    },
  });
  payload.on('error', (error) => counter.destroy(error));
  const counted = payload.pipe(counter);
  if (encoding === 'identity') return Object.assign(counted, { receivedEncodedLength: 0 });

  const gunzip = createGunzip();
  counted.on('error', (error) => gunzip.destroy(error));
  const inflated = counted.pipe(gunzip) as Readable & { receivedEncodedLength?: number };
  // Fastify compares Content-Length with what was received on the wire, not the inflated size.
  counter.on('end', () => {
    inflated.receivedEncodedLength = wireBytes;
  });
  inflated.receivedEncodedLength = 0;
  return inflated;
}

const deviceOf = (request: FastifyRequest): DeviceClaims => {
  if (!request.device) throw unauthorized();
  return request.device;
};

/**
 * The device routes of sync contract v1 (17 › البيع والمزامنة). The device and its store come
 * from its token alone, never from the request.
 */
export function syncRoutes(processors: SyncProcessors = {}) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post(
      '/v1/sync/push',
      {
        bodyLimit: PUSH_MAX_INFLATED_BYTES,
        onRequest: requireDevice({
          allowRevoked: true,
          extraLimits: (device) => [
            { key: `sync-push:${device.deviceId}`, max: app.env.SYNC_PUSH_RATE_LIMIT_PER_MINUTE },
          ],
        }),
        preParsing: async (request, _reply, payload) => limitedBody(request, payload),
      },
      async (request) => {
        const device = deviceOf(request);
        const body = parseBody(pushRequestSchema, request.body);
        return pushDocuments(app.db, device, body, {
          meta: { ip: clientIp(request), userAgent: request.headers['user-agent'] ?? null },
          now: app.clock.now(),
          processors,
          onError: (error, docId) => request.log.error({ err: error, docId }, 'sync document failed'),
        });
      },
    );

    app.get('/v1/sync/pull', { onRequest: requireDevice() }, async (request) => {
      const device = deviceOf(request);
      const query = pullQuerySchema.safeParse(request.query ?? {});
      if (!query.success) throw validationError(query.error);
      return pullChanges(app.db, device, query.data.cursors, query.data.limit, app.clock.now());
    });

    app.post('/v1/sync/resync', { onRequest: requireDevice() }, async (request) => {
      const device = deviceOf(request);
      const body = parseBody(resyncRequestSchema, request.body);
      return resyncSets(app.db, device, body.sets, app.clock.now());
    });
  };
}
