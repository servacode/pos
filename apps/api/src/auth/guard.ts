import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors';
import { verifyAccessToken } from './tokens';

/** preHandler for routes that need a signed-in store user. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyAccessToken(header.slice('Bearer '.length), request.server.env.JWT_SECRET);
  if (!claims) throw unauthorized();
  request.auth = claims;
}
