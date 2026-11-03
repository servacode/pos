import type { FastifyInstance } from 'fastify';
import {
  openInvoiceInput,
  planInput,
  platformLoginInput,
  platformSettingsInput,
  platformSubscriptionInput,
  rejectPaymentInput,
  reportPaymentInput,
  uuidSchema,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { requirePlatform } from '../auth/platform-guard';
import type { PlatformClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import { enforceLimits } from '../http/rate-limit';
import {
  decidePayment,
  openInvoice,
  platformLogin,
  platformPayments,
  platformPlans,
  platformSettings,
  platformStores,
  reportPayment,
  savePlan,
  savePlatformSettings,
  setSubscription,
  subscriptionPage,
} from '../services/billing';
import { parseBody } from './validation';

/** The store's subscription, and the platform panel (packages/core › contracts/billing.ts). */
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const idOf = (params: unknown) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', 'غير موجود.');
    return parsed.data;
  };
  const platformOf = (request: { platform?: PlatformClaims }): PlatformClaims => {
    if (!request.platform) throw unauthorized();
    return request.platform;
  };

  app.get('/v1/subscription', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return subscriptionPage(app.db, request.auth);
  });
  app.post('/v1/subscription/invoices', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const invoice = await openInvoice(
      app.db,
      request.auth,
      parseBody(openInvoiceInput, request.body),
      app.clock.now(),
    );
    return reply.code(201).send(invoice);
  });
  app.post('/v1/subscription/payments', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const payment = await reportPayment(
      app.db,
      request.auth,
      parseBody(reportPaymentInput, request.body),
      app.clock.now(),
    );
    return reply.code(201).send(payment);
  });

  app.post(
    '/v1/platform/login',
    {
      onRequest: async (request, reply) => {
        await enforceLimits(request, reply, 60_000, [
          { key: `platform-login:${request.ip}`, max: app.env.AUTH_RATE_LIMIT_PER_MINUTE },
        ]);
      },
    },
    async (request) =>
      platformLogin(
        app.db,
        app.passwords,
        app.tokenKeys,
        parseBody(platformLoginInput, request.body),
        app.clock.now(),
      ),
  );

  const platform = { preHandler: requirePlatform };
  app.get('/v1/platform/stores', platform, async () => platformStores(app.db));
  app.put('/v1/platform/stores/:id/subscription', platform, async (request, reply) => {
    await setSubscription(
      app.db,
      platformOf(request),
      idOf(request.params),
      parseBody(platformSubscriptionInput, request.body),
      app.clock.now(),
    );
    return reply.code(204).send();
  });
  app.get('/v1/platform/payments', platform, async (request) => {
    const status = (request.query as { status?: string }).status;
    return platformPayments(
      app.db,
      status && ['pending', 'confirmed', 'rejected'].includes(status) ? status : null,
    );
  });
  app.post('/v1/platform/payments/:id/confirm', platform, async (request, reply) => {
    await decidePayment(app.db, platformOf(request), idOf(request.params), true, null, app.clock.now());
    return reply.code(204).send();
  });
  app.post('/v1/platform/payments/:id/reject', platform, async (request, reply) => {
    const { reason } = parseBody(rejectPaymentInput, request.body);
    await decidePayment(app.db, platformOf(request), idOf(request.params), false, reason, app.clock.now());
    return reply.code(204).send();
  });
  app.get('/v1/platform/plans', platform, async () => platformPlans(app.db));
  app.put('/v1/platform/plans/:code', platform, async (request, reply) => {
    const code = String((request.params as { code?: string }).code ?? '').slice(0, 40);
    await savePlan(app.db, platformOf(request), code, parseBody(planInput, request.body));
    return reply.code(204).send();
  });
  app.get('/v1/platform/settings', platform, async () => platformSettings(app.db));
  app.put('/v1/platform/settings', platform, async (request, reply) => {
    await savePlatformSettings(app.db, platformOf(request), parseBody(platformSettingsInput, request.body));
    return reply.code(204).send();
  });
}
