import { createReadStream } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  heartbeatRequestSchema,
  PUSH_MAX_INFLATED_BYTES,
  PUSH_MAX_WIRE_BYTES,
  pullQuerySchema,
  pushRequestSchema,
  resyncRequestSchema,
} from '@serva/sync';
import { requireDevice, type DeviceClaims } from '../auth/device-guard';
import { clientIp } from '../http/client-ip';
import { AppError, unauthorized, validationError } from '../errors';
import { bootstrapSnapshot, resyncSnapshot, SnapshotStore } from '../services/snapshots';
import { recordHeartbeat } from '../services/sync-heartbeat';
import { pullChanges } from '../services/sync-pull';
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
    const snapshots = new SnapshotStore(app.env.SNAPSHOT_DIR, app.env.SNAPSHOT_TTL_SECONDS * 1000);

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
      return resyncSnapshot(app.db, snapshots, device, body.sets, app.clock.now());
    });

    // A revoked device is still heard (its unsent count), and told to wipe.
    app.post('/v1/sync/heartbeat', { onRequest: requireDevice({ allowRevoked: true }) }, async (request) => {
      const device = deviceOf(request);
      const body = parseBody(heartbeatRequestSchema, request.body);
      return recordHeartbeat(app.db, device, body, app.clock.now());
    });

    app.get('/v1/sync/bootstrap', { onRequest: requireDevice() }, async (request) =>
      bootstrapSnapshot(app.db, snapshots, deviceOf(request), app.clock.now()),
    );

    // The snapshot file: gzip as stored (no Content-Encoding, so the sha256 is of these bytes),
    // resumable with Range from where a cut connection stopped.
    app.get('/v1/sync/snapshots/:id', { onRequest: requireDevice() }, async (request, reply) => {
      const device = deviceOf(request);
      const { id } = request.params as { id: string };
      const found = await snapshots.open(id, device.tenantId, app.clock.now());
      if (!found) throw new AppError(404, 'not_found', 'انتهت صلاحية ملف التنزيل. ابدأ التنزيل من جديد.');
      const { meta, path } = found;
      const etag = `"${meta.sha256}"`;
      reply
        .header('etag', etag)
        .header('accept-ranges', 'bytes')
        .header('content-type', 'application/gzip')
        .header('cache-control', 'private, no-store');
      const ifRange = request.headers['if-range'];
      const range = requestedRange(
        request.headers.range,
        Array.isArray(ifRange) ? ifRange[0] : ifRange,
        etag,
        meta.bytes,
      );
      if (range === 'unsatisfiable') {
        reply.header('content-range', `bytes */${meta.bytes}`);
        throw new AppError(416, 'bad_request', 'الجزء المطلوب من الملف غير موجود.');
      }
      if (range) {
        reply
          .code(206)
          .header('content-range', `bytes ${range.start}-${range.end}/${meta.bytes}`)
          .header('content-length', range.end - range.start + 1);
        return reply.send(createReadStream(path, { start: range.start, end: range.end }));
      }
      reply.header('content-length', meta.bytes);
      return reply.send(createReadStream(path));
    });
  };
}

const RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * One byte range (RFC 9110 §14): `bytes=a-`, `bytes=a-b` or `bytes=-n`. null means the whole
 * file: no Range, several ranges, or an If-Range that no longer matches (the file changed).
 */
export function requestedRange(
  header: string | undefined,
  ifRange: string | undefined,
  etag: string,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  if (ifRange !== undefined && ifRange !== etag) return null;
  const match = RANGE.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    if (end < start && match[2] !== '') return null;
  }
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}
