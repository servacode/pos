import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { MetaResponse } from '@serva/core';
import { isTestMode } from '../auth/otp';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  // Public facts the web app needs before sign-in (test mode of the local server).
  app.get('/v1/meta', async () => {
    const body: MetaResponse = { testMode: isTestMode(app.env) };
    return body;
  });
}
