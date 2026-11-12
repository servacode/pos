import type { FastifyInstance } from 'fastify';
import {
  expenseInput,
  expenseListQuery,
  manualEntryInput,
  profitLossQuery,
  statementRangeQuery,
  uuidSchema,
  voidInput,
} from '@serva/core';
import { requireAuth } from '../auth/guard';
import { AppError, unauthorized } from '../errors';
import { clientIp } from '../http/client-ip';
import {
  createExpense,
  createManualEntry,
  listExpenses,
  partyStatement,
  profitLoss,
  reverseManualEntry,
  voidExpense,
} from '../services/ledger-docs';
import { parseBody } from './validation';

/**
 * Statements, expenses, manual journal entries and the profit and loss
 * (packages/core › contracts/ledger-docs.ts). Each service checks its own permission.
 */
export async function ledgerDocRoutes(app: FastifyInstance): Promise<void> {
  const meta = (request: { headers: Record<string, unknown> } & Parameters<typeof clientIp>[0]) => ({
    ip: clientIp(request),
    userAgent: (request.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  });
  const idOf = (params: unknown, what: string) => {
    const parsed = uuidSchema.safeParse((params as { id?: string }).id);
    if (!parsed.success) throw new AppError(404, 'not_found', `${what} غير موجود.`);
    return parsed.data;
  };
  const opts = { preHandler: requireAuth };

  app.get('/v1/customers/:id/statement', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return partyStatement(
      app.db,
      request.auth,
      'customer',
      idOf(request.params, 'هذا الزبون'),
      parseBody(statementRangeQuery, request.query),
    );
  });

  app.get('/v1/suppliers/:id/statement', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return partyStatement(
      app.db,
      request.auth,
      'supplier',
      idOf(request.params, 'هذا المورد'),
      parseBody(statementRangeQuery, request.query),
    );
  });

  app.get('/v1/expenses', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return listExpenses(app.db, request.auth, parseBody(expenseListQuery, request.query));
  });

  app.post('/v1/expenses', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createExpense(
      app.db,
      request.auth,
      parseBody(expenseInput, request.body),
      meta(request),
    );
    return reply.code(201).send(created);
  });

  app.post('/v1/expenses/:id/void', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return voidExpense(
      app.db,
      request.auth,
      idOf(request.params, 'هذا المصروف'),
      parseBody(voidInput, request.body).reason,
      meta(request),
    );
  });

  app.post('/v1/journal/manual', opts, async (request, reply) => {
    if (!request.auth) throw unauthorized();
    const created = await createManualEntry(
      app.db,
      request.auth,
      parseBody(manualEntryInput, request.body),
      meta(request),
    );
    return reply.code(201).send(created);
  });

  app.post('/v1/journal/:id/reverse', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return reverseManualEntry(
      app.db,
      request.auth,
      idOf(request.params, 'هذا القيد'),
      parseBody(voidInput, request.body).reason,
      meta(request),
    );
  });

  app.get('/v1/reports/profit-loss', opts, async (request) => {
    if (!request.auth) throw unauthorized();
    return profitLoss(app.db, request.auth, parseBody(profitLossQuery, request.query));
  });
}
