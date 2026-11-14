import type { FastifyReply, FastifyRequest } from 'fastify';
import { unauthorized } from '../errors';
import { enforceLimits } from '../http/rate-limit';
import { assertStoreWritable } from '../services/subscription-gate';
import { verifyAccessToken } from './tokens';

/**
 * Writes that stay open in a read-only store (07 › الانتهاء لا يحذف شيئاً): the subscription page
 * (open an invoice, report a payment). Reads, sign-in and sign-out are never gated.
 */
const OPEN_WHEN_READ_ONLY = '/v1/subscription';
const openWhenReadOnly = (url: string) =>
  url === OPEN_WHEN_READ_ONLY ||
  url.startsWith(`${OPEN_WHEN_READ_ONLY}/`) ||
  url.startsWith(`${OPEN_WHEN_READ_ONLY}?`);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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
  if (!SAFE_METHODS.has(request.method) && !openWhenReadOnly(request.url)) {
    await assertStoreWritable(request.server.db, claims.tenantId, clock.now(), env.SUBSCRIPTION_ENFORCEMENT);
  }
}
