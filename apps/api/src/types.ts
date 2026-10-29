import type { Database } from '@serva/db';
import type { AccessClaims } from './auth/tokens';
import type { Env } from './env';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
  }
  interface FastifyRequest {
    /** Set by requireAuth for authenticated routes */
    auth: AccessClaims | null;
  }
}

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}
