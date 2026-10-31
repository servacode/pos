import type { FastifyInstance } from 'fastify';
import { isTestMode } from '../auth/otp';

/** Header on every answer while the local server is in test mode; the web app shows its ribbon. */
export const TEST_MODE_HEADER = 'x-serva-test-mode';

/**
 * The local server's test mode (sign-up codes on screen). Warns loudly at startup and marks every
 * answer, so the web app can show «نسخة تجربة» even on pages that make no other request.
 */
export function installTestMode(app: FastifyInstance): void {
  if (!isTestMode(app.env)) return;
  app.log.warn(
    '!!! TEST MODE: OTP_DELIVERY=screen. Sign-up codes are shown on screen and no phone is proven. ' +
      'For the local test server only; set OTP_DELIVERY=none to turn it off. !!!',
  );
  app.addHook('onRequest', async (_request, reply) => {
    reply.header(TEST_MODE_HEADER, '1');
  });
}
