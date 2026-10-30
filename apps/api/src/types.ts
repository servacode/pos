import type { Database } from '@serva/db';
import type { OtpSender } from './auth/otp';
import type { PasswordHasher } from './auth/passwords';
import type { SessionGate } from './auth/session-gate';
import type { AccessClaims, TokenKeys } from './auth/tokens';
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
    passwords: PasswordHasher;
    tokenKeys: TokenKeys;
    /** null when no channel is configured: sign-up answers 503 */
    otpSender: OtpSender | null;
    /** "METHOD /url" of every registered route */
    routeList: readonly string[];
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
