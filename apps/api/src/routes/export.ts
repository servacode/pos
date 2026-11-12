import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { enforceLimits } from '../http/rate-limit';
import { exportStore } from '../services/export/store-export';

/**
 * The whole store as a ZIP (services/export/store-export.ts). GET only: it reads and changes
 * nothing but the audit log, so it keeps working when the subscription has lapsed and the store is
 * read-only (docs/specs/24-legal.md: the owner can always take their data).
 */
export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/export',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: 3_600_000 } },
    },
    async (request, reply) => {
      if (!request.auth) throw unauthorized();
      // Six a store an hour: an export reads every table
      await enforceLimits(request, reply, 3_600_000, [{ key: `export:${request.auth.tenantId}`, max: 6 }]);
      const file = await exportStore(
        app.db,
        request.auth,
        {
          ip: clientIp(request),
          userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
        },
        app.clock.now(),
      );
      const stream = createReadStream(file.path);
      stream.on('close', () => void file.dispose());
      return reply
        .header('content-type', 'application/zip')
        .header('content-length', file.bytes)
        .header('content-disposition', `attachment; filename="${file.fileName}"`)
        .header('cache-control', 'no-store')
        .send(stream);
    },
  );
}
