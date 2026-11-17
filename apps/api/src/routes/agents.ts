import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  agentActivateInput,
  agentBalanceInput,
  agentInput,
  agentLoginInput,
  agentPasswordInput,
  moveStoreInput,
  uuidSchema,
} from '@serva/core';
import { requireAgent, requireAgentAnyState, type AgentSession } from '../auth/agent-guard';
import { requirePlatform } from '../auth/platform-guard';
import type { PlatformClaims } from '../auth/tokens';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import { enforceLimits } from '../http/rate-limit';
import {
  activateStore,
  agentLedger,
  agentMe,
  agentSignIn,
  agentStores,
  changeAgentBalance,
  changeAgentPassword,
  moveStore,
  platformAgentPage,
  platformAgents,
  saveAgent,
} from '../services/agents';
import { releaseQuietly } from '../services/subscription-release';
import type { SyncProcessors } from '../services/sync-push';
import { parseBody } from './validation';

const LOGIN_WINDOW_MS = 15 * 60_000;
/** Wrong or right, this many sign-ins for one email in 15 minutes */
const LOGINS_PER_EMAIL = 10;

/**
 * The agents program (contracts/agents.ts): the platform panel's agents pages and the agent portal.
 * The portal is a realm of its own: an agent's token opens nothing else, and nothing else opens it.
 */
export function agentRoutes(processors: SyncProcessors = {}) {
  return async (app: FastifyInstance): Promise<void> => {
    const idOf = (params: unknown) => {
      const parsed = uuidSchema.safeParse((params as { id?: string }).id);
      if (!parsed.success) throw new AppError(404, 'not_found', 'غير موجود.');
      return parsed.data;
    };
    const platformOf = (request: { platform?: PlatformClaims }): PlatformClaims => {
      if (!request.platform) throw unauthorized();
      return request.platform;
    };
    const agentOf = (request: { agent?: AgentSession }): AgentSession => {
      if (!request.agent) throw unauthorized();
      return request.agent;
    };
    const now = () => app.clock.now();

    const releaseFor = (tenantId: string, request: FastifyRequest) =>
      releaseQuietly(
        app.db,
        tenantId,
        {
          processors,
          now: app.clock.now(),
          meta: { ip: clientIp(request), userAgent: request.headers['user-agent'] ?? null },
          enforceSubscription: app.env.SUBSCRIPTION_ENFORCEMENT,
          onError: (error, docId) => request.log.error({ err: error, docId }, 'quarantine release failed'),
        },
        (error) => request.log.error({ err: error }, 'quarantine release failed'),
      );

    // ─── The platform panel ──────────────────────────────────────────────────
    const platform = { preHandler: requirePlatform };
    app.get('/v1/platform/agents', platform, async () => platformAgents(app.db));
    app.post('/v1/platform/agents', platform, async (request, reply) => {
      const id = await saveAgent(app, platformOf(request), null, parseBody(agentInput, request.body));
      return reply.code(201).send({ id });
    });
    app.get('/v1/platform/agents/:id', platform, async (request) =>
      platformAgentPage(app.db, idOf(request.params), now()),
    );
    app.put('/v1/platform/agents/:id', platform, async (request, reply) => {
      await saveAgent(app, platformOf(request), idOf(request.params), parseBody(agentInput, request.body));
      return reply.code(204).send();
    });
    app.post('/v1/platform/agents/:id/balance', platform, async (request) =>
      changeAgentBalance(
        app.db,
        platformOf(request),
        idOf(request.params),
        parseBody(agentBalanceInput, request.body),
        now(),
      ),
    );
    app.put('/v1/platform/stores/:id/agent', platform, async (request, reply) => {
      await moveStore(
        app.db,
        platformOf(request),
        idOf(request.params),
        parseBody(moveStoreInput, request.body).agentId,
      );
      return reply.code(204).send();
    });

    // ─── The agent portal ────────────────────────────────────────────────────
    app.post(
      '/v1/agent/login',
      {
        onRequest: async (request, reply) => {
          await enforceLimits(request, reply, 60_000, [
            { key: `agent-login:${request.ip}`, max: app.env.AUTH_RATE_LIMIT_PER_MINUTE },
          ]);
        },
        // The body is read by now: one email is tried only so many times, from anywhere
        preHandler: async (request, reply) => {
          const email = String((request.body as { email?: unknown } | null)?.email ?? '')
            .trim()
            .toLowerCase()
            .slice(0, 120);
          await enforceLimits(request, reply, LOGIN_WINDOW_MS, [
            { key: `agent-login:ip:${clientIp(request)}`, max: 40 },
            ...(email ? [{ key: `agent-login:email:${email}`, max: LOGINS_PER_EMAIL }] : []),
          ]);
        },
      },
      async (request) => agentSignIn(app, parseBody(agentLoginInput, request.body), now()),
    );

    // A new agent changes his temporary password before anything else opens
    const firstSteps = { preHandler: requireAgentAnyState };
    const agent = { preHandler: requireAgent };
    app.put('/v1/agent/password', firstSteps, async (request, reply) => {
      await enforceLimits(request, reply, LOGIN_WINDOW_MS, [
        { key: `agent-password:${agentOf(request).agentId}`, max: 10 },
      ]);
      await changeAgentPassword(app, agentOf(request).agentId, parseBody(agentPasswordInput, request.body));
      return reply.code(204).send();
    });
    app.get('/v1/agent/me', firstSteps, async (request) => agentMe(app.db, agentOf(request)));
    app.get('/v1/agent/stores', agent, async (request) => ({
      items: await agentStores(app.db, agentOf(request).agentId, now()),
    }));
    app.get('/v1/agent/ledger', agent, async (request) => ({
      items: await agentLedger(app.db, agentOf(request).agentId),
    }));
    app.post('/v1/agent/stores/:id/activate', agent, async (request, reply) => {
      const session = agentOf(request);
      const tenantId = idOf(request.params);
      await enforceLimits(request, reply, 60_000, [{ key: `agent-activate:${session.agentId}`, max: 30 }]);
      const result = await activateStore(
        app.db,
        session.agentId,
        tenantId,
        parseBody(agentActivateInput, request.body),
        now(),
      );
      // A store that was read-only can write again: whatever it held is released at once
      await releaseFor(tenantId, request);
      return result;
    });
  };
}
