import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  platformCodeInput,
  platformConfirmInput,
  platformNewPasswordInput,
  platformTicketInput,
} from '@serva/core';
import { requirePlatform } from '../auth/platform-guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { enforceLimits } from '../http/rate-limit';
import {
  beginEnrolment,
  confirmEnrolment,
  enrolDuringLogin,
  loginWithCode,
  loginWithNewPassword,
  ticketFor,
  twoFactorStatus,
} from '../services/platform-2fa';
import { parseBody } from './validation';

const CODE_WINDOW_MS = 15 * 60_000;
/** Wrong or right, this many codes per person in 15 minutes; a fixed 10^6 space makes more pointless */
const CODE_ATTEMPTS_PER_USER = 8;
const CODE_ATTEMPTS_PER_IP = 40;

/**
 * The steps of platform sign-in after the password (second factor, new password, enrolment) and
 * the signed-in member's own two-factor settings. /v1/platform/login itself is in routes/billing.ts
 * and answers with services/platform-2fa.ts › platformSignIn.
 */
export async function platformAuthRoutes(app: FastifyInstance): Promise<void> {
  const stepLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    await enforceLimits(request, reply, 60_000, [
      { key: `platform-login:${request.ip}`, max: app.env.AUTH_RATE_LIMIT_PER_MINUTE },
    ]);
  };
  const codeLimits = (request: FastifyRequest, reply: FastifyReply, userId: string) =>
    enforceLimits(request, reply, CODE_WINDOW_MS, [
      { key: `platform-2fa:user:${userId}`, max: CODE_ATTEMPTS_PER_USER },
      { key: `platform-2fa:ip:${clientIp(request)}`, max: CODE_ATTEMPTS_PER_IP },
    ]);
  const now = () => app.clock.now();

  app.post('/v1/platform/login/code', { onRequest: stepLimit }, async (request, reply) => {
    const { ticket, code } = parseBody(platformCodeInput, request.body);
    const { user } = await ticketFor(app, ticket, 'code', now());
    await codeLimits(request, reply, user.id);
    return loginWithCode(app, ticket, code, now());
  });

  app.post('/v1/platform/login/password', { onRequest: stepLimit }, async (request) => {
    const { ticket, password } = parseBody(platformNewPasswordInput, request.body);
    return loginWithNewPassword(app, ticket, password, now());
  });

  app.post('/v1/platform/login/enrol', { onRequest: stepLimit }, async (request) => {
    const { ticket } = parseBody(platformTicketInput, request.body);
    const { user } = await ticketFor(app, ticket, 'enrol', now());
    return beginEnrolment(app, user.id);
  });

  app.post('/v1/platform/login/enrol/confirm', { onRequest: stepLimit }, async (request, reply) => {
    const { ticket, code } = parseBody(platformCodeInput, request.body);
    const { user } = await ticketFor(app, ticket, 'enrol', now());
    await codeLimits(request, reply, user.id);
    return enrolDuringLogin(app, ticket, code, now());
  });

  // A signed-in member switching two-factor on by choice.
  const platform = { preHandler: requirePlatform };
  const userOf = (request: FastifyRequest) => {
    if (!request.platform) throw unauthorized();
    return request.platform.platformUserId;
  };
  app.get('/v1/platform/2fa', platform, async (request) => twoFactorStatus(app, userOf(request)));
  app.post('/v1/platform/2fa/enrol', platform, async (request) => beginEnrolment(app, userOf(request)));
  app.post('/v1/platform/2fa/enrol/confirm', platform, async (request, reply) => {
    const { code } = parseBody(platformConfirmInput, request.body);
    await codeLimits(request, reply, userOf(request));
    return (await confirmEnrolment(app, userOf(request), code, now())).done;
  });
}
