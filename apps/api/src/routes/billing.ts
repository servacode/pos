import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  legalInput,
  openInvoiceInput,
  planInput,
  platformLoginInput,
  platformSettingsInput,
  platformSubscriptionInput,
  rejectPaymentInput,
  reportPaymentInput,
  uuidSchema,
} from '@serva/core';
import { requireDevice } from '../auth/device-guard';
import { requireAuth } from '../auth/guard';
import { requirePlatform } from '../auth/platform-guard';
import type { PlatformClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { enforceLimits } from '../http/rate-limit';
import {
  decidePayment,
  legalDetails,
  publicLegal,
  saveLegalDetails,
  openInvoice,
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
import { platformSignIn } from '../services/platform-2fa';
import { releaseQuietly } from '../services/subscription-release';
import { tillSubscription } from '../services/subscription-gate';
import type { SyncProcessors } from '../services/sync-push';
import { parseBody } from './validation';

/** The store's subscription, and the platform panel (packages/core › contracts/billing.ts). */
export function billingRoutes(processors: SyncProcessors = {}) {
  return async (app: FastifyInstance): Promise<void> => {
    /**
     * A payment confirmed, a payment reported (72-hour activation) and a subscription set by the
     * platform can each make a read-only store writable: whatever it held is released at once (the
     * next push of any till would do it too).
     */
    const releaseFor = (tenantId: string | null, request: FastifyRequest) =>
      tenantId
        ? releaseQuietly(
            app.db,
            tenantId,
            {
              processors,
              now: app.clock.now(),
              meta: { ip: clientIp(request), userAgent: request.headers['user-agent'] ?? null },
              enforceSubscription: app.env.SUBSCRIPTION_ENFORCEMENT,
              onError: (error, docId) =>
                request.log.error({ err: error, docId }, 'quarantine release failed'),
            },
            (error) => request.log.error({ err: error }, 'quarantine release failed'),
          )
        : Promise.resolve();

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
    // The till has no user to ask /v1/me: its status bar reads the same state with the device token.
    app.get('/v1/device/subscription', { onRequest: requireDevice() }, async (request) => {
      if (!request.device) throw unauthorized();
      return tillSubscription(
        app.db,
        request.device.tenantId,
        app.clock.now(),
        app.env.SUBSCRIPTION_ENFORCEMENT,
      );
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
      await releaseFor(request.auth.tenantId, request);
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
      // Password first; a code, a new password or enrolment may follow (services/platform-2fa.ts)
      async (request) => platformSignIn(app, parseBody(platformLoginInput, request.body), app.clock.now()),
    );

    const platform = { preHandler: requirePlatform };
    app.get('/v1/platform/stores', platform, async () => platformStores(app.db, app.clock.now()));
    app.put('/v1/platform/stores/:id/subscription', platform, async (request, reply) => {
      const tenantId = idOf(request.params);
      await setSubscription(
        app.db,
        platformOf(request),
        tenantId,
        parseBody(platformSubscriptionInput, request.body),
        app.clock.now(),
      );
      await releaseFor(tenantId, request);
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
      const { tenantId } = await decidePayment(
        app.db,
        platformOf(request),
        idOf(request.params),
        true,
        null,
        app.clock.now(),
      );
      await releaseFor(tenantId, request);
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
    app.get('/v1/platform/legal', platform, async () => legalDetails(app.db));
    app.put('/v1/platform/legal', platform, async (request, reply) => {
      await saveLegalDetails(app.db, platformOf(request), parseBody(legalInput, request.body));
      return reply.code(204).send();
    });

    /** The terms and privacy pages and the contact details read this without signing in. */
    app.get('/v1/legal', async (_request, reply) =>
      reply.header('cache-control', 'public, max-age=60').send(await publicLegal(app.db)),
    );
  };
}
