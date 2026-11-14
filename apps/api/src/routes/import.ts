import type { FastifyInstance } from 'fastify';
import { importInput } from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { runImport } from '../services/import';
import { parseBody } from './validation';

/** Importing products, customers and suppliers from a spreadsheet (packages/core › contracts/import.ts). */
export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/import',
    {
      preHandler: requireAuth,
      // 500 rows of a dozen cells each is a few hundred KB; a megabyte-sized allowance with room
      bodyLimit: 2 * 1024 * 1024,
      // A file of 20,000 rows is 40 chunks, a dry run and a real run of them: 120 a minute is room for two files
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    },
    async (request) => {
      if (!request.auth) throw unauthorized();
      return runImport(
        app.db,
        request.auth,
        parseBody(importInput, request.body),
        {
          ip: clientIp(request),
          userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
        },
        app.clock.now(),
      );
    },
  );
}
