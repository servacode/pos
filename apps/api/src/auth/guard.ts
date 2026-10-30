import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors';
import { verifyAccessToken } from './tokens';

/**
 * preHandler for routes that need a signed-in store user. Beyond the signature and expiry, the
 * session must still be live: signing out, theft detection, disabling the user or suspending the
 * store all close access at once, not when the 15-minute token runs out.
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const { env, clock, sessionGate } = request.server;
  const claims = await verifyAccessToken(header.slice('Bearer '.length), env.JWT_SECRET, clock.now());
  if (!claims || !(await sessionGate.isLive(claims))) throw unauthorized();
  request.auth = claims;
}
