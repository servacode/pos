import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors';
import { enforceLimits } from '../http/rate-limit';
import { verifyAccessToken } from './tokens';

/**
 * preHandler for routes that need a signed-in store user. Beyond the signature and expiry, the
 * session must still be live: signing out, theft detection, disabling the user or suspending the
 * store all close access at once, not when the 15-minute token runs out. Each session and each
 * store also has its own request limit.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const { env, clock, sessionGate, tokenKeys } = request.server;
  const claims = await verifyAccessToken(header.slice('Bearer '.length), tokenKeys, clock.now());
  if (!claims || !(await sessionGate.isLive(claims))) throw unauthorized();
  await enforceLimits(request, reply, 60_000, [
    { key: `session:${claims.sessionId}`, max: env.SESSION_RATE_LIMIT_PER_MINUTE },
    { key: `store:${claims.tenantId}`, max: env.STORE_RATE_LIMIT_PER_MINUTE },
  ]);
  request.auth = claims;
}
