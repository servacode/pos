import type { FastifyRequest } from 'fastify';
import { unauthorized } from '../errors';
import { verifyPlatformToken, type PlatformClaims } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    platform?: PlatformClaims;
  }
}

/**
 * preHandler for the platform panel: a token of the platform realm only (a store's token never
 * opens it, nor the other way round). Eight-hour sessions, no refresh.
 */
export async function requirePlatform(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const { clock, tokenKeys } = request.server;
  const claims = await verifyPlatformToken(header.slice('Bearer '.length), tokenKeys, clock.now());
  if (!claims) throw unauthorized();
  request.platform = claims;
}
