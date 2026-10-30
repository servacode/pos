import type { FastifyInstance } from 'fastify';

/**
 * Headers on every API answer. The API only serves JSON, so its content policy allows nothing
 * and it can never be framed. The web app's own policy (CSP with a nonce for its HTML) is set where
 * that HTML is served.
 */
export function installSecurityHeaders(app: FastifyInstance, options: { https: boolean }): void {
  const headers: Record<string, string> = {
    'content-security-policy':
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    // Answers carry tokens and store data: never keep them in a shared or browser cache.
    'cache-control': 'no-store',
  };
  if (options.https) headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains';

  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(headers);
  });
}
