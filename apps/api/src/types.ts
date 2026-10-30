import type { Database } from '@serva/db';
import type { SessionGate } from './auth/session-gate';
import type { AccessClaims } from './auth/tokens';
import type { Clock } from './clock';
import type { Env } from './env';
import type { ClientAddressing } from './http/client-ip';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    env: Env;
    clock: Clock;
    sessionGate: SessionGate;
    addressing: ClientAddressing;
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
