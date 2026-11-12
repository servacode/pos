import type { FastifyInstance } from 'fastify';
import {
  onboardingInput,
  pharmacySettingsSchema,
  storeCurrencyInput,
  storeProfileInput,
  storeScaleInput,
  storeLoyaltyInput,
  storeServiceInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  readStore,
  updateCurrency,
  updateOnboarding,
  updateProfile,
  updateScale,
  updateLoyalty,
  updatePharmacy,
  updateService,
} from '../services/store';
import { parseBody } from './validation';

/** The store's settings and the start wizard (packages/core › contracts/store.ts). */
export async function storeRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });

  app.get('/v1/store', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return readStore(app.db, request.auth);
  });

  app.put('/v1/store/profile', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateProfile(app.db, request.auth, parseBody(storeProfileInput, request.body), meta(request));
  });

  app.put('/v1/store/currency', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateCurrency(
      app.db,
      request.auth,
      parseBody(storeCurrencyInput, request.body),
      meta(request),
      app.clock.now(),
    );
  });

  app.put('/v1/store/onboarding', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateOnboarding(app.db, request.auth, parseBody(onboardingInput, request.body), app.clock.now());
  });

  app.put('/v1/store/scale', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateScale(app.db, request.auth, parseBody(storeScaleInput, request.body), meta(request));
  });

  app.put('/v1/store/service', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateService(app.db, request.auth, parseBody(storeServiceInput, request.body), meta(request));
  });

  app.put('/v1/store/loyalty', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updateLoyalty(app.db, request.auth, parseBody(storeLoyaltyInput, request.body), meta(request));
  });

  app.put('/v1/store/pharmacy', { preHandler: requireAuth }, async (request) => {
    if (!request.auth) throw unauthorized();
    return updatePharmacy(
      app.db,
      request.auth,
      parseBody(pharmacySettingsSchema, request.body),
      meta(request),
    );
  });
}
